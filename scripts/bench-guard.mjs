import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = join(import.meta.dirname, "..");
const defaultBaselinePath = join(root, "scripts", "bench-baseline.json");

const SECTION_NAMES = ["build", "browser", "alloc", "ssr", "hydrate"];

const rawArgs = process.argv.slice(2);
const update = rawArgs.includes("--update");
const strict = rawArgs.includes("--strict");
const onlyArg = rawArgs.find((value) => value.startsWith("--only="));
const baselineArg = rawArgs.find((value) => value.startsWith("--baseline="));
const metricsArg = rawArgs.find((value) => value.startsWith("--metrics="));

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function requestedSections() {
  if (onlyArg === undefined) {
    return ["build", "browser", "alloc"];
  }
  const values = onlyArg
    .slice("--only=".length)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) {
    fail("bench-guard: --only= пуст; укажите секции через запятую");
  }
  const unknown = values.filter((value) => !SECTION_NAMES.includes(value));
  if (unknown.length > 0) {
    fail(
      `bench-guard: неизвестные секции ${unknown.join(", ")}; доступны: ${SECTION_NAMES.join(", ")}`,
    );
  }
  return values;
}

function pathOption(value, name) {
  if (value === undefined) {
    return null;
  }
  const path = value.slice(`--${name}=`.length);
  if (path.length === 0) {
    fail(`bench-guard: --${name}= пуст`);
  }
  return resolve(process.cwd(), path);
}

const only = new Set(requestedSections());
const explicitOnly = onlyArg !== undefined;
const baselinePath = pathOption(baselineArg, "baseline") ?? defaultBaselinePath;
const metricsPath = pathOption(metricsArg, "metrics");

const LIMITS = {
  startGzipKb: 0.3,
  startJsKb: 2,
  warmMs: 40,
  // Отношения silent/solid сравниваются в процентах: абсолютная разница
  // 0.4 для ratio 0.5 — это +80%, а не «почти ничего».
  ratioGrowth: 40,
  ratioDrop: 15,
  opsDrop: 25,
  allocGrowth: 8,
};

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`bench-guard: не удалось прочитать ${what} ${path}: ${String(error)}`);
  }
}

function run(name, jsonPath, script) {
  const result = spawnSync("pnpm", [script, "--json", jsonPath], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0 || !existsSync(jsonPath)) {
    throw new Error(`bench: ${name} завершился с ошибкой`);
  }
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

function collectBrowser() {
  const directory = mkdtempSync(join(tmpdir(), "silent-guard-"));
  try {
    const data = run("browser", join(directory, "browser.json"), "bench:browser");
    return {
      silentOps: data.silent.ops,
      solidOps: data.solid.ops,
      ratio: data.ratio,
      p50Ms: data.silent.p50Ms,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function collect() {
  const directory = mkdtempSync(join(tmpdir(), "silent-guard-"));
  const metrics = {};
  try {
    if (only.has("build")) {
      const data = run("build", join(directory, "build.json"), "bench:build");
      const solidColdMs = data.solid?.coldMs;
      const solidWarmMs = data.solid?.warmMs;
      metrics.build = {
        startJsKb: data.silent.startJsKb,
        startGzipKb: data.silent.startGzipKb,
        warmMs: data.silent.warmMs,
        coldMs: data.silent.coldMs,
        vmStartGzipKb: data.silentVm.startGzipKb,
        solidColdMs,
        solidWarmMs,
        coldRatio:
          typeof solidColdMs === "number" && solidColdMs > 0
            ? data.silent.coldMs / solidColdMs
            : undefined,
        warmRatio:
          typeof solidWarmMs === "number" && solidWarmMs > 0
            ? data.silent.warmMs / solidWarmMs
            : undefined,
      };
    }
    if (only.has("browser")) {
      metrics.browser = collectBrowser();
    }
    if (only.has("alloc")) {
      const data = run("alloc", join(directory, "alloc.json"), "bench:alloc");
      metrics.alloc = { totalKb: data.totalKb };
    }
    if (only.has("ssr")) {
      const data = run("ssr", join(directory, "ssr.json"), "bench:ssr");
      metrics.ssr = { silentOps: data.silent.ops, htmlBytes: data.silent.htmlBytes };
    }
    if (only.has("hydrate")) {
      const data = run("hydrate", join(directory, "hydrate.json"), "bench:hydrate");
      metrics.hydrate = { silentOps: data.silent.ops, ratio: data.ratio };
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return metrics;
}

function buildChecks(metrics, baseline) {
  const checks = [];
  const build = metrics.build;
  const baseBuild = baseline.build;
  if (build !== undefined && baseBuild !== undefined) {
    for (const key of ["startGzipKb", "startJsKb", "vmStartGzipKb"]) {
      const current = build[key];
      const base = baseBuild[key];
      if (typeof current === "number" && typeof base === "number") {
        checks.push({
          name: `build.${key}`,
          base,
          current,
          limit: key.includes("Gzip") ? LIMITS.startGzipKb : LIMITS.startJsKb,
          kind: "growth",
        });
      }
    }
    if (typeof build.warmMs === "number" && typeof baseBuild.warmMs === "number") {
      checks.push({
        name: "build.warmMs",
        base: baseBuild.warmMs,
        current: build.warmMs,
        limit: LIMITS.warmMs,
        kind: "growth",
      });
    }
    const solidPairs = [
      ["coldRatio", build.coldMs, build.solidColdMs],
      ["warmRatio", build.warmMs, build.solidWarmMs],
    ];
    for (const [key, silentMs, solidMs] of solidPairs) {
      const baseRatio = baseBuild[key];
      if (
        typeof silentMs !== "number"
        || typeof solidMs !== "number"
        || solidMs <= 0
        || typeof baseRatio !== "number"
      ) {
        continue;
      }
      checks.push({
        name: `build.${key}`,
        base: baseRatio,
        current: silentMs / solidMs,
        limit: LIMITS.ratioGrowth,
        kind: "growthPct",
      });
    }
  }
  const browser = metrics.browser;
  const baseBrowser = baseline.browser;
  if (browser !== undefined && baseBrowser !== undefined) {
    if (typeof browser.ratio === "number" && typeof baseBrowser.ratio === "number") {
      checks.push({
        name: "browser.ratio",
        base: baseBrowser.ratio,
        current: browser.ratio,
        limit: LIMITS.ratioDrop,
        kind: "drop",
      });
    }
    if (typeof browser.silentOps === "number" && typeof baseBrowser.silentOps === "number") {
      checks.push({
        name: "browser.silentOps",
        base: baseBrowser.silentOps,
        current: browser.silentOps,
        limit: LIMITS.opsDrop,
        kind: "drop",
      });
    }
  }
  const alloc = metrics.alloc;
  const baseAlloc = baseline.alloc;
  if (alloc !== undefined && baseAlloc !== undefined) {
    if (typeof alloc.totalKb === "number" && typeof baseAlloc.totalKb === "number") {
      checks.push({
        name: "alloc.totalKb",
        base: baseAlloc.totalKb,
        current: alloc.totalKb,
        limit: LIMITS.allocGrowth,
        kind: "growth",
      });
    }
  }
  const hydrate = metrics.hydrate;
  const baseHydrate = baseline.hydrate;
  if (hydrate !== undefined && baseHydrate !== undefined) {
    if (typeof hydrate.ratio === "number" && typeof baseHydrate.ratio === "number") {
      checks.push({
        name: "hydrate.ratio",
        base: baseHydrate.ratio,
        current: hydrate.ratio,
        limit: LIMITS.ratioDrop,
        kind: "drop",
      });
    }
  }
  return checks;
}

function evaluate(check) {
  const deltaPct = check.base === 0 ? 0 : ((check.current - check.base) / check.base) * 100;
  let failed;
  if (check.kind === "growth") {
    failed = check.current - check.base > check.limit;
  } else if (check.kind === "growthPct") {
    failed = check.base === 0 ? check.current > 0 : deltaPct > check.limit;
  } else {
    failed = deltaPct < -check.limit;
  }
  return { failed, deltaPct };
}

function loadBaseline() {
  if (!existsSync(baselinePath)) {
    fail(
      `bench-guard: нет ${baselinePath} — создайте baseline командой --update (для одной секции: --update --only=<секция>)`,
      2,
    );
  }
  const baseline = readJson(baselinePath, "baseline");
  if (baseline === null || typeof baseline !== "object" || Array.isArray(baseline)) {
    fail(`bench-guard: baseline ${baselinePath} должен быть JSON-объектом`);
  }
  return baseline;
}

function explicitMissingSections(baseline) {
  if (!explicitOnly) {
    return [];
  }
  return [...only].filter((section) => baseline[section] === undefined);
}

let baseline = null;
if (!update) {
  baseline = loadBaseline();
  const missing = explicitMissingSections(baseline);
  if (missing.length > 0) {
    fail(
      `bench-guard: в baseline нет секции ${missing.join(", ")}, но она запрошена через --only. `
        + `Обновите baseline: pnpm bench:guard --update --only=${missing.join(",")}`,
    );
  }
}

const current = metricsPath === null ? collect() : readJson(metricsPath, "метрики");
if (current === null || typeof current !== "object" || Array.isArray(current)) {
  fail(`bench-guard: метрики ${metricsPath} должны быть JSON-объектом`);
}
const missingMetrics = [...only].filter((section) => current[section] === undefined);
if (missingMetrics.length > 0) {
  fail(`bench-guard: нет метрик для секции ${missingMetrics.join(", ")}`);
}

if (update) {
  const existing = existsSync(baselinePath) ? readJson(baselinePath, "baseline") : {};
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    fail(`bench-guard: baseline ${baselinePath} должен быть JSON-объектом`);
  }
  // Секции, которые не запрашивались в этом прогоне, сохраняются как есть.
  // Внутри запрошенной секции также сохраняем метрики, которых нет в текущем
  // прогоне (например, если бенч вернул не все поля).
  const merged = { ...existing };
  for (const [section, values] of Object.entries(current)) {
    const previous = existing[section];
    merged[section] =
      values !== null
      && typeof values === "object"
      && !Array.isArray(values)
      && previous !== null
      && typeof previous === "object"
      && !Array.isArray(previous)
        ? { ...previous, ...values }
        : values;
  }
  writeFileSync(baselinePath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`bench-guard: baseline записан (${Object.keys(merged).join(", ")})`);
  process.exit(0);
}

const missingBaseline = [...only].filter(
  (section) => current[section] !== undefined && baseline[section] === undefined,
);
for (const section of missingBaseline) {
  console.log(
    `warn  ${section}: в baseline нет метрик — проверка не выполняется `
      + `(добавьте через --update --only=${section})`,
  );
}
let checks = buildChecks(current, baseline);
let ratioCheck = checks.find((check) => check.name === "browser.ratio");
for (let attempt = 0; attempt < 2; attempt += 1) {
  if (
    ratioCheck === undefined
    || current.browser === undefined
    || !evaluate(ratioCheck).failed
  ) {
    break;
  }
  console.log("bench-guard: ratio шумит — повторный прогон browser");
  const retry = collectBrowser();
  if (retry.ratio > current.browser.ratio) {
    current.browser = retry;
  }
  checks = buildChecks(current, baseline);
  ratioCheck = checks.find((check) => check.name === "browser.ratio");
}

let failed = 0;
for (const check of checks) {
  const { failed: isFailed, deltaPct } = evaluate(check);
  const sign = deltaPct >= 0 ? "+" : "";
  const limit =
    check.kind === "growth"
      ? `+${String(check.limit)}`
      : check.kind === "growthPct"
        ? `+${String(check.limit)}%`
        : `-${String(check.limit)}%`;
  console.log(
    `${(isFailed ? "FAIL" : "ok").padEnd(5)} ${check.name}: ${check.current.toFixed(2)} против ${check.base.toFixed(2)} (${sign}${deltaPct.toFixed(1)}%, порог ${limit})`,
  );
  if (!isFailed) {
    continue;
  }
  if (
    check.name.includes("Ops")
    || check.name === "browser.ratio"
    || check.name === "hydrate.ratio"
    || check.name === "build.coldRatio"
    || check.name === "build.warmRatio"
  ) {
    if (strict) {
      failed += 1;
      continue;
    }
    console.log("      предупреждение: метрика зависит от загрузки машины, без --strict не считается ошибкой");
    continue;
  }
  failed += 1;
}

if (failed > 0) {
  console.error(`bench-guard: регрессий ${String(failed)}`);
  process.exit(1);
}

console.log("bench-guard: ok");
