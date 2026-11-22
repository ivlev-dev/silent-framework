import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const script = join(import.meta.dirname, "bench-guard.mjs");
const directory = mkdtempSync(join(tmpdir(), "bench-guard-test-"));
after(() => {
  rmSync(directory, { recursive: true, force: true });
});

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: import.meta.dirname,
    encoding: "utf8",
  });
}

function writeJson(name, value) {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

const buildMetrics = {
  startJsKb: 37,
  startGzipKb: 12,
  warmMs: 40,
  coldMs: 60,
  solidColdMs: 120,
  solidWarmMs: 30,
  coldRatio: 0.5,
  warmRatio: 1.33,
};

const browserMetrics = {
  silentOps: 20_000,
  solidOps: 30_000,
  ratio: 0.66,
  p50Ms: 0.04,
};

test("явно запрошенная секция без baseline — ошибка", () => {
  const baseline = writeJson("missing-browser-baseline.json", {
    build: buildMetrics,
  });
  const metrics = writeJson("browser-metrics.json", {
    browser: browserMetrics,
  });

  const result = run([
    "--only=browser",
    `--baseline=${baseline}`,
    `--metrics=${metrics}`,
  ]);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /нет секции browser/);
});

test("отсутствующий файл baseline — ошибка", () => {
  const metrics = writeJson("orphan-metrics.json", {
    browser: browserMetrics,
  });

  const result = run([
    "--only=browser",
    `--baseline=${join(directory, "does-not-exist.json")}`,
    `--metrics=${metrics}`,
  ]);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /нет .*does-not-exist\.json/);
});

test("рост coldRatio на 60% при пороге 40% — ошибка в strict-режиме", () => {
  const baseline = writeJson("ratio-baseline.json", {
    build: buildMetrics,
  });
  const metrics = writeJson("ratio-metrics.json", {
    build: {
      ...buildMetrics,
      coldMs: 80,
      solidColdMs: 100,
      coldRatio: 0.8,
    },
  });

  const result = run([
    "--only=build",
    "--strict",
    `--baseline=${baseline}`,
    `--metrics=${metrics}`,
  ]);

  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /FAIL\s+build\.coldRatio/);
  assert.match(result.stdout, /\+60\.0%/);
});

test("тот же рост ratio без --strict — предупреждение, а не ошибка", () => {
  const baseline = writeJson("ratio-baseline-warn.json", {
    build: buildMetrics,
  });
  const metrics = writeJson("ratio-metrics-warn.json", {
    build: {
      ...buildMetrics,
      coldMs: 80,
      solidColdMs: 100,
      coldRatio: 0.8,
    },
  });

  const result = run([
    "--only=build",
    `--baseline=${baseline}`,
    `--metrics=${metrics}`,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAIL\s+build\.coldRatio/);
  assert.match(result.stdout, /без --strict не считается ошибкой/);
});

test("--update сохраняет секции, которых нет в текущем прогоне", () => {
  const baseline = writeJson("merge-baseline.json", {
    build: buildMetrics,
  });
  const metrics = writeJson("merge-metrics.json", {
    browser: browserMetrics,
  });

  const result = run([
    "--update",
    "--only=browser",
    `--baseline=${baseline}`,
    `--metrics=${metrics}`,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const merged = JSON.parse(readFileSync(baseline, "utf8"));
  assert.deepEqual(Object.keys(merged).sort(), ["browser", "build"]);
  assert.deepEqual(merged.build, buildMetrics);
  assert.deepEqual(merged.browser, browserMetrics);
});
