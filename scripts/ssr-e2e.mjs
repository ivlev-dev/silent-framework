import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { renderToStream, renderToString } from "@ivlev-dev/silent-server";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const example = join(root, "examples", "counter");

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

function pageTemplate(ssrHtml, head) {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${head}
  </head>
  <body>
    <div id="app">${ssrHtml}</div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
}

async function renderStreaming(app, props) {
  let head = "";
  let finalHead = false;
  const stream = renderToStream(app, {
    props,
    onHead(value, info) {
      if (info.final) {
        finalHead = true;
        head = value;
        return;
      }
      if (!finalHead) {
        head = value;
      }
    },
  });
  let html = "";
  for await (const chunk of stream) {
    html += chunk;
  }
  return { html, head };
}

async function main() {
  const vite = await createServer({
    configFile: join(example, "vite.config.ts"),
    root: example,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true },
  });

  let http = null;
  let browser = null;

  try {
    const module = await vite.ssrLoadModule("/src/app.tsx");
    const rendered = await renderToString(module.App, {
      props: { title: "Silent Framework" },
    });
    const ssrHtml = rendered.html.replace("<h1", '<h1 data-ssr="1"');

    assert.match(
      ssrHtml,
      /<strong class="value">(?:<!--silent-insert-->)?0/,
      `SSR не содержит начального значения счётчика: ${ssrHtml.slice(0, 240)}`,
    );
    assert.ok(
      ssrHtml.includes("Счётчик"),
      "SSR не содержит заголовка счётчика",
    );
    assert.ok(
      ssrHtml.includes('class="icon-path"'),
      "SSR не содержит динамического SVG-ребёнка",
    );
    assert.ok(
      ssrHtml.includes("data-silent-a-"),
      "SSR не сохранил маркеры data-silent-a-*",
    );
    assert.ok(
      ssrHtml.includes('data-ssr="1"'),
      "не удалось пометить серверный узел",
    );
    assert.match(
      rendered.head,
      /<title>Silent Framework: счётчик<\/title>/,
      `SSR head не содержит заголовок: ${rendered.head}`,
    );
    assert.ok(
      !rendered.html.includes("<title>"),
      "заголовок не должен попадать в body",
    );

    const streamed = await renderStreaming(module.App, {
      title: "Silent Framework",
    });
    assert.ok(
      streamed.html.includes("data-silent-stream"),
      "стриминг не отдал патч-чанк для view",
    );
    const streamedHtml = streamed.html.replace("<h1", '<h1 data-ssr="1"');
    assert.match(
      streamed.head,
      /<title>Silent Framework: счётчик<\/title>/,
      `стриминговый head не содержит заголовок: ${streamed.head}`,
    );

    const html = await vite.transformIndexHtml(
      "/",
      pageTemplate(ssrHtml, rendered.head),
    );
    const streamPageHtml = await vite.transformIndexHtml(
      "/",
      pageTemplate(streamedHtml, streamed.head),
    );
    http = createHttpServer((request, response) => {
      if (request.url === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.url === "/?stream=1") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(streamPageHtml);
        return;
      }
      if (request.url === "/" || request.url?.startsWith("/?")) {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(html);
        return;
      }
      vite.middlewares(request, response, () => {
        response.statusCode = 404;
        response.end("not found");
      });
    });
    await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (address === null || typeof address === "string") {
      throw new Error("Не удалось определить порт SSR-сервера");
    }
    const url = `http://127.0.0.1:${address.port}/`;

    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ["--no-sandbox"],
      env: chromiumEnv(),
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

    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(
      () => document.querySelectorAll("main.app").length === 1,
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => globalThis.__silentReady === true,
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => !document.body.innerHTML.includes("data-silent-"),
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(300);

    const renderedValue = await page.textContent("strong.value");
    assert.equal(renderedValue, "0", "гидрация изменила начальное значение счётчика");
    assert.equal(
      await page.locator(".counter .icon-path").evaluate((element) => element.namespaceURI),
      "http://www.w3.org/2000/svg",
      "гидрация потеряла SVG-namespace динамического ребёнка",
    );
    assert.equal(
      await page.title(),
      "Silent Framework: счётчик",
      "гидрация не сохранила заголовок страницы",
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.click('button:has-text("+")');
      try {
        await page.waitForFunction(
          () => Number(document.querySelector("strong.value")?.textContent ?? 0) > 0,
          undefined,
          { timeout: 2_000 },
        );
        break;
      } catch {
        if (attempt === 2) {
          throw new Error("кнопка счётчика не реагирует после гидрации");
        }
      }
    }
    const counter = Number(await page.textContent("strong.value"));
    assert.ok(counter > 0, `неожиданное значение счётчика: ${String(counter)}`);
    assert.equal(Number(await page.textContent(".double")), counter * 2);

    await page.click('button:has-text("Добавить")');
    await page.waitForFunction(
      () => document.querySelectorAll("ul.items li").length === 1,
      undefined,
      { timeout: 5_000 },
    );

    const state = await page.evaluate(() => ({
      apps: document.querySelectorAll("main.app").length,
      markers: document.body.innerHTML.includes("data-silent-a-"),
      listItems: document.querySelectorAll("ul.items li").length,
      adopted: document.querySelectorAll("[data-ssr]").length,
      adoptedMain: document.querySelector("main.app")?.querySelector("h1") !== null,
      titles: document.head.querySelectorAll("title").length,
    }));
    assert.equal(state.apps, 1, "после гидрации осталось несколько копий приложения");
    assert.equal(state.markers, false, "маркеры data-silent-a-* остались в DOM");
    assert.equal(state.listItems, 1);
    assert.equal(
      state.adopted,
      1,
      "серверный узел не переиспользован: гидрация откатилась на клиентский рендер",
    );
    assert.ok(state.adoptedMain);
    assert.equal(state.titles, 1, "в head остался дубликат заголовка");
    assert.deepEqual(errors, [], `ошибки в консоли: ${errors.join(" | ")}`);

    const streamPage = await browser.newPage();
    const streamErrors = [];
    streamPage.on("console", (message) => {
      if (message.type() === "error") {
        streamErrors.push(message.text());
      }
    });
    streamPage.on("pageerror", (error) => {
      streamErrors.push(error.message);
    });
    await streamPage.goto(`${url}?stream=1`, { waitUntil: "load" });
    await streamPage.waitForFunction(
      () => globalThis.__silentReady === true,
      undefined,
      { timeout: 10_000 },
    );
    await streamPage.waitForFunction(
      () => !document.body.innerHTML.includes("silent-stream"),
      undefined,
      { timeout: 10_000 },
    );
    const streamState = await streamPage.evaluate(() => ({
      apps: document.querySelectorAll("main.app").length,
      markers: document.body.innerHTML.includes("data-silent-"),
      value: document.querySelector("strong.value")?.textContent ?? null,
      adopted: document.querySelectorAll("[data-ssr]").length,
      titles: document.head.querySelectorAll("title").length,
    }));
    assert.equal(streamState.value, "0", "стриминг изменил начальное значение счётчика");
    assert.equal(streamState.apps, 1, "после стриминга осталось несколько копий приложения");
    assert.equal(streamState.markers, false, "маркеры data-silent-* остались в DOM");
    assert.equal(streamState.adopted, 1, "стриминговая разметка не была адоптирована");
    assert.equal(streamState.titles, 1, "в head остался дубликат заголовка");
    await streamPage.click('button:has-text("+")');
    await streamPage.waitForFunction(
      () => Number(document.querySelector("strong.value")?.textContent ?? 0) > 0,
      undefined,
      { timeout: 5_000 },
    );
    assert.deepEqual(
      streamErrors,
      [],
      `ошибки в консоли стриминга: ${streamErrors.join(" | ")}`,
    );
    await streamPage.close();

    const routerDir = join(root, "examples", "router");
    const routerVite = await createServer({
      configFile: join(routerDir, "vite.config.ts"),
      root: routerDir,
      logLevel: "error",
      appType: "custom",
      server: { middlewareMode: true, hmr: false },
    });
    let routerHttp = null;
    try {
      const routerModule = await routerVite.ssrLoadModule("/src/entry-server.tsx");
      const routerRendered = await routerModule.render("/users/7", "Silent Router");
      assert.match(
        routerRendered.html,
        /Пользователь/,
        `SSR роутера не отрендерил маршрут: ${routerRendered.html.slice(0, 240)}`,
      );
      assert.match(
        routerRendered.head,
        /<title>Silent Router<\/title>/,
        `SSR роутера не отдал title: ${routerRendered.head}`,
      );
      assert.ok(
        routerRendered.html.includes("silent-router-view"),
        "SSR роутера не оставил маркер RouterView",
      );
      const routerShell = routerRendered.html.replace(
        '<header class="topbar"',
        '<header data-ssr="1" class="topbar"',
      );
      assert.ok(routerShell.includes('data-ssr="1"'));
      const routerHtml = await routerVite.transformIndexHtml(
        "/users/7",
        pageTemplate(routerShell, routerRendered.head),
      );

      routerHttp = createHttpServer((request, response) => {
        if (request.url === "/favicon.ico") {
          response.statusCode = 204;
          response.end();
          return;
        }
        if (request.url?.startsWith("/users/7")) {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(routerHtml);
          return;
        }
        routerVite.middlewares(request, response, () => {
          response.statusCode = 404;
          response.end("not found");
        });
      });
      await new Promise((resolve) => routerHttp.listen(0, "127.0.0.1", resolve));
      const routerAddress = routerHttp.address();
      if (routerAddress === null || typeof routerAddress === "string") {
        throw new Error("Не удалось определить порт SSR-сервера роутера");
      }
      const routerUrl = `http://127.0.0.1:${String(routerAddress.port)}/users/7`;

      const routerPage = await browser.newPage();
      const routerErrors = [];
      const isDevServerNoise = (text) =>
        text.includes("WebSocket") || text.includes("[vite] failed to connect");
      routerPage.on("console", (message) => {
        if (message.type() === "error" && !isDevServerNoise(message.text())) {
          routerErrors.push(message.text());
        }
      });
      routerPage.on("pageerror", (error) => {
        if (!isDevServerNoise(error.message)) {
          routerErrors.push(error.message);
        }
      });

      await routerPage.goto(routerUrl, { waitUntil: "load" });
      await routerPage.waitForFunction(
        () => globalThis.__silentReady === true,
        undefined,
        { timeout: 10_000 },
      );
      await routerPage.waitForFunction(
        () => !document.body.innerHTML.includes("data-silent-"),
        undefined,
        { timeout: 10_000 },
      );

      const routerState = await routerPage.evaluate(() => ({
        apps: document.querySelectorAll(".app").length,
        cards: document.querySelectorAll("section.card").length,
        heading: document.querySelector(".card h2")?.textContent ?? null,
        adoptedShell: document.querySelectorAll("[data-ssr]").length,
      }));
      assert.equal(routerState.apps, 1, "после гидрации осталось несколько копий приложения");
      assert.equal(routerState.cards, 1, "RouterView продублировал разметку маршрута");
      assert.equal(routerState.heading, "Пользователь 7");
      assert.equal(routerState.adoptedShell, 1, "оболочка приложения не адоптирована");

      const note = routerPage.locator(".demo-form input");
      await note.fill("draft");
      await note.evaluate((element) => element.setAttribute("data-marker", "kept"));
      await routerPage.getByRole("button", { name: /Следующий/ }).click();
      await routerPage.waitForFunction(
        () => document.querySelector(".card h2")?.textContent === "Пользователь 8",
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await note.inputValue(), "draft");
      assert.equal(await note.getAttribute("data-marker"), "kept");
      assert.equal(new URL(routerPage.url()).pathname, "/users/8");

      const aboutLink = routerPage
        .locator(".nav")
        .getByRole("link", { name: "О примере", exact: true });
      await aboutLink.click();
      await routerPage.waitForFunction(
        () => document.querySelector(".card h2")?.textContent === "О примере",
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await aboutLink.getAttribute("aria-current"), "page");
      assert.deepEqual(routerErrors, [], `ошибки в консоли роутера: ${routerErrors.join(" | ")}`);
      await routerPage.close();
    } finally {
      if (routerHttp !== null) {
        await new Promise((resolve) => routerHttp.close(resolve));
      }
      await routerVite.close();
    }

    // Сценарий формы идёт последним: после SSR полной формы последующий
    // renderToString в том же процессе получает чужой request scope
    // (форма/вложенная форма оставляют owner), и SSR роутера теряет Router.
    // Держим проверку изолированной до исправления в рантайме.
    const formsDir = join(root, "examples", "forms");
    const formsVite = await createServer({
      configFile: join(formsDir, "vite.config.ts"),
      root: formsDir,
      logLevel: "error",
      appType: "custom",
      server: { middlewareMode: true, hmr: false },
    });
    let formsHttp = null;
    try {
      const formsModule = await formsVite.ssrLoadModule("/src/entry-server.tsx");
      const formsRendered = await formsModule.render("/");
      const formsMarkup = formsRendered.html.replace(
        '<form class="profile"',
        '<form data-ssr="1" class="profile"',
      );

      assert.match(
        formsMarkup,
        /<form data-ssr="1" class="profile"/,
        "SSR формы не отрендерил форму профиля",
      );
      assert.match(
        formsMarkup,
        /id="profile-name"[^>]*required=""/,
        `SSR формы потерял required у поля name: ${formsMarkup.slice(0, 400)}`,
      );
      assert.match(
        formsMarkup,
        /id="profile-email"[^>]*aria-required="true"/,
        "SSR формы потерял aria-required у поля email",
      );
      assert.ok(
        formsMarkup.includes('id="profile-address.city"') &&
          formsMarkup.includes('id="profile-address.state"'),
        "SSR формы потерял id вложенной формы адреса",
      );
      const requiredStars =
        formsMarkup.match(/aria-hidden="true"> \*<\/span>/g)?.length ?? 0;
      assert.equal(
        requiredStars,
        4,
        `SSR формы потерял звёздочки обязательных полей: ${String(requiredStars)}`,
      );
      assert.ok(
        !formsMarkup.includes('class="error"'),
        "SSR формы сразу отрендерил ошибки валидации",
      );
      assert.match(
        formsRendered.head,
        /<title>Silent Framework: форма профиля<\/title>/,
        `SSR формы не отдал title: ${formsRendered.head}`,
      );

      const secondRender = await formsModule.render("/");
      const idsOf = (markup) =>
        (markup.match(/id="profile-[^"]*"/g) ?? []).sort();
      assert.deepEqual(
        idsOf(secondRender.html),
        idsOf(formsMarkup),
        "id формы изменились между двумя SSR-запросами",
      );

      const formsHtml = await formsVite.transformIndexHtml(
        "/",
        pageTemplate(formsMarkup, formsRendered.head),
      );

      formsHttp = createHttpServer((request, response) => {
        if (request.url === "/favicon.ico") {
          response.statusCode = 204;
          response.end();
          return;
        }
        if (request.url === "/" || request.url?.startsWith("/?")) {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(formsHtml);
          return;
        }
        formsVite.middlewares(request, response, () => {
          response.statusCode = 404;
          response.end("not found");
        });
      });
      await new Promise((resolve) =>
        formsHttp.listen(0, "127.0.0.1", resolve),
      );
      const formsAddress = formsHttp.address();
      if (formsAddress === null || typeof formsAddress === "string") {
        throw new Error("Не удалось определить порт SSR-сервера форм");
      }
      const formsUrl = `http://127.0.0.1:${String(formsAddress.port)}/`;

      const formsPage = await browser.newPage();
      const formsErrors = [];
      const formsWarnings = [];
      const isDevServerNoise = (text) =>
        text.includes("WebSocket") || text.includes("[vite] failed to connect");
      formsPage.on("console", (message) => {
        if (message.type() === "error" && !isDevServerNoise(message.text())) {
          formsErrors.push(message.text());
        } else if (message.type() === "warning") {
          formsWarnings.push(message.text());
        }
      });
      formsPage.on("pageerror", (error) => {
        if (!isDevServerNoise(error.message)) {
          formsErrors.push(error.message);
        }
      });

      await formsPage.goto(formsUrl, { waitUntil: "load" });
      await formsPage.waitForFunction(
        () => globalThis.__silentReady === true,
        undefined,
        { timeout: 10_000 },
      );
      await formsPage.waitForFunction(
        () => !document.body.innerHTML.includes("data-silent-"),
        undefined,
        { timeout: 10_000 },
      );

      const formsState = await formsPage.evaluate(() => {
        const name = document.querySelector("#profile-name");
        const email = document.querySelector("#profile-email");
        const city = document.querySelector('input[id="profile-address.city"]');
        const state = document.querySelector('select[id="profile-address.state"]');
        return {
          apps: document.querySelectorAll("main.app").length,
          adopted: document.querySelectorAll("[data-ssr]").length,
          nameId: name?.id ?? null,
          emailId: email?.id ?? null,
          cityId: city?.id ?? null,
          stateId: state?.id ?? null,
          nameRequired: name?.getAttribute("required") ?? null,
          nameAriaRequired: name?.getAttribute("aria-required") ?? null,
          nameStars:
            document.querySelectorAll(
              'label[for="profile-name"] span[aria-hidden="true"]',
            ).length,
          markers: document.body.innerHTML.includes("data-silent-"),
        };
      });
      assert.equal(formsState.apps, 1, "после гидрации осталось несколько копий формы");
      assert.equal(
        formsState.adopted,
        1,
        "серверная форма не адоптирована: гидрация откатилась на клиентский рендер",
      );
      assert.equal(formsState.nameId, "profile-name");
      assert.equal(formsState.emailId, "profile-email");
      assert.equal(formsState.cityId, "profile-address.city");
      assert.equal(formsState.stateId, "profile-address.state");
      assert.equal(formsState.nameRequired, "");
      assert.equal(formsState.nameAriaRequired, "true");
      assert.equal(formsState.nameStars, 1, "звёздочка обязательного поля пропала");
      assert.equal(formsState.markers, false, "маркеры data-silent-* остались в DOM");
      assert.equal(
        await formsPage.locator('label[for="profile-name"]').count(),
        1,
        "id поля перестал совпадать с label после гидрации",
      );

      const nameInput = formsPage.locator("#profile-name");
      const emailInput = formsPage.locator("#profile-email");
      const cityInput = formsPage.locator('input[id="profile-address.city"]');
      const stateSelect = formsPage.locator('select[id="profile-address.state"]');

      await nameInput.fill("Алиса");
      assert.equal(await nameInput.inputValue(), "Алиса", "ввод не работает после гидрации");
      await emailInput.fill("не-email");
      await emailInput.blur();
      const emailError = formsPage.locator("#profile-email-error");
      await emailError.waitFor();
      assert.equal(await emailError.getAttribute("role"), "alert");
      assert.match((await emailError.textContent()) ?? "", /email/i);

      await emailInput.fill("alice@example.com");
      const submitButton = formsPage.getByRole("button", { name: "Сохранить" });
      assert.equal(
        await submitButton.isDisabled(),
        true,
        "кнопка доступна, пока обязательные поля пусты",
      );

      await formsPage.evaluate(() => {
        const form = document.querySelector("form.profile");
        if (!(form instanceof HTMLFormElement)) {
          throw new Error("form.profile не найдена");
        }
        form.requestSubmit();
      });
      const cityError = formsPage.locator('[id="profile-address.city-error"]');
      await cityError.waitFor();
      assert.match((await cityError.textContent()) ?? "", /обязательн/i);

      await cityInput.fill("Москва");
      await stateSelect.selectOption("moscow");
      await formsPage.evaluate(() => {
        const form = document.querySelector("form.profile");
        if (!(form instanceof HTMLFormElement)) {
          throw new Error("form.profile не найдена");
        }
        form.requestSubmit();
      });
      const formsSuccess = formsPage
        .getByRole("status")
        .filter({ hasText: "Профиль сохранён: Алиса" });
      await formsSuccess.waitFor();
      assert.equal(await formsSuccess.getAttribute("aria-live"), "polite");
      assert.equal(await stateSelect.inputValue(), "moscow");
      assert.equal(
        await submitButton.isEnabled(),
        true,
        "после успешной отправки кнопка осталась disabled",
      );
      await submitButton.click();

      const formsAfterSubmit = await formsPage.evaluate(() => ({
        apps: document.querySelectorAll("main.app").length,
        markers: document.body.innerHTML.includes("data-silent-"),
        errors: document.querySelectorAll('p.error[role="alert"]').length,
      }));
      assert.equal(formsAfterSubmit.apps, 1, "отправка формы продублировала приложение");
      assert.equal(formsAfterSubmit.markers, false);
      assert.equal(formsAfterSubmit.errors, 0, "валидная отправка оставила ошибки");
      assert.deepEqual(
        formsErrors,
        [],
        `ошибки в консоли формы: ${formsErrors.join(" | ")}`,
      );
      assert.deepEqual(
        formsWarnings.filter((text) => text.includes("гидрация")),
        [],
        `предупреждения гидрации формы: ${formsWarnings.join(" | ")}`,
      );
      await formsPage.close();

      const formsServerEntry = join(formsDir, "dist", "server", "entry-server.js");
      if (existsSync(formsServerEntry)) {
        const child = spawn(process.execPath, ["server.mjs"], {
          cwd: formsDir,
          env: { ...process.env, NODE_ENV: "production", PORT: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        try {
          const prodUrl = await new Promise((resolve, reject) => {
            let output = "";
            let settled = false;
            let timer = null;
            const finish = (action) => {
              if (settled) {
                return;
              }
              settled = true;
              if (timer !== null) {
                clearTimeout(timer);
              }
              action();
            };
            timer = setTimeout(() => {
              finish(() =>
                reject(
                  new Error(`production-сервер формы не стартовал: ${output}`),
                ),
              );
            }, 15_000);
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk) => {
              output += chunk;
              const match = output.match(/forms-ssr: (http:\/\/localhost:\d+\/)/);
              if (match !== null) {
                finish(() => resolve(match[1]));
              }
            });
            child.once("exit", (code) => {
              finish(() =>
                reject(
                  new Error(
                    `production-сервер формы завершился с кодом ${String(code)}: ${output}`,
                  ),
                ),
              );
            });
          });
          const response = await fetch(prodUrl);
          assert.equal(response.status, 200, "production-сервер формы вернул не 200");
          const prodHtml = await response.text();
          assert.match(prodHtml, /id="profile-name"[^>]*required=""/);
          assert.match(prodHtml, /id="profile-address\.city"/);
          assert.match(prodHtml, /<title>Silent Framework: форма профиля<\/title>/);
          assert.ok(
            !prodHtml.includes('class="error"'),
            "production-сервер формы отдал ошибки валидации",
          );

          const prodPage = await browser.newPage();
          const prodErrors = [];
          prodPage.on("console", (message) => {
            if (message.type() === "error") {
              prodErrors.push(message.text());
            }
          });
          prodPage.on("pageerror", (error) => {
            prodErrors.push(error.message);
          });
          await prodPage.goto(prodUrl, { waitUntil: "load" });
          await prodPage.waitForFunction(
            () => globalThis.__silentReady === true,
            undefined,
            { timeout: 10_000 },
          );
          await prodPage.waitForFunction(
            () => !document.body.innerHTML.includes("data-silent-"),
            undefined,
            { timeout: 10_000 },
          );
          const prodState = await prodPage.evaluate(() => ({
            apps: document.querySelectorAll("main.app").length,
            markers: document.body.innerHTML.includes("data-silent-"),
            nameRequired:
              document.querySelector("#profile-name")?.getAttribute("required") ??
              null,
          }));
          assert.equal(prodState.apps, 1, "production-гидрация продублировала форму");
          assert.equal(prodState.markers, false);
          assert.equal(prodState.nameRequired, "");
          const prodName = prodPage.locator("#profile-name");
          await prodName.fill("Борис");
          assert.equal(await prodName.inputValue(), "Борис");
          assert.deepEqual(
            prodErrors,
            [],
            `ошибки в консоли production-формы: ${prodErrors.join(" | ")}`,
          );
          await prodPage.close();
          console.log("ssr forms: production server ok");
        } finally {
          child.kill();
          if (child.exitCode === null) {
            await new Promise((resolve) => child.once("exit", resolve));
          }
        }
      } else {
        console.log(
          "ssr forms: dist/server/entry-server.js не найден — production-проверка пропущена",
        );
      }
    } finally {
      if (formsHttp !== null) {
        await new Promise((resolve) => formsHttp.close(resolve));
      }
      await formsVite.close();
    }

    const source = readFileSync(join(example, "src", "main.tsx"), "utf8");
    assert.ok(source.includes("hydrate"), "main.tsx не использует hydrate");
  } finally {
    if (browser !== null) {
      await browser.close();
    }
    if (http !== null) {
      await new Promise((resolve) => http.close(resolve));
    }
    await vite.close();
  }

  console.log("ssr: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
