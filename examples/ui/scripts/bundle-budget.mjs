// Бюджет бандла примера: начальный JS, маршрутные и vendor-чанки.
//
// Начальный JS — это entry-скрипт из index.html плюс все modulepreload-ссылки,
// которые браузер скачивает до первого взаимодействия. Маршрутные чанки
// (`*-page-*.js`) не должны превращаться во второй «initial»: тяжёлые
// контролы живут в отдельных чанках и грузятся только на своём маршруте.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

export const LIMITS = {
  initialKb: Number(process.env.BUNDLE_INITIAL_KB ?? 60),
  routeKb: Number(process.env.BUNDLE_ROUTE_KB ?? 30),
  vendorKb: Number(process.env.BUNDLE_VENDOR_KB ?? 40),
};

function gzipSize(buffer) {
  return gzipSync(buffer).byteLength;
}

function brotliSize(buffer) {
  return brotliCompressSync(buffer).byteLength;
}

function attributes(tag) {
  const result = new Map();
  const pattern = /([a-zA-Z-]+)(?:="([^"]*)")?/gu;
  let match = pattern.exec(tag);
  while (match !== null) {
    result.set(match[1], match[2] ?? "");
    match = pattern.exec(tag);
  }
  return result;
}

function initialAssets(html) {
  const assets = new Set();
  const scriptPattern = /<script\b[^>]*>/gu;
  let script = scriptPattern.exec(html);
  while (script !== null) {
    const attrs = attributes(script[0]);
    if (attrs.get("type") === "module") {
      const src = attrs.get("src");
      if (src !== undefined && src.startsWith("/")) assets.add(src.slice(1));
    }
    script = scriptPattern.exec(html);
  }
  const preloadPattern = /<link\b[^>]*>/gu;
  let link = preloadPattern.exec(html);
  while (link !== null) {
    const attrs = attributes(link[0]);
    if (attrs.get("rel") === "modulepreload") {
      const href = attrs.get("href");
      if (href !== undefined && href.startsWith("/") && href.endsWith(".js")) {
        assets.add(href.slice(1));
      }
    }
    link = preloadPattern.exec(html);
  }
  return [...assets];
}

function measure(file) {
  const buffer = readFileSync(join(dist, file));
  return {
    file,
    bytes: buffer.byteLength,
    kb: Number((gzipSize(buffer) / 1024).toFixed(2)),
    brotliKb: Number((brotliSize(buffer) / 1024).toFixed(2)),
  };
}

/**
 * Собирает отчёт по содержимому dist без вывода в консоль.
 * @param {{ silent?: boolean }} options
 */
export function collectBundleReport(options = {}) {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const initial = initialAssets(html)
    .map((file) => measure(file))
    .sort((left, right) => right.kb - left.kb);
  const initialKb = Number(
    initial.reduce((sum, entry) => sum + entry.kb, 0).toFixed(2),
  );

  const assets = readdirSync(join(dist, "assets")).filter((file) => file.endsWith(".js"));
  const routes = assets
    .filter((file) => /-(?:page)-[^/]+\.js$/u.test(file))
    .map((file) => measure(`assets/${file}`))
    .sort((left, right) => right.kb - left.kb);
  const vendors = assets
    .filter((file) => file.startsWith("vendor-"))
    .map((file) => measure(`assets/${file}`))
    .sort((left, right) => right.kb - left.kb);
  const chunks = assets
    .map((file) => measure(`assets/${file}`))
    .sort((left, right) => right.kb - left.kb);

  const report = {
    initial,
    initialKb,
    routes,
    vendors,
    chunks,
    limits: LIMITS,
  };
  if (options.silent !== true) report.lines = formatReport(report);
  return report;
}

function formatReport(report) {
  const lines = ["Бюджет бандла: начальные чанки"];
  for (const entry of report.initial) {
    lines.push(`  ${entry.kb.toFixed(2).padStart(7)} kB  ${entry.file}`);
  }
  lines.push(
    `  ${report.initialKb.toFixed(2).padStart(7)} kB  итого (бюджет ${String(LIMITS.initialKb)} kB)`,
  );
  lines.push("Маршрутные чанки");
  for (const entry of report.routes) {
    lines.push(`  ${entry.kb.toFixed(2).padStart(7)} kB  ${entry.file}`);
  }
  lines.push("Vendor-чанки");
  for (const entry of report.vendors) {
    lines.push(`  ${entry.kb.toFixed(2).padStart(7)} kB  ${entry.file}`);
  }
  lines.push("Крупнейшие чанки (gzip / brotli)");
  for (const entry of report.chunks.slice(0, 8)) {
    lines.push(
      `  ${entry.kb.toFixed(2).padStart(7)} kB  ${entry.brotliKb.toFixed(2).padStart(7)} kB  ${entry.file}`,
    );
  }
  return lines;
}

export function evaluateBundleBudget(report) {
  const failures = [];
  if (report.initialKb > LIMITS.initialKb) {
    failures.push(
      `Начальный JS ${report.initialKb.toFixed(2)} kB gzip > ${String(LIMITS.initialKb)} kB`,
    );
  }
  for (const entry of report.routes) {
    if (entry.kb > LIMITS.routeKb) {
      failures.push(`${entry.file}: ${entry.kb.toFixed(2)} kB gzip > ${String(LIMITS.routeKb)} kB`);
    }
  }
  for (const entry of report.vendors) {
    if (entry.kb > LIMITS.vendorKb) {
      failures.push(`${entry.file}: ${entry.kb.toFixed(2)} kB gzip > ${String(LIMITS.vendorKb)} kB`);
    }
  }
  return failures;
}

function main() {
  const report = collectBundleReport({ silent: true });
  for (const line of formatReport(report)) console.log(line);
  const failures = evaluateBundleBudget(report);
  if (failures.length > 0) {
    console.error("\nПревышен бюджет бандла:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("\nБюджет бандла соблюдён.");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
