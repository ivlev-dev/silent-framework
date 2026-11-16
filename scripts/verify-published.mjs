import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dirs = ["reactivity", "di", "core", "swc", "vite", "server", "silent"];
const attempts = Number(process.env.PUBLISH_ATTEMPTS ?? "10");
const delayMs = Number(process.env.PUBLISH_DELAY_MS ?? "10000");
const timeoutMs = Number(process.env.PUBLISH_TIMEOUT_MS ?? "10000");

function readManifest(dir) {
  const path = join(root, "packages", dir, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error(`В ${path} нет name или version`);
  }
  return { name: manifest.name, version: manifest.version };
}

async function publishedVersion(packageName) {
  const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags?t=${String(Date.now())}`;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return typeof data.latest === "string" ? data.latest : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const expected = dirs.map(readManifest);

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const results = await Promise.all(
    expected.map(async (entry) => ({
      ...entry,
      actual: await publishedVersion(entry.name),
    })),
  );
  const mismatches = results.filter((entry) => entry.actual !== entry.version);
  if (mismatches.length === 0) {
    for (const entry of results) {
      console.log(`опубликован ${entry.name}@${entry.version}`);
    }
    console.log("published: ok");
    process.exit(0);
  }
  console.warn(
    `попытка ${String(attempt)}/${String(attempts)}: не совпало ${String(mismatches.length)} из ${String(results.length)}`,
  );
  for (const entry of mismatches) {
    console.warn(`  ${entry.name}: ожидалось ${entry.version}, в реестре ${entry.actual ?? "нет"}`);
  }
  if (attempt < attempts) {
    await sleep(delayMs);
  }
}

console.error("published: в реестре не все пакеты нужной версии");
process.exit(1);
