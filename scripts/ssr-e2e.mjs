import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { renderToString } from "@silent/server";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const example = join(root, "examples", "counter");

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

function pageTemplate(ssrHtml) {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Silent Framework SSR</title>
  </head>
  <body>
    <div id="app">${ssrHtml}</div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
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

    assert.match(
      rendered.html,
      /<strong class="value">0/,
      `SSR не содержит начального значения счётчика: ${rendered.html.slice(0, 240)}`,
    );
    assert.ok(
      rendered.html.includes("Счётчик"),
      "SSR не содержит заголовка счётчика",
    );
    assert.ok(
      rendered.html.includes("data-silent-a-"),
      "SSR не сохранил маркеры data-silent-a-*",
    );

    const html = await vite.transformIndexHtml("/", pageTemplate(rendered.html));
    http = createHttpServer((request, response) => {
      if (request.url === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
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

    const renderedValue = await page.textContent("strong.value");
    assert.equal(renderedValue, "0", "гидрация изменила начальное значение счётчика");

    await page.click('button:has-text("+")');
    await page.waitForFunction(
      () => document.querySelector("strong.value")?.textContent === "2",
      undefined,
      { timeout: 5_000 },
    );
    assert.equal(await page.textContent(".double"), "4");

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
    }));
    assert.equal(state.apps, 1, "после гидрации осталось несколько копий приложения");
    assert.equal(state.markers, false, "маркеры data-silent-a-* остались в DOM");
    assert.equal(state.listItems, 1);
    assert.deepEqual(errors, [], `ошибки в консоли: ${errors.join(" | ")}`);

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
