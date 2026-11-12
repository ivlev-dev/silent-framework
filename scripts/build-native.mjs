import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packageDirectory = join(repositoryRoot, "packages", "swc");
const nativeDirectory = join(packageDirectory, "native");
const cratesDirectory = join(repositoryRoot, "crates");

function linuxLibc() {
  const report = process.report?.getReport?.();
  const glibcVersion = report?.header?.glibcVersionRuntime;
  return typeof glibcVersion === "string" && glibcVersion.length > 0 ? "gnu" : "musl";
}

function platformTriple() {
  const { platform, arch } = process;
  if (platform === "linux") return `linux-${arch}-${linuxLibc()}`;
  if (platform === "win32") return `win32-${arch}-msvc`;
  if (platform === "darwin") return `darwin-${arch}`;
  if (platform === "freebsd") return `freebsd-${arch}`;
  return `${platform}-${arch}`;
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function crateDirectories() {
  if (!existsSync(cratesDirectory)) return [];
  return readdirSync(cratesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(cratesDirectory, entry.name));
}

function sourceFiles() {
  const files = [
    join(repositoryRoot, "Cargo.toml"),
    join(repositoryRoot, "Cargo.lock"),
    join(packageDirectory, "package.json"),
    ...collectFiles(join(cratesDirectory, "silent-node", "src")),
    ...collectFiles(join(cratesDirectory, "silent-transform", "src")),
  ];
  for (const directory of crateDirectories()) {
    files.push(join(directory, "build.rs"), join(directory, "Cargo.toml"));
  }
  return files.filter((path) => existsSync(path));
}

function sourceHash(paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    if (!existsSync(path)) continue;
    hash.update(path.slice(repositoryRoot.length));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function recordedHash(hashPath) {
  if (!existsSync(hashPath)) return "";
  return readFileSync(hashPath, "utf8").trim();
}

function artifactState(triple) {
  if (!existsSync(nativeDirectory)) {
    return { artifacts: [], missing: [`${nativeDirectory} does not exist`] };
  }
  const entries = readdirSync(nativeDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const nodeArtifacts = entries
    .filter((name) => name.endsWith(".node") && name.includes(triple))
    .map((name) => join(nativeDirectory, name));
  const preferredNode = join(nativeDirectory, `index.${triple}.node`);
  const nodeArtifact = existsSync(preferredNode)
    ? preferredNode
    : nodeArtifacts.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
  const artifacts = [join(nativeDirectory, "index.js"), join(nativeDirectory, "index.d.ts")]
    .filter((path) => existsSync(path));
  if (nodeArtifact !== undefined) artifacts.push(nodeArtifact);
  const missing = [
    ...["index.js", "index.d.ts"]
      .map((name) => join(nativeDirectory, name))
      .filter((path) => !existsSync(path)),
    ...(nodeArtifact === undefined ? [`native/*${triple}*.node`] : []),
  ];
  return { artifacts, missing };
}

function napiCliPath() {
  const packageJsonPath = require.resolve("@napi-rs/cli/package.json");
  const packageJson = require(packageJsonPath);
  const cli = packageJson.bin?.napi ?? packageJson.bin;
  if (typeof cli !== "string") {
    throw new Error("@napi-rs/cli: unable to resolve the napi binary");
  }
  return resolve(dirname(packageJsonPath), cli);
}

const force = process.argv.slice(2).some((argument) => argument === "--force" || argument === "-f");
const triple = platformTriple();
const state = artifactState(triple);
const sources = sourceFiles();
const hashPath = join(nativeDirectory, `.build-hash-${triple}`);
const hash = sourceHash(sources);
const stale = state.missing.length > 0 || recordedHash(hashPath) !== hash;

if (!force && !stale) {
  console.log(`[build-native] ${triple} artifacts are up to date, skipping napi build`);
  process.exit(0);
}

const reason = force
  ? "forced"
  : state.missing.length > 0
    ? `missing ${state.missing.join(", ")}`
    : "sources changed";
console.log(`[build-native] building ${triple}: ${reason}`);

const result = spawnSync(
  process.execPath,
  [
    napiCliPath(),
    "build",
    "--release",
    "--platform",
    "--manifest-path",
    "../../crates/silent-node/Cargo.toml",
    "--output-dir",
    "native",
  ],
  { cwd: packageDirectory, stdio: "inherit", env: process.env },
);

if (result.error) {
  console.error(`[build-native] ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const built = artifactState(triple);
if (built.missing.length > 0) {
  console.error(`[build-native] napi build finished but artifacts are missing: ${built.missing.join(", ")}`);
  process.exit(1);
}

writeFileSync(hashPath, `${hash}\n`);
process.exit(0);
