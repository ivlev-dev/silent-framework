import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dirs = ["reactivity", "di", "core", "swc", "vite", "server", "router", "validation", "validation-vite", "protocol", "protocol-vite", "form", "silent"];
const attempts = Number(process.env.PUBLISH_ATTEMPTS ?? "30");
const delayMs = Number(process.env.PUBLISH_DELAY_MS ?? "15000");
const timeoutMs = Number(process.env.PUBLISH_TIMEOUT_MS ?? "15000");

function readManifest(dir) {
  const path = join(root, "packages", dir, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error(`В ${path} нет name или version`);
  }
  return { name: manifest.name, version: manifest.version };
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function publishedState(packageName, version) {
  const stamp = String(Date.now());
  const encoded = encodeURIComponent(packageName);
  const tags = await fetchJson(`https://registry.npmjs.org/-/package/${encoded}/dist-tags?t=${stamp}`);
  const packument = await fetchJson(`https://registry.npmjs.org/${encoded}?t=${stamp}`);
  return {
    latest: typeof tags?.latest === "string" ? tags.latest : null,
    hasVersion:
      packument !== null &&
      typeof packument === "object" &&
      packument.versions !== null &&
      typeof packument.versions === "object" &&
      Object.prototype.hasOwnProperty.call(packument.versions, version),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const expected = dirs.map(readManifest);

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const results = await Promise.all(
    expected.map(async (entry) => ({
      ...entry,
      state: await publishedState(entry.name, entry.version),
    })),
  );
  const missing = results.filter((entry) => !entry.state.hasVersion);
  if (missing.length === 0) {
    for (const entry of results) {
      const latest = entry.state.latest === entry.version ? "latest" : `latest=${entry.state.latest ?? "нет"}`;
      console.log(`опубликован ${entry.name}@${entry.version} (${latest})`);
    }
    console.log("published: ok");
    process.exit(0);
  }
  if (attempt === 1 || attempt % 5 === 0) {
    console.warn(
      `попытка ${String(attempt)}/${String(attempts)}: нет версии у ${String(missing.length)} из ${String(results.length)}`,
    );
    for (const entry of missing) {
      console.warn(`  ${entry.name}: ожидалось ${entry.version}, latest=${entry.state.latest ?? "нет"}`);
    }
  }
  if (attempt < attempts) {
    await sleep(delayMs);
  }
}

console.error("published: в реестре не все пакеты нужной версии");
process.exit(1);
