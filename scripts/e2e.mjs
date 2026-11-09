import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const example = join(root, "examples", "counter");
const viewFile = join(example, "src", "counter.tsx");
const vmFile = join(example, "src", "counter.vm.ts");
const viewSource = readFileSync(viewFile, "utf8");
const vmSource = readFileSync(vmFile, "utf8");

function findChrome() {
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

async function main() {
  process.chdir(example);
  const server = await createServer({
    configFile: join(example, "vite.config.ts"),
    root: example,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || typeof address === "string") {
    throw new Error("Не удалось определить порт Vite");
  }
  const url = `http://127.0.0.1:${address.port}/`;

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".value").waitFor();
    assert.equal((await page.locator(".value").textContent())?.trim(), "0");

    await page.getByRole("button", { name: "+" }).click();
    assert.equal((await page.locator(".value").textContent())?.trim(), "2");
    assert.equal((await page.locator(".double").textContent())?.trim(), "4");

    await page.getByRole("button", { name: "Добавить" }).click();
    await page.locator(".items li").first().waitFor();
    assert.equal((await page.locator(".items li").first().textContent())?.trim(), "item-1");

    writeFileSync(
      viewFile,
      viewSource.replace("<h2>Счётчик</h2>", "<h2>Счётчик E2E</h2>"),
    );
    await page.getByRole("heading", { name: "Счётчик E2E" }).waitFor();
    assert.equal((await page.locator(".value").textContent())?.trim(), "2");
    assert.equal((await page.locator(".items li").first().textContent())?.trim(), "item-1");

    writeFileSync(
      vmFile,
      vmSource.replace("this.count += step;", "this.count += step + 5;"),
    );
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "+" }).click();
    assert.equal((await page.locator(".value").textContent())?.trim(), "9");
    assert.equal((await page.locator(".items li").first().textContent())?.trim(), "item-1");

    assert.deepEqual(errors, []);
    console.log("e2e: ok");
  } finally {
    writeFileSync(viewFile, viewSource);
    writeFileSync(vmFile, vmSource);
    await page.waitForTimeout(300);
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
