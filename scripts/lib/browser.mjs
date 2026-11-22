// Общий резолвер браузеров для e2e-скриптов.
//
// Зачем отдельный модуль:
// - `scripts/e2e.mjs` и `scripts/ssr-e2e.mjs` должны одинаково выбирать
//   браузер (SILENT_E2E_BROWSER) и находить его исполняемый файл;
// - путь к браузеру зависит от ОС и версии playwright-core, поэтому
//   хардкод `~/.cache/ms-playwright/chrome-linux64/chrome` недопустим;
// - отсутствие playwright-core должно давать понятную ошибку, а не
//   стек `ERR_MODULE_NOT_FOUND`.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const BROWSER_NAMES = ["chromium", "firefox", "webkit"];

// Fallback-раскладки на случай, если playwright-core установлен из одной
// версии, а браузеры — из другой (тогда executablePath() указывает на
// отсутствующую ревизию). Проверяются по убыванию ревизии.
const BROWSER_LAYOUTS = {
  chromium: [
    ["chrome-linux64", "chrome"],
    ["chrome-linux", "chrome"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ["chrome-win64", "chrome.exe"],
    ["chrome-win", "chrome.exe"],
  ],
  firefox: [
    ["firefox", "firefox"],
    ["firefox", "firefox.exe"],
    ["firefox", "firefox-bin"],
  ],
  webkit: [
    ["pw_run.sh"],
    ["minibrowser-gtk", "bin", "MiniBrowser"],
    ["minibrowser-wpe", "bin", "MiniBrowser"],
    ["MiniBrowser", "MiniBrowser.exe"],
  ],
};

let playwrightPromise = null;

/** Выбор браузера из SILENT_E2E_BROWSER (по умолчанию chromium). */
export function selectBrowserName(env = process.env) {
  const raw = (env.SILENT_E2E_BROWSER ?? "chromium").trim().toLowerCase();
  if (!BROWSER_NAMES.includes(raw)) {
    throw new Error(
      `SILENT_E2E_BROWSER="${raw}" не поддерживается. Допустимо: ${BROWSER_NAMES.join(", ")}.`,
    );
  }
  return raw;
}

/** Каталог, куда playwright-core складывает браузеры. */
export function playwrightCacheDir(env = process.env) {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override !== undefined && override !== "" && override !== "0") {
    return resolve(override);
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }
  if (process.platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "ms-playwright");
  }
  return join(homedir(), ".cache", "ms-playwright");
}

/** Ленивая загрузка playwright-core с понятной ошибкой при отсутствии. */
export async function loadPlaywright() {
  if (playwrightPromise === null) {
    playwrightPromise = import("playwright-core").catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        [
          "Не удалось загрузить playwright-core.",
          "Установите зависимости: pnpm install",
          "Затем браузер: pnpm exec playwright-core install --with-deps chromium",
          `Причина: ${detail}`,
        ].join(" "),
      );
    });
  }
  return await playwrightPromise;
}

function installedExecutables(browserName, cacheDir) {
  if (!existsSync(cacheDir)) {
    return [];
  }
  const revisions = readdirSync(cacheDir)
    .filter((entry) => entry.startsWith(`${browserName}-`))
    .sort((left, right) => {
      const leftRevision = Number(left.slice(browserName.length + 1));
      const rightRevision = Number(right.slice(browserName.length + 1));
      return rightRevision - leftRevision;
    });

  const found = [];
  for (const revision of revisions) {
    for (const layout of BROWSER_LAYOUTS[browserName]) {
      const candidate = join(cacheDir, revision, ...layout);
      if (existsSync(candidate)) {
        found.push(candidate);
      }
    }
  }
  return found;
}

/**
 * Возвращает путь к браузеру: сначала штатный executablePath() из
 * playwright-core, затем поиск любой установленной ревизии в кэше.
 */
export function resolveExecutablePath(playwright, browserName, env = process.env) {
  const browserType = playwright[browserName];
  if (browserType === undefined) {
    throw new Error(`playwright-core не экспортирует браузер "${browserName}"`);
  }

  try {
    const expected = browserType.executablePath();
    if (typeof expected === "string" && expected !== "" && existsSync(expected)) {
      return expected;
    }
  } catch {
    // executablePath() может бросить, если браузер не установлен —
    // ниже попробуем найти любую установленную ревизию.
  }

  const cacheDir = playwrightCacheDir(env);
  const candidates = installedExecutables(browserName, cacheDir);
  if (candidates.length > 0) {
    return candidates[0];
  }

  throw new Error(
    [
      `${browserName}: исполняемый файл не найден.`,
      `Каталог браузеров: ${cacheDir}.`,
      `Установите браузер: pnpm exec playwright-core install --with-deps ${browserName}`,
    ].join(" "),
  );
}

function sanitizedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // LD_PRELOAD из окружения CI/контейнера ломает запуск Chromium.
  delete env.LD_PRELOAD;
  return env;
}

/**
 * Запускает браузер и возвращает его вместе с путём (для логов).
 * @returns {Promise<{ browser: import("playwright-core").Browser, executablePath: string }>}
 */
export async function launchBrowser(browserName) {
  const playwright = await loadPlaywright();
  const browserType = playwright[browserName];
  const executablePath = resolveExecutablePath(playwright, browserName);
  const options = {
    executablePath,
    headless: true,
    env: sanitizedEnv(),
  };
  if (browserName === "chromium") {
    options.args = ["--no-sandbox"];
  }
  try {
    const browser = await browserType.launch(options);
    return { browser, executablePath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `${browserName}: не удалось запустить ${executablePath}.`,
        `Проверьте зависимости: pnpm exec playwright-core install --with-deps ${browserName}`,
        detail,
      ].join("\n"),
    );
  }
}
