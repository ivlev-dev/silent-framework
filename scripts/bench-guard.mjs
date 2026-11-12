import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const baselinePath = join(root, "scripts", "bench-baseline.json");

const rawArgs = process.argv.slice(2);
const update = rawArgs.includes("--update");
const strict = rawArgs.includes("--strict");
const onlyArg = rawArgs.find((value) => value.startsWith("--only="));
const only = new Set(
  onlyArg === undefined ? ["build", "browser"] : onlyArg.slice("--only=".length).split(","),
);

const LIMITS = {
  startGzipKb: 0.3,
  startJsKb: 2,
  warmMs: 40,
  ratioDrop: 15,
  opsDrop: 25,
};

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

function collect() {
  const directory = mkdtempSync(join(tmpdir(), "silent-guard-"));
  const metrics = {};
  try {
    if (only.has("build")) {
      const data = run("build", join(directory, "build.json"), "bench:build");
      metrics.build = {
        startJsKb: data.silent.startJsKb,
        startGzipKb: data.silent.startGzipKb,
        warmMs: data.silent.warmMs,
        coldMs: data.silent.coldMs,
        vmStartGzipKb: data.silentVm.startGzipKb,
      };
    }
    if (only.has("browser")) {
      const data = run("browser", join(directory, "browser.json"), "bench:browser");
      metrics.browser = {
        silentOps: data.silent.ops,
        solidOps: data.solid.ops,
        ratio: data.ratio,
        p50Ms: data.silent.p50Ms,
      };
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
  const failed =
    check.kind === "growth" ? check.current - check.base > check.limit : deltaPct < -check.limit;
  return { failed, deltaPct };
}

const current = collect();

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`bench-guard: baseline записан (${Object.keys(current).join(", ")})`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error("bench-guard: нет scripts/bench-baseline.json — запусти с --update");
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
let failed = 0;
for (const check of buildChecks(current, baseline)) {
  const { failed: isFailed, deltaPct } = evaluate(check);
  const sign = deltaPct >= 0 ? "+" : "";
  const limit = check.kind === "growth" ? `+${String(check.limit)}` : `-${String(check.limit)}%`;
  console.log(
    `${(isFailed ? "FAIL" : "ok").padEnd(5)} ${check.name}: ${check.current.toFixed(2)} против ${check.base.toFixed(2)} (${sign}${deltaPct.toFixed(1)}%, порог ${limit})`,
  );
  if (!isFailed) {
    continue;
  }
  if (check.name.includes("Ops") && !strict) {
    console.log("      предупреждение: ops/s зависит от машины, без --strict не считается ошибкой");
    continue;
  }
  failed += 1;
}

if (failed > 0) {
  console.error(`bench-guard: регрессий ${String(failed)}`);
  process.exit(1);
}

console.log("bench-guard: ok");
