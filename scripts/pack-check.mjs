import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), "silent-pack-"));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const expectations = {
  reactivity: ["package/dist/index.js", "package/dist/index.d.ts"],
  di: ["package/dist/index.js", "package/dist/index.d.ts"],
  core: [
    "package/dist/index.js",
    "package/dist/jsx-runtime.js",
    "package/dist/hmr.js",
    "package/dist/index.d.ts",
  ],
  swc: ["package/index.js", "package/index.d.ts"],
  vite: ["package/dist/index.js", "package/dist/index.d.ts"],
  server: ["package/dist/index.js", "package/dist/index.d.ts"],
};

for (const [name, required] of Object.entries(expectations)) {
  const directory = join(root, "packages", name);
  execFileSync(pnpm, ["pack", "--pack-destination", output], {
    cwd: directory,
    encoding: "utf8",
  });
  const tarball = readdirSync(output).find((file) =>
    file.startsWith(`ivlev-dev-silent-${name}-`),
  );
  assert.ok(tarball, `не найден tarball для @ivlev-dev/silent-${name}`);
  const file = join(output, tarball);
  const entries = execFileSync("tar", ["-tzf", file], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const entry of required) {
    assert.ok(entries.includes(entry), `@ivlev-dev/silent-${name}: нет ${entry}`);
  }
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
