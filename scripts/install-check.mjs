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
const names = ["reactivity", "di", "core", "swc", "vite", "server", "silent"];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const output = mkdtempSync(join(tmpdir(), "silent-install-"));
const packs = join(output, "packs");
const project = join(output, "project");
const modules = join(project, "node_modules", "@ivlev-dev");

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
      name === "silent"
        ? file === `ivlev-dev-silent-${manifest.version}.tgz`
        : file.startsWith(`ivlev-dev-silent-${name}-${manifest.version}.tgz`),
    );
    assert.ok(tarball, `не найден tarball для @ivlev-dev/silent-${name}`);
    tarballs.set(name, tarball);
  }

  assert.equal(
    versions.size,
    1,
    `версии пакетов расходятся: ${[...versions].join(", ")}`,
  );

  for (const [name, tarball] of tarballs) {
    const target = join(modules, name === "silent" ? "silent" : `silent-${name}`);
    mkdirSync(target, { recursive: true });
    execFileSync("tar", [
      "-xzf",
      join(packs, tarball),
      "-C",
      target,
      "--strip-components=1",
    ]);
    console.log(
      `install: @ivlev-dev/${name === "silent" ? "silent" : `silent-${name}`} ${[...versions][0]}`,
    );
  }

  const expectedVersion = [...versions][0];
  writeFileSync(
    join(project, "check.mjs"),
    `import { createSignal } from "@ivlev-dev/silent-reactivity";
import { container } from "@ivlev-dev/silent-di";
import { hydrate, mount } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import silent from "@ivlev-dev/silent-vite";
import { transform, version } from "@ivlev-dev/silent-swc";
import { mount as metaMount, silent as metaSilent } from "@ivlev-dev/silent";

const [read, write] = createSignal(1);
write(2);
if (read() !== 2) throw new Error("reactivity: signal write failed");
if (typeof container.resolve !== "function") throw new Error("di: container");
if (typeof mount !== "function" || typeof hydrate !== "function") {
  throw new Error("core: mount/hydrate missing");
}
if (typeof renderToString !== "function") throw new Error("server: renderToString");
if (typeof silent !== "function") throw new Error("vite: plugin export");
if (typeof metaMount !== "function") throw new Error("silent: mount re-export");
if (typeof metaSilent !== "function") throw new Error("silent: plugin re-export");
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
