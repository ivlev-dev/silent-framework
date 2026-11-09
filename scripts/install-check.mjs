import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const names = ["reactivity", "di", "core", "swc", "vite", "server"];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const output = mkdtempSync(join(tmpdir(), "silent-install-"));
const packs = join(output, "packs");
const project = join(output, "project");
const modules = join(project, "node_modules", "@ivlev98");

try {
  mkdirSync(packs, { recursive: true });
  mkdirSync(modules, { recursive: true });

  const versions = new Set();
  const tarballs = new Map();

  for (const name of names) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    );
    versions.add(manifest.version);
    execFileSync(pnpm, ["pack", "--pack-destination", packs], {
      cwd: directory,
      encoding: "utf8",
    });
    const tarball = readdirSync(packs).find((file) =>
      file.startsWith(`ivlev98-silent-${name}-${manifest.version}.tgz`),
    );
    assert.ok(tarball, `не найден tarball для @ivlev98/silent-${name}`);
    tarballs.set(name, tarball);
  }

  assert.equal(
    versions.size,
    1,
    `версии пакетов расходятся: ${[...versions].join(", ")}`,
  );

  for (const [name, tarball] of tarballs) {
    const target = join(modules, `silent-${name}`);
    mkdirSync(target, { recursive: true });
    execFileSync("tar", [
      "-xzf",
      join(packs, tarball),
      "-C",
      target,
      "--strip-components=1",
    ]);
    console.log(`install: @ivlev98/silent-${name} ${[...versions][0]}`);
  }

  const expectedVersion = [...versions][0];
  writeFileSync(
    join(project, "check.mjs"),
    `import { createSignal } from "@ivlev98/silent-reactivity";
import { container } from "@ivlev98/silent-di";
import { hydrate, mount } from "@ivlev98/silent-core";
import { renderToString } from "@ivlev98/silent-server";
import silent from "@ivlev98/silent-vite";
import { transform, version } from "@ivlev98/silent-swc";

const [read, write] = createSignal(1);
write(2);
if (read() !== 2) throw new Error("reactivity: signal write failed");
if (typeof container.resolve !== "function") throw new Error("di: container");
if (typeof mount !== "function" || typeof hydrate !== "function") {
  throw new Error("core: mount/hydrate missing");
}
if (typeof renderToString !== "function") throw new Error("server: renderToString");
if (typeof silent !== "function") throw new Error("vite: plugin export");
const result = JSON.parse(
  transform("export const answer: number = 42;", "answer.ts", "{}", "{}"),
);
if (typeof result.code !== "string" || !result.code.includes("42")) {
  throw new Error("swc: transform failed");
}
if (version() !== "${expectedVersion}") {
  throw new Error("swc: addon version " + version() + " != ${expectedVersion}");
}
console.log("install: runtime ok, addon", version());
`,
  );

  execFileSync(process.execPath, ["check.mjs"], {
    cwd: project,
    stdio: "inherit",
  });
  console.log("install: ok");
} finally {
  rmSync(output, { recursive: true, force: true });
}
