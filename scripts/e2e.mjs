import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";
import { createServer } from "vite";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const counterDir = join(root, "examples", "counter");
const todoDir = join(root, "examples", "todo");
const routerDir = join(root, "examples", "router");
const formsDir = join(root, "examples", "forms");
const cacheDir = join(homedir(), ".cache", "ms-playwright");

const BROWSER_TYPES = { chromium, firefox, webkit };

const BROWSER_LAYOUTS = {
  chromium: [
    ["chrome-linux64", "chrome"],
    ["chrome-linux", "chrome"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
  ],
  firefox: [
    ["firefox", "firefox"],
    ["firefox", "firefox-bin"],
  ],
  webkit: [
    ["pw_run.sh"],
    ["minibrowser-gtk", "bin", "MiniBrowser"],
    ["minibrowser-wpe", "bin", "MiniBrowser"],
  ],
};

function selectBrowserName() {
  const raw = (process.env.SILENT_E2E_BROWSER ?? "chromium").trim().toLowerCase();
  if (!Object.hasOwn(BROWSER_TYPES, raw)) {
    throw new Error(
      `SILENT_E2E_BROWSER="${raw}" не поддерживается. Допустимо: chromium, firefox, webkit.`,
    );
  }
  return raw;
}

function expectedRevision(browserName) {
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, "node_modules", "playwright-core", "browsers.json"), "utf8"),
    );
    return manifest.browsers?.find((entry) => entry.name === browserName)?.revision;
  } catch {
    return undefined;
  }
}

function installedRevisions(browserName) {
  if (!existsSync(cacheDir)) {
    return [];
  }
  const expected = expectedRevision(browserName);
  return readdirSync(cacheDir)
    .filter((entry) => entry.startsWith(`${browserName}-`))
    .sort((left, right) => {
      if (expected !== undefined) {
        const leftMatches = left.endsWith(`-${expected}`) ? 0 : 1;
        const rightMatches = right.endsWith(`-${expected}`) ? 0 : 1;
        if (leftMatches !== rightMatches) {
          return leftMatches - rightMatches;
        }
      }
      const leftRevision = Number(left.slice(browserName.length + 1));
      const rightRevision = Number(right.slice(browserName.length + 1));
      return rightRevision - leftRevision;
    });
}

function findExecutable(browserName) {
  const revisions = installedRevisions(browserName);
  for (const revision of revisions) {
    for (const layout of BROWSER_LAYOUTS[browserName]) {
      const candidate = join(cacheDir, revision, ...layout);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error(
    [
      `${browserName}: исполняемый файл не найден в ${cacheDir}.`,
      `Установите браузер: pnpm exec playwright-core install --with-deps ${browserName}`,
      revisions.length === 0
        ? "Установленных ревизий для этого браузера нет."
        : `Проверены ревизии: ${revisions.join(", ")}.`,
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
  delete env["LD_PRELOAD"];
  return env;
}

async function launchBrowser(browserName) {
  const browserType = BROWSER_TYPES[browserName];
  const executablePath = findExecutable(browserName);
  const options = {
    executablePath,
    headless: true,
    env: sanitizedEnv(),
  };
  if (browserName === "chromium") {
    options.args = ["--no-sandbox"];
  }
  try {
    return await browserType.launch(options);
  } catch (error) {
    throw new Error(
      `${browserName}: не удалось запустить ${executablePath}. ` +
        `Проверьте зависимости: pnpm exec playwright-core install --with-deps ${browserName}\n` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
      await page.locator(".counter .icon-path").evaluate((element) => element.namespaceURI),
      "http://www.w3.org/2000/svg",
    );
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

async function runRouter(browser) {
  const server = await startServer(routerDir);
  const page = await browser.newPage();
  const errors = collectErrors(page);

  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.locator(".home h2").waitFor();
    assert.equal((await page.locator(".home h2").textContent())?.trim(), "Главная");
    assert.equal(await page.title(), "Silent Router");
    assert.equal(
      (await page.locator(".home .user-badge").textContent())?.trim(),
      "Пользователь: гость",
    );

    await page.goto(new URL("private/profile", server.url).href, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".login h2").waitFor();
    assert.equal(new URL(page.url()).pathname, "/login");
    assert.equal(new URL(page.url()).searchParams.get("next"), "/private/profile");

    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".layout .outlet .profile").waitFor();
    assert.equal(new URL(page.url()).pathname, "/private/profile");
    assert.equal(
      (await page.locator(".layout h2").textContent())?.trim(),
      "Личный кабинет",
    );
    assert.equal(
      (await page.locator(".layout .outlet .profile .user-badge").textContent())?.trim(),
      "Пользователь: Алиса",
    );

    const homeNav = page.locator(".nav").getByRole("link", { name: "Главная", exact: true });
    await homeNav.click();
    await page.locator(".home .user-badge").waitFor();
    assert.equal(
      (await page.locator(".home .user-badge").textContent())?.trim(),
      "Пользователь: Алиса",
    );

    const privateNav = page
      .locator(".nav")
      .getByRole("link", { name: "Приватный кабинет", exact: true });
    await privateNav.click();
    await page.locator(".layout .outlet .profile").waitFor();
    assert.equal(new URL(page.url()).pathname, "/private/profile");

    await page
      .locator(".nav")
      .getByRole("link", { name: "Lazy", exact: true })
      .click();
    await page.locator(".card h2").filter({ hasText: "Ленивый маршрут" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/lazy");

    await page.goto(new URL("missing", server.url).href, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".not-found h2").waitFor();
    assert.equal(
      (await page.locator(".not-found h2").textContent())?.trim(),
      "Страница не найдена",
    );

    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.locator(".home .links").waitFor();
    await page
      .locator(".home .links")
      .getByRole("link", { name: "Пользователь 1", exact: true })
      .click();
    await page.locator(".user h2").filter({ hasText: "Пользователь 1" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/users/1");
    assert.equal((await page.locator(".badge").textContent())?.trim(), "Вкладка: info");

    const input = page.locator(".demo-form input");
    await input.fill("черновик");
    await input.evaluate((element) => element.setAttribute("data-marker", "kept"));

    await page.getByRole("button", { name: /Следующий/ }).click();
    await page.locator(".user h2").filter({ hasText: "Пользователь 2" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/users/2");
    assert.equal(await input.inputValue(), "черновик");
    assert.equal(await input.getAttribute("data-marker"), "kept");

    const postsTab = page
      .locator(".tabs")
      .getByRole("link", { name: "Посты", exact: true });
    await postsTab.click();
    await page.locator(".badge").filter({ hasText: "Вкладка: posts" }).waitFor();
    assert.equal(new URL(page.url()).search, "?tab=posts");
    assert.equal(await postsTab.getAttribute("aria-current"), "page");

    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await server.close();
  }
}

async function selectDomState(page) {
  return page.locator(".native-select").evaluate((element) => {
    const select = element;
    return {
      tagName: select.tagName,
      type: select.type,
      multiple: select.multiple,
      optionValues: Array.from(select.options).map((option) => option.value),
      selectedIndex: select.selectedIndex,
      value: select.value,
      disabled: select.disabled,
      detachedFromForm: select.form === null,
    };
  });
}

async function runForms(browser) {
  const server = await startServer(formsDir);
  const page = await browser.newPage();
  const errors = collectErrors(page);

  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.locator("form.profile").waitFor();
    assert.equal(await page.title(), "Silent Framework: форма профиля");

    const name = page.locator("#profile-name");
    const email = page.locator("#profile-email");
    const state = page.locator('[id="profile-address.state"]');
    const city = page.locator('[id="profile-address.city"]');

    assert.equal(await name.getAttribute("required"), "");
    assert.equal(await name.getAttribute("aria-required"), "true");
    assert.equal(await email.getAttribute("required"), "");
    assert.equal(await state.getAttribute("required"), "");
    assert.equal(
      await page.locator('label[for="profile-name"] span[aria-hidden="true"]').count(),
      1,
      "обязательное поле не помечено звёздочкой для скринридера",
    );

    await name.fill("Алиса");
    await email.fill("не-email");
    await email.blur();
    const emailError = page.locator("#profile-email-error");
    await emailError.waitFor();
    assert.equal(await emailError.getAttribute("role"), "alert");
    assert.match((await emailError.textContent()) ?? "", /email/i);

    await email.fill("alice@example.com");
    await city.fill("Москва");
    await state.selectOption("moscow");

    await page.getByRole("button", { name: "Сохранить" }).click();
    const submitting = page.getByRole("status").filter({ hasText: "Отправляем…" });
    await submitting.waitFor();
    const success = page.getByRole("status").filter({ hasText: "Профиль сохранён: Алиса" });
    await success.waitFor();
    assert.equal(await success.getAttribute("aria-live"), "polite");

    await email.fill("taken@example.com");
    await page.getByRole("button", { name: "Сохранить" }).click();
    await page.waitForFunction(() =>
      document
        .querySelector("#profile-email-error")
        ?.textContent?.includes("Этот email уже занят"),
    );
    assert.equal(await emailError.getAttribute("role"), "alert");

    const avatar = page.locator("#profile-avatar");
    await avatar.setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    await page.getByRole("status").filter({ hasText: "Загрузка…" }).waitFor();
    await page.locator(".file-name").filter({ hasText: "avatar.png" }).waitFor();

    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await server.close();
  }
}

async function runRegressions(browser, browserName) {
  const server = await startServer(counterDir);
  const page = await browser.newPage();
  const errors = collectErrors(page);

  try {
    await page.goto(new URL("regressions.html", server.url).href, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(".regressions").waitFor();

    const namespaces = await page.evaluate(() => {
      const dynamicPath = document.querySelector(".dynamic-svg .icon-path");
      const mappedCircle = document.querySelector(".mapped-svg .mapped-circle");
      return {
        path: dynamicPath?.namespaceURI ?? null,
        circle: mappedCircle?.namespaceURI ?? null,
        pathParent: dynamicPath?.parentElement?.localName ?? null,
        circleParent: mappedCircle?.parentElement?.localName ?? null,
      };
    });
    assert.deepEqual(namespaces, {
      path: "http://www.w3.org/2000/svg",
      circle: "http://www.w3.org/2000/svg",
      pathParent: "svg",
      circleParent: "svg",
    });

    assert.equal(
      await page.locator(".probe-style").evaluate((element) => getComputedStyle(element).color),
      "rgb(1, 2, 3)",
    );

    const input = page.locator(".show-input");
    await input.fill("typed");
    await input.focus();
    await page.evaluate(() => globalThis.__silentTick?.());
    await page.waitForFunction(
      () => document.querySelector(".other")?.textContent?.trim() === "1",
    );
    assert.equal(await input.inputValue(), "typed");
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains("show-input")),
      true,
    );

    const select = page.locator(".native-select");
    assert.deepEqual(await selectDomState(page), {
      tagName: "SELECT",
      type: "select-one",
      multiple: false,
      optionValues: ["a", "b", "c"],
      selectedIndex: 1,
      value: "b",
      disabled: false,
      detachedFromForm: true,
    });

    await select.focus();
    await page.evaluate(() => globalThis.__silentTick?.());
    assert.equal(await select.inputValue(), "b");
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains("native-select")),
      true,
    );
    assert.deepEqual(await selectDomState(page), {
      tagName: "SELECT",
      type: "select-one",
      multiple: false,
      optionValues: ["a", "b", "c"],
      selectedIndex: 1,
      value: "b",
      disabled: false,
      detachedFromForm: true,
    });

    if (browserName === "firefox") {
      await select.selectOption("c");
      const afterSelect = await selectDomState(page);
      assert.equal(afterSelect.value, "c");
      assert.equal(afterSelect.selectedIndex, 2);
      assert.deepEqual(afterSelect.optionValues, ["a", "b", "c"]);
      assert.equal(afterSelect.multiple, false);
      assert.equal(afterSelect.tagName, "SELECT");
    } else {
      await select.selectOption("c");
      assert.equal(await select.inputValue(), "c");
    }

    assert.equal((await page.locator(".greeting").textContent())?.trim(), "Ann");
    await page.locator(".rename").click();
    assert.equal((await page.locator(".greeting").textContent())?.trim(), "Bob");

    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await server.close();
  }
}

const SUITES = {
  chromium: [runCounter, runTodo, runRouter, runForms, runRegressions],
  firefox: [runCounter, runTodo, runRouter, runForms, runRegressions],
  webkit: [runCounter, runTodo, runRouter, runForms, runRegressions],
};

async function main() {
  const browserName = selectBrowserName();
  const executablePath = findExecutable(browserName);
  console.log(`e2e: ${browserName} (${executablePath})`);
  const browser = await launchBrowser(browserName);
  try {
    for (const suite of SUITES[browserName]) {
      await suite(browser, browserName);
    }
    console.log(`e2e: ok (${browserName})`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
