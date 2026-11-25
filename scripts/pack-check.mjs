import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  server: [
    "package/README.md",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/pool.js",
    "package/dist/pool.d.ts",
    "package/dist/pool/pool.js",
    "package/dist/pool/pool.d.ts",
    "package/dist/pool/worker-main.js",
    "package/dist/pool/errors.js",
    "package/dist/pool/protocol.js",
  ],
  router: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  validation: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  "validation-vite": ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  protocol: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  "protocol-vite": ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  form: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  virtual: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  dnd: ["package/README.md", "package/dist/index.js", "package/dist/index.d.ts"],
  ui: [
    "package/README.md",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/styles.css",
    "package/dist/tokens.css",
    "package/dist/themes.css",
    "package/dist/layout.css",
    "package/dist/form.css",
    "package/dist/components/button/button.css",
    "package/dist/components/button/index.js",
    "package/dist/components/alert/alert.css",
    "package/dist/components/accordion/accordion.css",
    "package/dist/components/badge/badge.css",
    "package/dist/components/chip/chip.css",
    "package/dist/components/tag/tag.css",
    "package/dist/components/progress/progress.css",
    "package/dist/components/skeleton/skeleton.css",
    "package/dist/components/card/card.css",
    "package/dist/components/list/list.css",
    "package/dist/components/table/table.css",
    "package/dist/components/avatar/avatar.css",
    "package/dist/components/empty-state/empty-state.css",
    "package/dist/components/fab/fab.css",
    "package/dist/components/segmented-button/segmented-button.css",
    "package/dist/components/search-field/search-field.css",
    "package/dist/components/avatar/avatar.css",
    "package/dist/components/dialog/dialog.css",
    "package/dist/components/alert-dialog/alert-dialog.css",
    "package/dist/components/sheet/sheet.css",
    "package/dist/components/popover/popover.css",
    "package/dist/components/menu/menu.css",
    "package/dist/components/tooltip/tooltip.css",
    "package/dist/components/snackbar/snackbar.css",
    "package/dist/components/tabs/tabs.css",
    "package/dist/components/top-app-bar/top-app-bar.css",
    "package/dist/components/navigation-bar/navigation-bar.css",
    "package/dist/components/navigation-rail/navigation-rail.css",
    "package/dist/components/drawer/drawer.css",
    "package/dist/components/breadcrumbs/breadcrumbs.css",
    "package/dist/components/pagination/pagination.css",
    "package/dist/form/index.js",
    "package/dist/form/index.d.ts",
    "package/dist/form/text-field/index.js",
    "package/dist/form/text-field/text-field.css",
    "package/dist/form/field-array/field-array.css",
    "package/dist/icons/close.js",
  ],
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

try {
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
    const expectedTarball =
      name === "silent"
        ? `ivlev-dev-silent-${sourceManifest.version}.tgz`
        : `ivlev-dev-silent-${name}-${sourceManifest.version}.tgz`;
    const tarball = readdirSync(output).find((file) => file === expectedTarball);
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
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    };
    assert.ok(
      !Object.values(dependencies).some((value) => String(value).startsWith("workspace:")),
      `@ivlev-dev/silent-${name}: workspace-зависимость не заменена версией (dependencies/peerDependencies/optionalDependencies)`,
    );
    console.log(
      `pack: ${name === "silent" ? "@ivlev-dev/silent" : `@ivlev-dev/silent-${name}`} ${tarball}`,
    );
  }

  console.log("pack: ok");
} finally {
  rmSync(output, { recursive: true, force: true });
}
