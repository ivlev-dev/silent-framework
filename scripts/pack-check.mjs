import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), "silent-pack-"));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const expectations = {
  reactivity: [
    "package/README.md",
    "package/dist/index.js",
    "package/dist/index.d.ts",
  ],
  di: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  core: [
    "package/README.md",
    "package/dist/index.js",
    "package/dist/jsx-runtime.js",
    "package/dist/hmr.js",
    "package/dist/index.d.ts",
  ],
  swc: ["package/README.md", "package/index.js", "package/index.d.ts"],
  vite: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  server: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  silent: ["package/README.md", "package/index.js", "package/index.d.ts"],
};

const FORBIDDEN_SEGMENTS = new Set([
  "bench",
  "crates",
  "tests",
  "test",
  "__tests__",
  "fixtures",
  "node_modules",
]);

function entrySegments(entry) {
  return entry.split("/").filter(Boolean).map((part) => part.toLowerCase());
}

function forbiddenEntries(entries) {
  return entries.filter((entry) => {
    const segments = entrySegments(entry);
    if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
      return true;
    }
    return /\.tsbuildinfo$/i.test(entry);
  });
}

function forbiddenManifestFiles(files) {
  return files.filter((entry) => {
    const segments = entrySegments(entry);
    return segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment));
  });
}

function runNegativeSelfCheck() {
  assert.deepEqual(
    forbiddenEntries([
      "package/dist/index.js",
      "package/README.md",
      "package/package.json",
    ]),
    [],
    "негативный тест: чистый список файлов не должен считаться нарушением",
  );
  for (const sample of [
    "package/bench/bench.js",
    "package/crates/native/src/lib.rs",
    "package/tests/golden.test.js",
    "package/test/unit.js",
    "package/__tests__/x.js",
    "package/dist/fixtures/case.html",
    "package/node_modules/typescript/index.js",
    "package/dist/.tsbuildinfo",
  ]) {
    assert.equal(
      forbiddenEntries([sample]).length,
      1,
      `негативный тест: путь ${sample} должен быть запрещён`,
    );
  }
  assert.equal(
    forbiddenManifestFiles(["dist", "bench"]).length,
    1,
    "негативный тест: files с bench должен быть запрещён",
  );
  assert.deepEqual(
    forbiddenManifestFiles(["dist", "index.js", "native/*.node"]),
    [],
    "негативный тест: корректный files не должен считаться нарушением",
  );
}

runNegativeSelfCheck();

for (const [name, required] of Object.entries(expectations)) {
  const directory = join(root, "packages", name);
  const sourceManifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  const sourceFiles = Array.isArray(sourceManifest.files) ? sourceManifest.files : [];
  const filesViolations = forbiddenManifestFiles(sourceFiles);
  assert.deepEqual(
    filesViolations,
    [],
    `@ivlev-dev/silent-${name}: поле files ссылается на запрещённые пути: ${filesViolations.join(", ")}`,
  );

  execFileSync(pnpm, ["pack", "--pack-destination", output], {
    cwd: directory,
    encoding: "utf8",
  });
  const tarball = readdirSync(output).find((file) =>
    name === "silent"
      ? file === `ivlev-dev-silent-${sourceManifest.version}.tgz`
      : file.startsWith(`ivlev-dev-silent-${name}-`),
  );
  assert.ok(tarball, `не найден tarball для @ivlev-dev/silent-${name}`);
  const file = join(output, tarball);
  const entries = execFileSync("tar", ["-tzf", file], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const entry of required) {
    assert.ok(entries.includes(entry), `@ivlev-dev/silent-${name}: нет ${entry}`);
  }
  assert.deepEqual(
    forbiddenEntries(entries),
    [],
    `@ivlev-dev/silent-${name}: в tarball попали bench/crates/tests/node_modules/фикстуры`,
  );
  assert.ok(
    !entries.some((entry) => entry.startsWith("package/node_modules/")),
    `@ivlev-dev/silent-${name}: в tarball попал node_modules`,
  );
  if (name === "swc") {
    assert.ok(
      entries.some((entry) => entry.endsWith(".node")),
      "@ivlev-dev/silent-swc: в tarball нет нативного addon",
    );
  }
  const manifest = JSON.parse(
    execFileSync("tar", ["-xOzf", file, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  const publishedFiles = Array.isArray(manifest.files) ? manifest.files : [];
  assert.deepEqual(
    forbiddenManifestFiles(publishedFiles),
    [],
    `@ivlev-dev/silent-${name}: опубликованный files ссылается на запрещённые пути`,
  );
  const devDependencies = Object.keys(manifest.devDependencies ?? {});
  const topLevel = new Set(
    entries.map((entry) => entry.split("/")[1]).filter(Boolean),
  );
  for (const dependency of devDependencies) {
    assert.ok(
      !topLevel.has(dependency),
      `@ivlev-dev/silent-${name}: dev-зависимость ${dependency} попала в tarball`,
    );
  }
  const dependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  assert.ok(
    !Object.values(dependencies).some((value) => String(value).startsWith("workspace:")),
    `@ivlev-dev/silent-${name}: workspace-зависимость не заменена версией`,
  );
  console.log(`pack: @ivlev-dev/silent-${name} ${tarball}`);
}

console.log("pack: ok");
