import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = ["reactivity", "di", "core", "swc", "vite", "server", "router", "validation", "validation-vite", "form", "silent"];
const semverPattern = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readText(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function writeText(relativePath, content) {
  writeFileSync(join(root, relativePath), content);
}

function readManifest(relativePath) {
  return JSON.parse(readText(relativePath));
}

function manifestPath(name) {
  return `packages/${name}/package.json`;
}

function readCargoVersion() {
  const lines = readText("Cargo.toml").split(/\r?\n/);
  let inWorkspacePackage = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*\[/.test(line)) {
      inWorkspacePackage = line.trim() === "[workspace.package]";
      continue;
    }
    if (!inWorkspacePackage) {
      continue;
    }
    const match = line.match(/^\s*version\s*=\s*"([^"]+)"/);
    if (match) {
      return { version: match[1], index };
    }
  }
  fail("В Cargo.toml не найден [workspace.package] version");
}

function writeCargoVersion(version) {
  const text = readText("Cargo.toml");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const current = readCargoVersion();
  const indent = lines[current.index].match(/^\s*/)[0];
  lines[current.index] = `${indent}version = "${version}"`;
  writeText("Cargo.toml", lines.join(eol));
}

function readCurrentVersion() {
  const cargo = readCargoVersion().version;
  const mismatches = [];
  for (const name of packages) {
    const manifest = readManifest(manifestPath(name));
    if (manifest.version !== cargo) {
      mismatches.push(`${manifestPath(name)}: ${manifest.version} != ${cargo}`);
    }
  }
  if (mismatches.length > 0) {
    console.warn(
      `Версии пакетов расходятся, будут синхронизированы:\n${mismatches.join("\n")}`,
    );
  }
  return cargo;
}

function bumpVersion(version, kind) {
  const match = version.match(semverPattern);
  if (!match) {
    fail(`Некорректная текущая версия: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (kind === "major") {
    return `${major + 1}.0.0`;
  }
  if (kind === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function changelogWithVersion(version) {
  const text = readText("CHANGELOG.md");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const heading = `## ${version}`;
  if (lines.some((line) => line.trim() === heading)) {
    return { text, changed: false };
  }
  const titleIndex = lines.findIndex((line) => line.trim() === "# Changelog");
  if (titleIndex === -1) {
    return {
      text: `# Changelog${eol}${eol}${heading}${eol}${eol}${text}`,
      changed: true,
    };
  }
  const unreleasedIndex = lines.findIndex(
    (line) => line.trim() === "## Unreleased",
  );
  if (unreleasedIndex !== -1) {
    const nextHeading = lines.findIndex(
      (line, index) => index > unreleasedIndex && /^##\s/.test(line.trim()),
    );
    const end = nextHeading === -1 ? lines.length : nextHeading;
    const notes = lines
      .slice(unreleasedIndex + 1, end)
      .join(eol)
      .replace(/^\s*\n/, "")
      .replace(/\s+$/, "");
    const head = lines.slice(0, titleIndex + 1);
    const tail = nextHeading === -1 ? [] : lines.slice(nextHeading);
    const result = [
      ...head,
      "",
      heading,
      "",
      ...(notes.length === 0 ? [] : [notes, ""]),
      "## Unreleased",
      "",
      ...tail,
    ];
    return { text: result.join(eol), changed: true };
  }
  const rest = lines.slice(titleIndex + 1);
  const body = rest[0]?.trim() === "" ? rest.slice(1) : rest;
  const result = [
    ...lines.slice(0, titleIndex + 1),
    "",
    heading,
    "",
    ...body,
  ];
  return { text: result.join(eol), changed: true };
}

function internalRange(version) {
  const match = version.match(semverPattern);
  if (!match) {
    fail(`Некорректная версия: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return `>=${major}.${minor}.0 <${major}.${minor + 1}.0`;
}

function isInternalRange(value) {
  return (
    typeof value === "string" && /^>=\d+\.\d+\.\d+ <\d+\.\d+\.\d+$/.test(value)
  );
}

function updateInternalRanges(manifest, version) {
  const next = internalRange(version);
  const changed = [];
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const block = manifest[field];
    if (block === null || typeof block !== "object") {
      continue;
    }
    for (const [name, value] of Object.entries(block)) {
      if (!name.startsWith("@ivlev-dev/") || !isInternalRange(value)) {
        continue;
      }
      if (value !== next) {
        block[name] = next;
        changed.push(`${name}: ${value} -> ${next}`);
      }
    }
  }
  return changed;
}

function writePackages(version) {
  for (const name of packages) {
    const path = manifestPath(name);
    const manifest = readManifest(path);
    manifest.version = version;
    updateInternalRanges(manifest, version);
    writeText(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

function parseArguments(argv) {
  const dryRun = argv.includes("--dry-run");
  const rest = argv.filter((argument) => argument !== "--dry-run");
  if (rest.length === 1 && ["patch", "minor", "major"].includes(rest[0])) {
    return { dryRun, kind: rest[0] };
  }
  if (rest.length === 1 && rest[0].startsWith("--set=")) {
    return { dryRun, set: rest[0].slice("--set=".length) };
  }
  if (rest.length === 2 && rest[0] === "--set") {
    return { dryRun, set: rest[1] };
  }
  fail(
    "Использование: node scripts/version.mjs patch|minor|major|--set <версия> [--dry-run]",
  );
}

const options = parseArguments(process.argv.slice(2));
const currentVersion = readCurrentVersion();
let nextVersion;
if (options.kind) {
  nextVersion = bumpVersion(currentVersion, options.kind);
} else {
  const match = options.set.match(semverPattern);
  if (!match) {
    fail(`Некорректная версия: ${options.set}. Ожидается формат X.Y.Z`);
  }
  nextVersion = options.set;
}

const changelog = changelogWithVersion(nextVersion);

console.log(`Текущая версия: ${currentVersion}`);
console.log(`Новая версия: ${nextVersion}`);

if (options.dryRun) {
  console.log("Режим dry-run: файлы не изменяются.");
  for (const name of packages) {
    const manifest = readManifest(manifestPath(name));
    const rangeChanges = updateInternalRanges(
      structuredClone(manifest),
      nextVersion,
    );
    console.log(`${manifestPath(name)}: ${currentVersion} -> ${nextVersion}`);
    for (const change of rangeChanges) {
      console.log(`  диапазон ${change}`);
    }
  }
  console.log(`Cargo.toml: ${currentVersion} -> ${nextVersion}`);
  console.log(
    changelog.changed
      ? `CHANGELOG.md: будет добавлен заголовок ## ${nextVersion}`
      : `CHANGELOG.md: заголовок ## ${nextVersion} уже есть`,
  );
  process.exit(0);
}

writePackages(nextVersion);
writeCargoVersion(nextVersion);
if (changelog.changed) {
  writeText("CHANGELOG.md", changelog.text);
}
console.log(
  changelog.changed
    ? `Версия обновлена до ${nextVersion}, заголовок добавлен в CHANGELOG.md`
    : `Версия обновлена до ${nextVersion}, заголовок уже был в CHANGELOG.md`,
);
