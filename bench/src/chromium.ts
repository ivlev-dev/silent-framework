import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";

export function findChrome(): string {
  const base = join(homedir(), ".cache", "ms-playwright");
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith("chromium-")) {
      continue;
    }
    for (const candidate of [
      join(base, entry, "chrome-linux64", "chrome"),
      join(base, entry, "chrome-linux", "chrome"),
    ]) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error("Chromium не найден в ~/.cache/ms-playwright");
}

function chromiumEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  delete env["LD_PRELOAD"];
  return env;
}

export function launchChromium(): Promise<Browser> {
  return chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox"],
    env: chromiumEnv(),
  });
}
