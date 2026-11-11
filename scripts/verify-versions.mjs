import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = ["reactivity", "di", "core", "swc", "vite", "server", "silent"];

function readText(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readCargoVersion() {
  const lines = readText("Cargo.toml").split(/\r?\n/);
  let inWorkspacePackage = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      inWorkspacePackage = line.trim() === "[workspace.package]";
      continue;
    }
    if (!inWorkspacePackage) {
      continue;
    }
    const match = line.match(/^\s*version\s*=\s*"([^"]+)"/);
    if (match) {
      return match[1];
    }
  }
  console.error("В Cargo.toml не найден [workspace.package] version");
  process.exit(1);
}

function normalizeTag(tag) {
  return tag.replace(/^v/, "");
}

const entries = [];
for (const name of packages) {
  const path = `packages/${name}/package.json`;
  const manifest = JSON.parse(readText(path));
  entries.push({ path, version: manifest.version });
}
entries.push({ path: "Cargo.toml", version: readCargoVersion() });

const versions = new Set(entries.map((entry) => entry.version));
if (versions.size !== 1) {
  console.error("Версии расходятся:");
  for (const entry of entries) {
    console.error(`${entry.path}: ${entry.version}`);
  }
  process.exit(1);
}

const version = entries[0].version;
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (tag) {
  const expected = normalizeTag(tag);
  if (expected !== version) {
    console.error(
      `Тег ${tag} (${expected}) не совпадает с версией пакетов ${version}`,
    );
    process.exit(1);
  }
  console.log(`Тег ${tag} совпадает с версией ${version}`);
} else {
  console.log(`Версии согласованы: ${version}`);
}
