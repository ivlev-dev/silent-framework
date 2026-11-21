import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectLibc, loadNative, resolveNativeTriples } from "./loader.js";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const triples = resolveNativeTriples({
  platform: process.platform,
  arch: process.arch,
  libc: process.platform === "linux" ? detectLibc(process.report?.getReport?.()) : "gnu",
  allowGnuFallback: process.env.SILENT_SWC_ALLOW_GNU_FALLBACK === "1",
});

const native = loadNative({
  requireModule: (name) => require(name),
  nativeDirectory: join(here, "native"),
  triples,
});

export const transform = native.transform;
export const scan = native.scan;
export const scanFiles = native.scanFiles;
export const version = native.version;
