import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = ["reactivity", "di", "core", "swc", "vite", "server", "router", "validation", "validation-vite", "protocol", "protocol-vite", "form", "silent"];
const phpProtocolPath = "php/src/Protocol.php";
// Единственная версия в PHP-пакете: composer.json поле `version` не содержит
// (Packagist берёт версию из тега), поэтому сверяем константу вручную.
const phpVersionPattern = /public const VERSION = '(\d+\.\d+\.\d+)';/;

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

function readPhpVersion() {
  const match = readText(phpProtocolPath).match(phpVersionPattern);
  if (match === null) {
    console.error(`В ${phpProtocolPath} не найден public const VERSION = 'X.Y.Z';`);
    process.exit(1);
  }
  return match[1];
}

/**
 * Для библиотеки версия берётся из git-тега: поле `version` в composer.json
 * при публикации на Packagist игнорируется и только создаёт второй источник правды.
 */
function checkComposerManifest() {
  const manifest = JSON.parse(readText("php/composer.json"));
  if (Object.hasOwn(manifest, "version")) {
    console.error(
      "php/composer.json содержит поле version: уберите его — Packagist берёт версию из тега, "
        + `а источник правды здесь — ${phpProtocolPath}.`,
    );
    process.exit(1);
  }
}

function internalRange(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    console.error(`Некорректная версия: ${version}`);
    process.exit(1);
  }
  return `>=${match[1]}.${match[2]}.0 <${match[1]}.${Number(match[2]) + 1}.0`;
}

/**
 * `pnpm install --frozen-lockfile` в CI сверяет lockfile с манифестами.
 * Если внутренние диапазоны обновили без `pnpm install --lockfile-only`,
 * релиз падает уже на установке — лучше поймать это локально.
 */
function checkLockfile(version) {
  if (!existsSync(join(root, "pnpm-lock.yaml"))) {
    return;
  }
  const expected = internalRange(version);
  const stale = [];
  const lines = readText("pnpm-lock.yaml").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/specifier:\s*'?(>=\d+\.\d+\.\d+ <\d+\.\d+\.\d+)'?/);
    if (match !== null && match[1] !== expected) {
      stale.push(`${index + 1}: ${match[1]} (ожидается ${expected})`);
    }
  }
  if (stale.length > 0) {
    console.error("pnpm-lock.yaml устарел относительно версии пакетов:");
    for (const entry of stale) {
      console.error(entry);
    }
    console.error("Выполните `pnpm install --lockfile-only` и закоммитьте lockfile.");
    process.exit(1);
  }
}

const entries = [];
for (const name of packages) {
  const path = `packages/${name}/package.json`;
  const manifest = JSON.parse(readText(path));
  entries.push({ path, version: manifest.version });
}
entries.push({ path: "Cargo.toml", version: readCargoVersion() });
entries.push({ path: phpProtocolPath, version: readPhpVersion() });
checkComposerManifest();

const versions = new Set(entries.map((entry) => entry.version));
if (versions.size !== 1) {
  console.error("Версии расходятся:");
  for (const entry of entries) {
    console.error(`${entry.path}: ${entry.version}`);
  }
  process.exit(1);
}

const version = entries[0].version;
checkLockfile(version);
const explicitTag = process.argv[2];
const tag =
  explicitTag ??
  (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
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
