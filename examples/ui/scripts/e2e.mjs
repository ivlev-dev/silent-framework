import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  launchBrowser,
  selectBrowserName,
} from "../../../scripts/lib/browser.mjs";

const uiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = join(uiDir, "screenshots");
const browserName = selectBrowserName();
const backend = process.env.SILENT_UI_BACKEND ?? "http://127.0.0.1:6108";

let devServer = null;
let browser = null;
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function apiAvailable() {
  try {
    const response = await fetch(`${backend}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startDevServer() {
  const previousCwd = process.cwd();
  process.chdir(uiDir);
  try {
    devServer = await createServer({
      configFile: join(uiDir, "vite.config.ts"),
      root: uiDir,
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0 },
    });
    await devServer.listen();
  } catch (error) {
    process.chdir(previousCwd);
    throw error;
  }
  const address = devServer.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("Не удалось определить порт Vite");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      try {
        await devServer?.close();
      } finally {
        process.chdir(previousCwd);
      }
    },
  };
}

function observe(page) {
  const errors = [];
  const apiRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/projects")) {
      apiRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`HTTP ${String(response.status())}: ${response.url()}`);
    }
  });
  return { errors, apiRequests };
}

async function waitForProjects(page) {
  await page.waitForSelector(".sui-data-table[data-loaded]", { timeout: 10_000 });
  await page.waitForFunction(
    () => document.querySelector(".sui-data-table")?.hasAttribute("data-loading") === false,
    undefined,
    { timeout: 10_000 },
  );
}

async function gotoRoute(page, base, path, heading, navLabel) {
  const { errors } = observe(page);
  await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 15_000 });
  await page.waitForSelector("h2", { timeout: 10_000 });
  const title = await page.locator("h2").first().innerText();
  check(title === heading, `${path}: ожидался заголовок «${heading}», получен «${title}»`);
  const active = await page
    .locator(".sui-navigation-rail__button[aria-current='page']")
    .first()
    .innerText()
    .catch(() => "");
  check(
    active.includes(navLabel),
    `${path}: активный пункт rail «${active}», ожидался «${navLabel}»`,
  );
  check(errors.length === 0, `${path}: console errors: ${errors.join(" | ")}`);
  return errors;
}

async function main() {
  if (!(await apiAvailable())) {
    throw new Error(
      `Backend недоступен на ${backend}. Запустите examples/ui/server на порту 6108.`,
    );
  }
  mkdirSync(screenshots, { recursive: true });
  const server = await startDevServer();
  const launched = await launchBrowser(browserName);
  browser = launched.browser;

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    for (const [path, heading, navLabel] of [
      ["/", "Dashboard", "Dashboard"],
      ["/projects", "Проекты", "Проекты"],
      ["/team", "Команда", "Команда"],
      ["/settings", "Настройки", "Настройки"],
    ]) {
      await gotoRoute(page, server.url, path, heading, navLabel);
      console.log(`маршрут ${path}: ok`);
    }

    const network = observe(page);
    await page.goto(`${server.url}/projects`, { waitUntil: "load" });
    await waitForProjects(page);
    await page.waitForTimeout(3000);
    check(
      network.apiRequests.length <= 2,
      `/projects: ${String(network.apiRequests.length)} запросов к /api/projects за 3 с`,
    );
    check(network.errors.length === 0, `/projects: console errors: ${network.errors.join(" | ")}`);
    const rows = await page.locator("tbody tr").count();
    check(rows === 10, `/projects: ожидалось 10 строк, получено ${String(rows)}`);

    await page.goto(`${server.url}/projects?q=zzz-no-such&status=active&page=1`, {
      waitUntil: "load",
    });
    await waitForProjects(page);
    const searchValue = await page.locator(".app-field--search input").inputValue();
    check(searchValue === "zzz-no-such", "deep link: не восстановлен q");
    check(page.url().includes("status=active"), "deep link: не сохранён status");
    const emptyText = await page.locator(".sui-data-table").innerText();
    check(
      emptyText.includes("Ничего не найдено") || emptyText.includes("0 проектов"),
      "deep link: фильтр не применился к данным",
    );

    await page.goto(`${server.url}/projects?page=2&pageSize=10`, { waitUntil: "load" });
    await waitForProjects(page);
    check(page.url().includes("page=2"), "пагинация: page=2 не сохранилась в URL");
    check(
      (await page.locator("tbody tr").count()) === 10,
      "пагинация: вторая страница пуста",
    );

    await page.goto(`${server.url}/projects`, { waitUntil: "load" });
    await waitForProjects(page);
    await page.locator(".app-field--search input").fill("zzz-no-such");
    await page.getByRole("button", { name: "Применить" }).click();
    await page.waitForFunction(
      () => location.search.includes("q=zzz-no-such"),
      undefined,
      { timeout: 10_000 },
    );
    const filteredUrl = page.url();
    await page.getByRole("button", { name: "Команда" }).first().click();
    await page.waitForFunction(() => location.pathname === "/team", undefined, {
      timeout: 10_000,
    });
    await page.goBack();
    await page.waitForFunction(() => location.pathname === "/projects", undefined, {
      timeout: 10_000,
    });
    check(
      page.url() === filteredUrl,
      `back: ожидался ${filteredUrl}, получен ${page.url()}`,
    );
    const restored = await page.locator(".app-field--search input").inputValue();
    check(restored === "zzz-no-such", "back: фильтр не восстановлен");
    await page.goForward();
    await page.waitForFunction(() => location.pathname === "/team", undefined, {
      timeout: 10_000,
    });
    console.log("навигация и фильтры: ok");

    await page.goto(`${server.url}/#/projects`, { waitUntil: "load" });
    await page.waitForFunction(() => location.pathname === "/projects", undefined, {
      timeout: 10_000,
    });
    check(!page.url().includes("#/"), "legacy hash не перенаправлен на /projects");
    check(
      (await page.locator("h2").first().innerText()) === "Проекты",
      "legacy hash: не открылась страница проектов",
    );

    await page.goto(`${server.url}/missing-route`, { waitUntil: "load" });
    await page.waitForFunction(() => location.pathname === "/", undefined, {
      timeout: 10_000,
    });
    check(
      (await page.locator("h2").first().innerText()) === "Dashboard",
      "404: не выполнено перенаправление на dashboard",
    );
    console.log("legacy hash и 404: ok");

    for (const width of [360, 840, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 600 ? 780 : 1000 });
      await page.goto(`${server.url}/projects`, { waitUntil: "load" });
      await waitForProjects(page);
      await page.screenshot({
        path: join(screenshots, `projects-${String(width)}.png`),
        fullPage: true,
      });
      await page.goto(`${server.url}/`, { waitUntil: "load" });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: join(screenshots, `dashboard-${String(width)}.png`),
        fullPage: true,
      });
    }
    console.log("скриншоты 360/840/1440/1920: ok");
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close();
  }

  if (failures.length > 0) {
    console.error("\nОшибки e2e:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nE2E примеров UI пройден.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
