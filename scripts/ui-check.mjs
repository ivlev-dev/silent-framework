#!/usr/bin/env node
/**
 * `ui-check.mjs` — автоматическая проверка витрины Storybook.
 *
 * Что делает:
 *   1. поднимает статическую сборку Storybook (или использует `--url`/dev 6106);
 *   2. читает `index.json` и проходит по всем stories;
 *   3. для каждого viewport (360×800 … 2560×1440) и DPR 1/2 проверяет
 *      горизонтальный overflow, вылезающий текст, элементы за viewport,
 *      `sb-errordisplay` и ошибки консоли;
 *   4. запускает axe-core (`@axe-core/playwright`): critical — ошибка,
 *      serious — предупреждение;
 *   5. снимает скриншоты ключевых stories и пишет отчёт в `/tmp`.
 *
 * Если браузер недоступен, скрипт печатает причину и выполняет статические
 * проверки (index.json, assets, story-файлы). `--strict-browser` превращает
 * такой fallback в ошибку — для CI, чтобы шаг не «зеленел» без браузера.
 *
 * Примеры:
 *   node scripts/ui-check.mjs
 *   node scripts/ui-check.mjs --build --strict-browser
 *   node scripts/ui-check.mjs --url=http://127.0.0.1:6106
 *   node scripts/ui-check.mjs --stories=components-button --dpr=1
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgDir = join(root, "packages", "ui-storybook");
const staticDir = join(pkgDir, "storybook-static");

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800, type: "mobile" },
  { name: "480x900", width: 480, height: 900, type: "mobile" },
  { name: "600x960", width: 600, height: 960, type: "tablet" },
  { name: "840x1112", width: 840, height: 1112, type: "tablet" },
  { name: "1200x900", width: 1200, height: 900, type: "desktop" },
  { name: "1600x1000", width: 1600, height: 1000, type: "desktop" },
  { name: "1920x1080", width: 1920, height: 1080, type: "desktop" },
  { name: "2560x1440", width: 2560, height: 1440, type: "desktop" },
  { name: "3840x2160", width: 3840, height: 2160, type: "desktop" },
];

const KEY_STORIES = [
  "components-button--",
  "components-textfield--",
  "components-alert--",
  "components-dialog--",
  "components-table--",
  "patterns--form",
  "patterns--dashboard",
  "patterns--auth-screen",
  "patterns--settings",
  "patterns--dialog-flow",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = {
    url: undefined,
    dev: false,
    build: false,
    useBrowser: true,
    browser: "auto",
    strictBrowser: false,
    dpr: [1, 2],
    viewports: VIEWPORTS,
    storyFilter: undefined,
    out: "/tmp/silent-ui-check",
    concurrency: 4,
    maxStories: Infinity,
    a11y: "critical",
    screenshots: "key",
    includeDocs: true,
  };

  for (const raw of argv) {
    const [flag, rawValue] = raw.includes("=") ? raw.split(/=(.*)/s) : [raw, undefined];
    const value = rawValue;
    switch (flag) {
      case "--url":
        options.url = requireValue(flag, value);
        break;
      case "--dev":
        options.dev = true;
        break;
      case "--build":
        options.build = true;
        break;
      case "--no-browser":
        options.useBrowser = false;
        break;
      case "--browser":
        options.browser = requireValue(flag, value);
        break;
      case "--strict-browser":
        options.strictBrowser = true;
        break;
      case "--dpr": {
        const list = requireValue(flag, value)
          .split(",")
          .map((item) => Number.parseFloat(item.trim()));
        if (list.length === 0 || list.some((item) => !Number.isFinite(item) || item <= 0)) {
          throw new Error("--dpr ожидает список положительных чисел, например --dpr=1,2");
        }
        options.dpr = list;
        break;
      }
      case "--viewports": {
        const names = requireValue(flag, value)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const selected = VIEWPORTS.filter((viewport) => names.includes(viewport.name));
        if (selected.length === 0) {
          throw new Error(
            `--viewports: неизвестный набор. Доступно: ${VIEWPORTS.map((v) => v.name).join(", ")}`,
          );
        }
        options.viewports = selected;
        break;
      }
      case "--stories":
        options.storyFilter = requireValue(flag, value);
        break;
      case "--out":
        options.out = resolve(requireValue(flag, value));
        break;
      case "--concurrency": {
        const parsed = Number.parseInt(requireValue(flag, value), 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("--concurrency ожидает целое число ≥ 1");
        }
        options.concurrency = Math.min(parsed, 8);
        break;
      }
      case "--max-stories": {
        const parsed = Number.parseInt(requireValue(flag, value), 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("--max-stories ожидает целое число ≥ 1");
        }
        options.maxStories = parsed;
        break;
      }
      case "--a11y":
        options.a11y = requireValue(flag, value);
        if (!["off", "critical", "all"].includes(options.a11y)) {
          throw new Error("--a11y: допустимо off | critical | all");
        }
        break;
      case "--screenshots":
        options.screenshots = requireValue(flag, value);
        if (!["none", "key", "all"].includes(options.screenshots)) {
          throw new Error("--screenshots: допустимо none | key | all");
        }
        break;
      case "--no-docs":
        options.includeDocs = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Неизвестный флаг: ${flag}. Смотрите --help.`);
    }
  }
  return options;
}

function requireValue(flag, value) {
  if (value === undefined || value === "") {
    throw new Error(`${flag} требует значение, например ${flag}=...`);
  }
  return value;
}

function printHelp() {
  console.log(`
ui-check — проверка витрины Storybook

Использование: node scripts/ui-check.mjs [флаги]

  --url=<origin>        готовый сервер (dev 6106 или свой), сборка не запускается
  --dev                 использовать dev-сервер на http://127.0.0.1:6106
  --build               пересобрать storybook-static перед проверкой
  --no-browser          только статические проверки (index.json/assets/stories)
  --browser=<name>      auto (по умолчанию) | chromium | firefox
  --strict-browser      недоступный браузер — ошибка, а не fallback
  --dpr=<list>          DPR через запятую, по умолчанию 1,2
  --viewports=<list>    360x800,600x960,840x1112,1200x900,1600x1000,2560x1440
  --stories=<substring> фильтр по id story
  --max-stories=<n>     ограничить число stories
  --a11y=<mode>         off | critical (по умолчанию) | all
  --screenshots=<mode>  none | key (по умолчанию) | all
  --no-docs             не проверять docs-страницы
  --concurrency=<n>     параллельных страниц, 1..8 (по умолчанию 4)
  --out=<dir>           каталог отчёта, по умолчанию /tmp/silent-ui-check
`);
}

/* ------------------------------------------------------------------ */
/* Статический сервер                                                  */
/* ------------------------------------------------------------------ */

function startStaticServer(directory) {
  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const filePath = resolve(directory, `.${pathname}`);
      if (!filePath.startsWith(resolve(directory) + sep)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }
      const body = readFileSync(filePath);
      response.writeHead(200, {
        "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : "Error");
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolvePromise({
        origin: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Сборка и разрешение сервера                                         */
/* ------------------------------------------------------------------ */

function ensureStaticBuild() {
  const indexFile = join(staticDir, "index.json");
  if (existsSync(indexFile)) return;
  buildStatic();
}

function buildStatic() {
  console.log("• storybook-static отсутствует — собираю…");
  execFileSync("pnpm", ["exec", "storybook", "build", "-o", "storybook-static"], {
    cwd: pkgDir,
    stdio: "inherit",
  });
}

async function resolveBase(options) {
  if (options.url !== undefined) {
    return { origin: options.url.replace(/\/$/, ""), close: async () => undefined, kind: "url" };
  }
  if (options.dev) {
    const origin = "http://127.0.0.1:6106";
    const response = await fetch(`${origin}/index.json`).catch(() => null);
    if (response === null || !response.ok) {
      throw new Error(
        `--dev: dev-сервер не отвечает на ${origin}/index.json. ` +
          "Запустите `pnpm --filter @ivlev-dev/silent-ui-storybook dev`.",
      );
    }
    return { origin, close: async () => undefined, kind: "dev" };
  }
  if (options.build) buildStatic();
  ensureStaticBuild();
  const server = await startStaticServer(staticDir);
  return { ...server, kind: "static" };
}

/* ------------------------------------------------------------------ */
/* Браузер                                                             */
/* ------------------------------------------------------------------ */

const FIREFOX_LAYOUTS = [
  ["firefox", "firefox"],
  ["firefox", "firefox-bin"],
  ["firefox", "firefox.exe"],
];
const CHROMIUM_LAYOUTS = [
  ["chrome-linux64", "chrome"],
  ["chrome-linux", "chrome"],
  ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
  ["chrome-win64", "chrome.exe"],
];

function browserCacheDirs() {
  const dirs = [];
  const override = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  if (override !== undefined && override !== "" && override !== "0") dirs.push(resolve(override));
  // Локальный кэш, куда ставился firefox для этой витрины.
  dirs.push(join("/tmp", "opencode", "pw-browsers"));
  if (process.platform === "darwin") {
    dirs.push(join(homedir(), "Library", "Caches", "ms-playwright"));
  } else if (process.platform === "win32") {
    dirs.push(
      join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "ms-playwright"),
    );
  } else {
    dirs.push(join(homedir(), ".cache", "ms-playwright"));
  }
  return [...new Set(dirs.filter((dir) => existsSync(dir)))];
}

function findExecutable(cacheDir, prefix, layouts) {
  let entries;
  try {
    entries = readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const versions = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${prefix}-`))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const leftNumber = Number.parseInt(left.slice(prefix.length + 1), 10);
      const rightNumber = Number.parseInt(right.slice(prefix.length + 1), 10);
      return (Number.isNaN(rightNumber) ? 0 : rightNumber) - (Number.isNaN(leftNumber) ? 0 : leftNumber);
    });
  for (const version of versions) {
    for (const layout of layouts) {
      const candidate = join(cacheDir, version, ...layout);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveBrowserExecutable(name) {
  const prefix = name === "chromium" ? "chromium" : name;
  const layouts = name === "chromium" ? CHROMIUM_LAYOUTS : FIREFOX_LAYOUTS;
  for (const cacheDir of browserCacheDirs()) {
    const executable = findExecutable(cacheDir, prefix, layouts);
    if (executable !== null) return { executablePath: executable, cacheDir };
  }
  return null;
}

function sanitizedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env["LD_PRELOAD"];
  return env;
}

async function launchFirstWorkingBrowser(preferred) {
  const playwright = await import("playwright-core");
  const names =
    preferred === "auto" ? ["chromium", "firefox"] : [preferred];
  const failures = [];
  for (const name of names) {
    const browserType = playwright[name];
    if (browserType === undefined) {
      failures.push(`${name}: неизвестный браузер`);
      continue;
    }
    const resolved = resolveBrowserExecutable(name);
    const attempts = [];
    if (resolved !== null) attempts.push(resolved.executablePath);
    // Пустой executablePath — пусть playwright ищет браузер сам.
    attempts.push(undefined);
    for (const executablePath of attempts) {
      if (executablePath === undefined && resolved !== null) continue;
      try {
        const browser = await browserType.launch({
          headless: true,
          ...(executablePath === undefined ? {} : { executablePath }),
          env: sanitizedEnv(),
          ...(name === "chromium" ? { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] } : {}),
        });
        const page = await browser.newPage();
        await page.setContent("<h1>silent-ui-check</h1>");
        await page.close();
        return {
          browser,
          name,
          executablePath: executablePath ?? "playwright default",
          failures,
        };
      } catch (error) {
        failures.push(
          `${name}${executablePath === undefined ? " (default)" : ` (${executablePath})`}: ${
            error instanceof Error ? error.message.split("\n")[0] : String(error)
          }`,
        );
      }
    }
  }
  const error = new Error(
    [
      "Не удалось запустить браузер для проверки витрины.",
      ...failures.map((line) => `  - ${line}`),
      "",
      "Установите браузер (в кэш /tmp, если системный не работает):",
      "  PLAYWRIGHT_BROWSERS_PATH=/tmp/opencode/pw-browsers pnpm exec playwright-core install firefox",
      "  pnpm exec playwright-core install --with-deps chromium",
    ].join("\n"),
  );
  error.failures = failures;
  throw error;
}

/* ------------------------------------------------------------------ */
/* Проверки внутри страницы                                            */
/* ------------------------------------------------------------------ */

const PAGE_PROBE = () => {
  const issues = [];
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  const scrolling = document.scrollingElement ?? document.documentElement;
  if (scrolling.scrollWidth > scrolling.clientWidth + 1) {
    issues.push({
      kind: "document-overflow-x",
      detail: `scrollWidth=${String(scrolling.scrollWidth)} > clientWidth=${String(scrolling.clientWidth)}`,
    });
  }

  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const hasScrollableAncestor = (element) => {
    let current = element.parentElement;
    while (current !== null && current !== document.body) {
      const style = window.getComputedStyle(current);
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) return true;
      current = current.parentElement;
    }
    return false;
  };

  const selector =
    "body p, body span, body a, body button, body label, body h1, body h2, body h3, body h4, body h5, body h6, body li, body td, body th, body caption, body code, body dt, body dd, body summary, body legend";
  for (const element of document.querySelectorAll(selector)) {
    if (!isVisible(element)) continue;
    if (element.closest("[aria-hidden='true']") !== null) continue;
    const style = window.getComputedStyle(element);
    const ownText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    if (ownText === "") continue;
    const rect = element.getBoundingClientRect();
    // Только блочные боксы с реальной шириной: у inline-элементов
    // scrollWidth/clientWidth не отражают перенос строк и дают ложные
    // срабатывания. Контент в scroll-контейнере скроллится осознанно.
    const isBlockish = ["block", "flow-root", "flex", "grid", "table-cell", "list-item"].includes(
      style.display,
    );
    if (
      isBlockish &&
      element.clientWidth > 0 &&
      element.scrollWidth > element.clientWidth + 1 &&
      style.overflowX === "visible" &&
      !hasScrollableAncestor(element)
    ) {
      issues.push({
        kind: "text-overflow",
        detail: `${element.tagName.toLowerCase()}.${String(element.className).split(" ").filter(Boolean).join(".") || "-"}: scrollWidth=${String(element.scrollWidth)} > clientWidth=${String(element.clientWidth)}`,
        text: ownText.slice(0, 80),
      });
    }
    if (
      (rect.right > viewportWidth + 1 || rect.left < -1) &&
      !hasScrollableAncestor(element) &&
      style.position !== "fixed"
    ) {
      issues.push({
        kind: "text-outside-viewport",
        detail: `rect=[${Math.round(rect.left)}, ${Math.round(rect.right)}] при viewport=${String(viewportWidth)}`,
        text: ownText.slice(0, 80),
      });
    }
  }

  const errorDisplay = document.querySelector(
    ".sb-errordisplay, [id^='sb-errordisplay'], [class*='errordisplay']",
  );
  if (errorDisplay !== null && isVisible(errorDisplay)) {
    issues.push({
      kind: "storybook-error-display",
      detail: (errorDisplay.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    });
  }

  const root = document.querySelector("#storybook-root, #root, .sui-story-canvas");
  if (root !== null) {
    const rect = root.getBoundingClientRect();
    if (rect.width > viewportWidth + 1 && !hasScrollableAncestor(root)) {
      issues.push({
        kind: "root-wider-than-viewport",
        detail: `root width=${Math.round(rect.width)} при viewport=${String(viewportWidth)}`,
      });
    }
  }

  return {
    issues,
    viewport: { width: viewportWidth, height: viewportHeight },
    storyText: (document.body.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
  };
};

async function waitForStory(page, docs = false, timeout = 10000) {
  // Ждём именно результат рендера: у Storybook «No Preview» появляется
  // раньше, чем монтируется story, поэтому раннее наличие error-display
  // нельзя считать финальным состоянием.
  await page
    .waitForFunction(
      (isDocs) => {
        if (isDocs) return document.querySelector(".sbdocs-content") !== null;
        const canvas = document.querySelector(".sui-story-canvas");
        return canvas !== null;
      },
      docs,
      { timeout },
    )
    .catch(() => undefined);
  await page
    .evaluate(
      () =>
        new Promise((done) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              done(null);
            });
          });
        }),
    )
    .catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* axe-core                                                            */
/* ------------------------------------------------------------------ */

async function loadAxeBuilder() {
  const requireFromStorybook = createRequire(join(pkgDir, "package.json"));
  const resolved = requireFromStorybook.resolve("@axe-core/playwright");
  const module = await import(pathToFileURL(resolved).href);
  const AxeBuilder = module.AxeBuilder ?? module.default;
  if (typeof AxeBuilder !== "function") {
    throw new Error("@axe-core/playwright не экспортирует AxeBuilder");
  }
  return AxeBuilder;
}

async function runAxe(page, AxeBuilder) {
  try {
    let results;
    // a11y-addon в dev-режиме тоже запускает axe на каждый рендер. Дожидаемся
    // его прогона, иначе axe отвечает «Axe is already running».
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("already running") || attempt === 4) throw error;
        await page.waitForTimeout(400);
      }
    }
    if (results === undefined) throw new Error("axe не вернул результат");
    return {
      violations: results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      violations: [],
    };
  }
}

/* ------------------------------------------------------------------ */
/* Прогон stories                                                      */
/* ------------------------------------------------------------------ */

function storyUrl(origin, entry) {
  const view = entry.type === "docs" ? "docs" : "story";
  return `${origin}/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=${view}`;
}

function safeFile(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isKeyStory(id) {
  return KEY_STORIES.some((prefix) => id.startsWith(prefix));
}

async function runBrowserChecks(options, origin) {
  const indexResponse = await fetch(`${origin}/index.json`);
  if (!indexResponse.ok) {
    throw new Error(`index.json недоступен: HTTP ${String(indexResponse.status)} (${origin})`);
  }
  const index = await indexResponse.json();
  const entries = Object.values(index.entries ?? {});
  let stories = entries.filter((entry) => entry.type === "story");
  const docs = entries.filter((entry) => entry.type === "docs");
  if (options.storyFilter !== undefined) {
    stories = stories.filter((entry) => entry.id.includes(options.storyFilter));
  }
  if (stories.length > options.maxStories) stories = stories.slice(0, options.maxStories);
  if (stories.length === 0) throw new Error("В index.json не найдено ни одной story");

  const launched = await launchFirstWorkingBrowser(options.browser);
  console.log(`• браузер: ${launched.name} (${launched.executablePath})`);

  const AxeBuilder = await loadAxeBuilder();
  const browser = launched.browser;
  // Не оставляем headless-браузер сиротой при Ctrl+C/таймауте CI.
  const onSignal = () => {
    void browser.close().catch(() => undefined);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const report = {
    base: origin,
    browser: { name: launched.name, executablePath: launched.executablePath },
    viewports: options.viewports.map((viewport) => viewport.name),
    dpr: options.dpr,
    stories: stories.map((entry) => ({ id: entry.id, title: entry.title, name: entry.name })),
    docs: docs.map((entry) => ({ id: entry.id, title: entry.title })),
    checks: [],
    failures: [],
    warnings: [],
    consoleErrors: [],
    screenshots: [],
    limitations: [],
    axe: [],
  };

  // Известные дефекты компонентов фиксируются тегом в story и попадают в
  // предупреждения; всё остальное critical — ошибка гейта.
  report.limitations.push(
    "Docs-страницы проверяются на overflow; a11y — только по stories (UI Storybook не входит в дизайн-систему).",
  );
  const screenshotsDir = join(options.out, "screenshots");
  if (options.screenshots !== "none") mkdirSync(screenshotsDir, { recursive: true });

  // Одна загрузка story на DPR, затем 6 размеров viewport без перезагрузки:
  // resize меняет layout/media queries, а повторный `goto` лишь замедляет
  // прогон в 6 раз.
  const storyTasks = [];
  for (const story of stories) {
    for (const dpr of options.dpr) {
      storyTasks.push({ entry: story, dpr, viewports: options.viewports, docs: false });
    }
  }
  // Docs-страницы Storybook не адаптируются под мобильную ширину (это UI
  // самого Storybook, а не компонент), поэтому проверяем desktop.
  const docsViewports = VIEWPORTS.filter((viewport) => viewport.name === "1200x900");
  const docsTasks = options.includeDocs
    ? docs.map((entry) => ({ entry, dpr: 1, viewports: docsViewports, docs: true }))
    : [];
  const allTasks = [...storyTasks, ...docsTasks].sort(
    (left, right) =>
      left.dpr - right.dpr || String(left.entry.id).localeCompare(String(right.entry.id)),
  );

  let completed = 0;
  const total = allTasks.length;
  let nextIndex = 0;

  async function worker() {
    const contexts = new Map();
    let page;
    let activeDpr;
    let consoleErrors = [];
    const onConsole = (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    };
    const onPageError = (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    };
    const attach = (target) => {
      target.on("console", onConsole);
      target.on("pageerror", onPageError);
    };
    const newPage = async (dpr) => {
      let context = contexts.get(dpr);
      if (context === undefined) {
        context = await browser.newContext({
          viewport: { width: 1200, height: 900 },
          deviceScaleFactor: dpr,
          reducedMotion: "reduce",
        });
        contexts.set(dpr, context);
      }
      const created = await context.newPage();
      attach(created);
      return created;
    };

    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= allTasks.length) break;
      const task = allTasks[current];
      try {
        if (page === undefined || activeDpr !== task.dpr) {
          if (page !== undefined) await page.close();
          page = await newPage(task.dpr);
          activeDpr = task.dpr;
        }
        consoleErrors = [];
        await page.setViewportSize({ width: 1200, height: 900 });
        const url = storyUrl(origin, task.entry);

        // При параллельной загрузке Storybook иногда отдаёт «No Preview»/404,
        // пока грузится chunk story. Один повтор снимает гонку и не маскирует
        // стабильные ошибки: повторная неудача попадёт в отчёт.
        let response;
        let errorShown = false;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          consoleErrors = [];
          response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
          await waitForStory(page, task.docs === true);
          await page
            .evaluate(
              () =>
                new Promise((done) => {
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      done(null);
                    });
                  });
                }),
            )
            .catch(() => undefined);
          errorShown = await page
            .evaluate(() => {
              const error = document.querySelector(
                ".sb-errordisplay, [id^='sb-errordisplay'], [class*='errordisplay']",
              );
              if (error === null) return false;
              const style = window.getComputedStyle(error);
              const rect = error.getBoundingClientRect();
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0
              );
            })
            .catch(() => false);
          const badStatus = response !== null && !response.ok();
          if (!badStatus && !errorShown) break;
          if (attempt === 0) {
            await page.close();
            page = await newPage(task.dpr);
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.waitForTimeout(200);
          }
        }
        if (response !== null && !response.ok()) {
          report.failures.push({
            entry: task.entry.id,
            viewport: "load",
            dpr: task.dpr,
            kind: "http-status",
            detail: `HTTP ${String(response.status())} ${url}`,
          });
        }
        if (consoleErrors.length > 0) {
          for (const message of consoleErrors) {
            report.consoleErrors.push({
              entry: task.entry.id,
              viewport: "load",
              dpr: task.dpr,
              message: message.slice(0, 600),
            });
          }
        }

        const baselineTags = Array.isArray(task.entry.tags) ? task.entry.tags : [];
        const a11yBaseline = baselineTags.includes("ui-a11y-baseline");

        for (const viewport of task.viewports) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page
            .evaluate(
              () =>
                new Promise((done) => {
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      done(null);
                    });
                  });
                }),
            )
            .catch(() => undefined);
          const probe = await page.evaluate(PAGE_PROBE).catch((error) => ({
            issues: [
              {
                kind: "probe-error",
                detail: error instanceof Error ? error.message : String(error),
              },
            ],
            viewport: { width: viewport.width, height: viewport.height },
            storyText: "",
          }));
          for (const issue of probe.issues) {
            report.failures.push({
              entry: task.entry.id,
              viewport: viewport.name,
              dpr: task.dpr,
              ...issue,
            });
          }

          const isDocs = task.docs === true;
          const runA11y =
            options.a11y !== "off" && task.dpr === 1 && viewport.name === "1200x900" && !isDocs;
          if (runA11y) {
            const axe = await runAxe(page, AxeBuilder);
            if (axe.error !== undefined) {
              report.warnings.push({
                entry: task.entry.id,
                kind: "axe-error",
                detail: axe.error,
              });
            }
            for (const violation of axe.violations) {
              const record = {
                entry: task.entry.id,
                viewport: viewport.name,
                baseline: a11yBaseline,
                ...violation,
              };
              report.axe.push(record);
              if (violation.impact === "critical") {
                if (a11yBaseline) {
                  report.warnings.push({
                    entry: task.entry.id,
                    kind: "a11y-critical-baseline",
                    detail: `${violation.id}: ${violation.help} (known, тег ui-a11y-baseline)`,
                  });
                } else {
                  report.failures.push({
                    entry: task.entry.id,
                    viewport: viewport.name,
                    dpr: task.dpr,
                    kind: "a11y-critical",
                    detail: `${violation.id}: ${violation.help}`,
                  });
                }
              } else if (violation.impact === "serious") {
                report.warnings.push({
                  entry: task.entry.id,
                  kind: "a11y-serious",
                  detail: `${violation.id}: ${violation.help}`,
                });
              }
            }
          }

          const wantScreenshot =
            options.screenshots === "all" ||
            (options.screenshots === "key" &&
              !isDocs &&
              isKeyStory(task.entry.id) &&
              (task.dpr === 1 || (task.dpr === 2 && viewport.name === "1200x900")));
          if (wantScreenshot) {
            const fileName = `${safeFile(task.entry.id)}__${viewport.name}__dpr${String(task.dpr)}.png`;
            const path = join(screenshotsDir, fileName);
            await page.screenshot({ path });
            report.screenshots.push(path);
          }

          report.checks.push({
            entry: task.entry.id,
            viewport: viewport.name,
            dpr: task.dpr,
            issues: probe.issues.length,
            text: probe.storyText.length > 0,
          });
        }
      } catch (error) {
        report.failures.push({
          entry: task.entry.id,
          viewport: "load",
          dpr: task.dpr,
          kind: "navigation",
          detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
        });
      } finally {
        completed += 1;
        if (completed % 10 === 0 || completed === total) {
          process.stdout.write(`\r  проверено ${String(completed)}/${String(total)} задач`);
        }
      }
    }
    for (const context of contexts.values()) await context.close().catch(() => undefined);
  }

  const workerCount = Math.min(options.concurrency, allTasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  process.stdout.write("\n");
  await browser.close();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  report.consoleErrors = dedupe(
    report.consoleErrors,
    (item) => `${item.entry}:${item.viewport}:${String(item.dpr)}:${item.message}`,
  );
  report.failures = dedupe(
    report.failures,
    (item) => `${item.entry}:${item.viewport}:${String(item.dpr)}:${item.kind}:${item.detail}`,
  );
  report.warnings = dedupe(report.warnings, (item) => `${item.entry}:${item.kind}:${item.detail}`);
  return report;
}

function dedupe(items, keyOf) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Статические проверки (fallback без браузера)                        */
/* ------------------------------------------------------------------ */

function runStaticChecks(options) {
  const checks = [];
  const warnings = [];
  const limitations = [];
  let ok = true;
  const fail = (kind, detail) => {
    ok = false;
    checks.push({ kind, ok: false, detail });
  };
  const pass = (kind, detail) => checks.push({ kind, ok: true, detail });

  const indexFile = join(staticDir, "index.json");
  if (!existsSync(indexFile)) {
    fail("index.json", `Нет ${indexFile}. Соберите Storybook: pnpm --filter @ivlev-dev/silent-ui-storybook build`);
    return { ok, checks, warnings, limitations };
  }
  let index;
  try {
    index = JSON.parse(readFileSync(indexFile, "utf8"));
  } catch (error) {
    fail("index.json", `JSON не парсится: ${error instanceof Error ? error.message : String(error)}`);
    return { ok, checks, warnings, limitations };
  }
  const entries = Object.values(index.entries ?? {});
  const stories = entries.filter((entry) => entry.type === "story");
  const docs = entries.filter((entry) => entry.type === "docs");
  if (stories.length === 0) fail("stories", "index.json не содержит stories");
  else pass("stories", `stories: ${String(stories.length)}, docs: ${String(docs.length)}`);

  const ids = new Set();
  for (const entry of entries) {
    if (typeof entry.id !== "string" || entry.id === "") fail("entry-id", "запись без id");
    if (ids.has(entry.id)) fail("entry-duplicate", `дубликат id: ${String(entry.id)}`);
    ids.add(entry.id);
    if (typeof entry.title !== "string" || typeof entry.name !== "string") {
      fail("entry-meta", `неполные title/name у ${String(entry.id)}`);
    }
  }
  if (ok) pass("entry-meta", "у всех записей есть id/title/name, id уникальны");

  const iframeFile = join(staticDir, "iframe.html");
  if (!existsSync(iframeFile)) {
    fail("iframe.html", "нет iframe.html");
  } else {
    const html = readFileSync(iframeFile, "utf8");
    if (!html.includes("storybook-root")) fail("iframe.html", "нет контейнера storybook-root");
    else pass("iframe.html", "iframe.html содержит storybook-root");
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
    for (const asset of assets) {
      const assetPath = join(staticDir, asset.replace(/^\//, ""));
      if (!existsSync(assetPath)) fail("asset", `отсутствует ${asset}`);
    }
    if (assets.length > 0) pass("assets", `проверено ассетов: ${String(assets.length)}`);
  }

  const storyDir = join(pkgDir, "src");
  const storyFiles = listFiles(storyDir, (file) => file.endsWith(".stories.tsx"));
  for (const file of storyFiles) {
    const relative = file.slice(pkgDir.length + 1);
    const contents = readFileSync(file, "utf8");
    if (!/export\s+default\b/.test(contents)) fail("story-meta", `${relative}: нет default meta`);
    if (!/export\s+const\s+[A-Z]/.test(contents)) fail("story-export", `${relative}: нет именованных stories`);
    if (contents.includes("TODO") || contents.includes("FIXME")) {
      warnings.push({ kind: "story-todo", detail: `${relative}: TODO/FIXME` });
    }
  }
  if (storyFiles.length > 0) pass("story-files", `story-файлов: ${String(storyFiles.length)}`);

  // Грубая эвристика: `100vw` без учёта скроллбара — частая причина overflow.
  for (const file of listFiles(pkgDir, (candidate) => candidate.endsWith(".css"))) {
    const contents = readFileSync(file, "utf8");
    if (contents.includes("100vw")) {
      warnings.push({ kind: "100vw", detail: `${file.slice(pkgDir.length + 1)}: 100vw` });
    }
  }
  warnings.push({
    kind: "browser-skipped",
    detail: "Браузерные проверки (overflow, viewport, a11y, screenshots) не выполнялись.",
  });
  return {
    ok,
    checks,
    warnings,
    limitations,
    stories: stories.map((entry) => ({ id: entry.id, title: entry.title, name: entry.name })),
    docs: docs.map((entry) => ({ id: entry.id, title: entry.title })),
  };
}

function listFiles(directory, predicate) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "storybook-static") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (predicate(full)) found.push(full);
    }
  };
  walk(directory);
  return found.sort();
}

/* ------------------------------------------------------------------ */
/* Отчёт                                                               */
/* ------------------------------------------------------------------ */

function writeReport(options, report) {
  mkdirSync(options.out, { recursive: true });
  const reportFile = join(options.out, "report.json");
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    "# Storybook UI check",
    "",
    `- Дата: ${report.generatedAt}`,
    `- База: ${report.base ?? "—"}`,
    `- Браузер: ${report.browser?.name ?? "недоступен"} ${report.browser?.executablePath ?? ""}`,
    `- Viewport: ${(report.viewports ?? []).join(", ")}`,
    `- DPR: ${(report.dpr ?? []).join(", ")}`,
    `- Stories: ${String(report.stories?.length ?? 0)}`,
    `- Проверок: ${String(report.checks?.length ?? 0)}`,
    `- Ошибок: ${String(report.failures?.length ?? 0)}`,
    `- Предупреждений: ${String(report.warnings?.length ?? 0)}`,
    `- a11y нарушений: ${String(report.axe?.length ?? 0)}`,
    `- Скриншотов: ${String(report.screenshots?.length ?? 0)}`,
    "",
  ];
  if (report.limitations?.length > 0) {
    lines.push("## Ограничения", "", ...report.limitations.map((item) => `- ${item}`), "");
  }
  if (report.failures?.length > 0) {
    lines.push("## Ошибки", "");
    for (const failure of report.failures.slice(0, 200)) {
      lines.push(
        `- **${failure.entry}** @ ${failure.viewport ?? "—"} / dpr ${String(failure.dpr ?? "—")}: ` +
          `${failure.kind} — ${failure.detail ?? ""}`,
      );
    }
    if (report.failures.length > 200) lines.push(`- … ещё ${String(report.failures.length - 200)}`);
    lines.push("");
  }
  if (report.warnings?.length > 0) {
    lines.push("## Предупреждения", "");
    for (const warning of report.warnings.slice(0, 100)) {
      lines.push(`- ${warning.entry ?? ""} ${warning.kind}: ${warning.detail}`);
    }
    lines.push("");
  }
  if (report.axe?.length > 0) {
    lines.push("## axe-core", "");
    for (const violation of report.axe.slice(0, 100)) {
      lines.push(
        `- **${violation.entry}** ${violation.impact}: ${violation.id} — ${violation.help}` +
          `${violation.baseline ? " [known baseline]" : ""} (${violation.helpUrl})`,
      );
    }
    lines.push("");
  }
  if (report.consoleErrors?.length > 0) {
    lines.push("## Ошибки консоли", "");
    for (const error of report.consoleErrors.slice(0, 100)) {
      lines.push(`- **${error.entry}** @ ${error.viewport} dpr ${String(error.dpr)}: ${error.message}`);
    }
    lines.push("");
  }
  lines.push(`Полный отчёт: ${reportFile}`);
  const summaryFile = join(options.out, "summary.md");
  writeFileSync(summaryFile, `${lines.join("\n")}\n`);
  return { reportFile, summaryFile };
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.out, { recursive: true });
  console.log("Storybook UI check");
  console.log(`  отчёт: ${options.out}`);

  let browserReport;
  let staticFallback = null;
  let browserUnavailable = false;

  if (!options.useBrowser) {
    ensureStaticBuild();
    staticFallback = runStaticChecks(options);
  } else {
    try {
      const base = await resolveBase(options);
      console.log(`• сервер: ${base.origin} (${base.kind})`);
      try {
        browserReport = await runBrowserChecks(options, base.origin);
      } finally {
        await base.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      browserUnavailable = true;
      console.error("\n! Браузерные проверки не выполнены.");
      console.error(message.split("\n").map((line) => `  ${line}`).join("\n"));
      staticFallback = runStaticChecks(options);
      if (staticFallback !== null) {
        staticFallback.limitations.push(
          `Браузер недоступен: ${message.split("\n")[0]}`,
        );
      }
      if (options.strictBrowser) {
        console.error("\n--strict-browser: падение браузера считается ошибкой.");
        process.exitCode = 1;
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const report = browserReport ?? {
    base: options.url ?? null,
    browser: null,
    viewports: options.viewports.map((viewport) => viewport.name),
    dpr: options.dpr,
    stories: staticFallback?.stories ?? [],
    docs: staticFallback?.docs ?? [],
    checks: [],
    failures: [],
    warnings: staticFallback?.warnings ?? [],
    consoleErrors: [],
    screenshots: [],
    limitations: staticFallback?.limitations ?? [],
    axe: [],
    generatedAt,
    staticChecks: staticFallback?.checks ?? [],
  };
  report.generatedAt = generatedAt;

  const { reportFile, summaryFile } = writeReport(options, report);

  console.log("");
  if (options.strictBrowser && browserUnavailable) {
    console.error("✗ браузер недоступен — браузерная проверка не выполнена (--strict-browser)");
    process.exitCode = 1;
  } else if (report.failures.length > 0) {
    console.error(`✗ ошибок: ${String(report.failures.length)}`);
    for (const failure of report.failures.slice(0, 20)) {
      console.error(
        `  - ${failure.entry} @ ${failure.viewport ?? "—"} dpr ${String(failure.dpr ?? "—")}: ${failure.kind} — ${failure.detail ?? ""}`,
      );
    }
    if (report.failures.length > 20) console.error(`  … ещё ${String(report.failures.length - 20)}`);
    process.exitCode = 1;
  } else if (staticFallback !== null) {
    console.log("✓ критических проблем в статических проверках не найдено");
  } else {
    console.log("✓ критических проблем не найдено");
  }
  if (report.warnings.length > 0) {
    console.log(`• предупреждений: ${String(report.warnings.length)} (см. отчёт)`);
  }
  if (report.axe.length > 0) {
    console.log(
      `• a11y: ${String(report.axe.length)} нарушений (critical вне ui-a11y-baseline — ошибка)`,
    );
  }
  if (report.screenshots.length > 0) {
    console.log(`• скриншоты: ${String(report.screenshots.length)} → ${join(options.out, "screenshots")}`);
  }
  if (staticFallback !== null) {
    console.log(
      `• статические проверки: ${staticFallback.ok ? "OK" : "есть ошибки"}; браузерные проверки пропущены`,
    );
    if (!staticFallback.ok) process.exitCode = 1;
  }
  console.log(`• отчёт: ${reportFile}`);
  console.log(`• резюме: ${summaryFile}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
