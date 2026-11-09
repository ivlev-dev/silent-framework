import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const nativeDirectory = join(here, "native");

const triples = {
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
  "win32-x64": "win32-x64-msvc",
  "win32-arm64": "win32-arm64-msvc",
};

function platformTriple() {
  return triples[`${process.platform}-${process.arch}`] ?? `${process.platform}-${process.arch}`;
}

function loadNative() {
  const triple = platformTriple();
  try {
    return require(`@ivlev98/silent-swc-${triple}`);
  } catch {
    void triple;
  }

  if (!existsSync(nativeDirectory)) {
    throw new Error(
      "@ivlev98/silent-swc: native directory is missing. Run `pnpm --filter @ivlev98/silent-swc build`.",
    );
  }

  const files = readdirSync(nativeDirectory).filter((file) => file.endsWith(".node"));
  const preferred = [
    `silent-swc.${triple}.node`,
    `index.${triple}.node`,
    `silent-node.${triple}.node`,
    "silent-swc.node",
  ];
  const tripleUpper = triple.toUpperCase();
  const candidate =
    preferred.find((name) => files.includes(name)) ??
    files.find((name) => name.includes(triple) || name.includes(tripleUpper)) ??
    files[0];

  if (candidate === undefined) {
    throw new Error(
      "@ivlev98/silent-swc: native addon is not built. Run `pnpm --filter @ivlev98/silent-swc build`.",
    );
  }
  return require(join(nativeDirectory, candidate));
}

const native = loadNative();

export const transform = native.transform;
export const scan = native.scan;
export const version = native.version;
