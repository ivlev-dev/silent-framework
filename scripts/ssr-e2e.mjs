import assert from "node:assert/strict";
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
