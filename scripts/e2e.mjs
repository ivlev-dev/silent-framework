import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const counterDir = join(root, "examples", "counter");
const todoDir = join(root, "examples", "todo");

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

function chromiumEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  delete env["LD_PRELOAD"];
  return env;
}

async function startServer(directory) {
  process.chdir(directory);
  const server = await createServer({
    configFile: join(directory, "vite.config.ts"),
    root: directory,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || typeof address === "string") {
    throw new Error("Не удалось определить порт Vite");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    close: async () => {
      await server.close();
    },
  };
}

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function runCounter(browser) {
  const viewFile = join(counterDir, "src", "counter.tsx");
  const vmFile = join(counterDir, "src", "counter.vm.ts");
  const viewSource = readFileSync(viewFile, "utf8");
  const vmSource = readFileSync(vmFile, "utf8");
  const server = await startServer(counterDir);
  const page = await browser.newPage();
  const errors = collectErrors(page);

  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.locator(".value").waitFor();
    assert.equal((await page.locator(".value").textContent())?.trim(), "0");
    assert.equal(
      await page.title(),
      "Silent Framework: счётчик",
      "заголовок страницы не установлен из view",
    );

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
  } finally {
    writeFileSync(viewFile, viewSource);
    writeFileSync(vmFile, vmSource);
    await page.waitForTimeout(300);
    await page.close();
    await server.close();
  }
}

async function addTodo(page, text) {
  await page.locator(".draft").fill(text);
  await page.getByRole("button", { name: "Добавить" }).click();
}

async function runTodo(browser) {
  const server = await startServer(todoDir);
  const page = await browser.newPage();
  const errors = collectErrors(page);

  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.locator(".todo").waitFor();
    assert.equal(await page.title(), "Silent Framework: задачи");
    assert.equal(await page.locator(".items li").count(), 0);

    await page.locator(".draft").fill("первая");
    await page.locator(".draft").press("Enter");
    await page.locator(".items li").first().waitFor();
    await addTodo(page, "вторая");
    assert.equal(await page.locator(".items li").count(), 2);
    assert.equal((await page.locator(".remaining").textContent())?.trim(), "2");
    assert.equal((await page.locator(".completed").textContent())?.trim(), "0");

    await page.locator(".items li").first().locator("input").check();
    assert.equal((await page.locator(".completed").textContent())?.trim(), "1");
    assert.equal((await page.locator(".remaining").textContent())?.trim(), "1");
    assert.equal(
      (await page.locator(".items li").first().getAttribute("class"))?.trim(),
      "done",
    );

    await page.locator(".filters .chip").filter({ hasText: /^Активные$/ }).click();
    assert.equal(await page.locator(".items li").count(), 1);
    assert.equal(
      (await page.locator(".items li .title").first().textContent())?.trim(),
      "вторая",
    );

    await page.locator(".filters .chip").filter({ hasText: /^Выполненные$/ }).click();
    assert.equal(await page.locator(".items li").count(), 1);
    assert.equal(
      (await page.locator(".items li .title").first().textContent())?.trim(),
      "первая",
    );

    await page.locator(".filters .chip").filter({ hasText: /^Все$/ }).click();
    assert.equal(await page.locator(".items li").count(), 2);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".items li").first().waitFor();
    assert.equal(await page.locator(".items li").count(), 2);
    assert.equal((await page.locator(".completed").textContent())?.trim(), "1");

    await page.locator(".items li").first().locator(".remove").click();
    assert.equal(await page.locator(".items li").count(), 1);
    assert.equal((await page.locator(".completed").textContent())?.trim(), "0");

    await page.locator(".filters .chip").filter({ hasText: /^Выполненные$/ }).click();
    assert.equal(await page.locator(".items li").count(), 0);
    await page.locator(".filters .chip").filter({ hasText: /^Все$/ }).click();
    await page.locator(".items li").first().locator("input").check();
    await page.getByRole("button", { name: "Очистить выполненные" }).click();
    assert.equal(await page.locator(".items li").count(), 0);
    assert.equal((await page.locator(".remaining").textContent())?.trim(), "0");

    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await server.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox"],
    env: chromiumEnv(),
  });
  try {
    await runCounter(browser);
    await runTodo(browser);
    console.log("e2e: ok");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
