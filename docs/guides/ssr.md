# SSR и деплой

Silent Framework рендерит приложение в HTML на Node без jsdom и linkedom: `@ivlev-dev/silent-server` содержит собственный мини-DOM, дожидается асинхронных ViewModel, `Suspense` и `lazy`, а клиент затем адоптирует готовую разметку через `hydrate`. Гайд описывает серверный рендер, сборку клиента и сервера, передачу props, продакшен-сервер и диагностику расхождений. Материал актуален для версии 0.12.0.

Пакет поставляется как ESM и требует Node.js 22 или новее:

```bash
pnpm add @ivlev-dev/silent-server
```

## Как устроен SSR

`renderToString` не использует браузер и внешние DOM-библиотеки. Внутри `@ivlev-dev/silent-server` находятся парсер шаблонов компилятора, реализация `Document`/`Element`/`Text`/`Comment`, `TreeWalker` и сериализатор с экранированием и void-тегами.

Порядок работы:

1. Вызовы сериализуются внутренней очередью, потому что DOM-глобалы (`document`, `Node`, `Element`, `Text`, `Comment`, `HTMLTemplateElement` и другие) общие на процесс.
2. Создаётся документ мини-DOM, глобалы устанавливаются на время рендера и восстанавливаются в `finally`.
3. Включается серверный режим: `templateHoles` сохраняет атрибуты `data-silent-a-N`, по которым клиент находит узлы с динамическими значениями.
4. Создаётся корневой компонент, затем последовательно ожидаются `ready`, `whenIdle` и `flushSync`. Поэтому асинхронные ViewModel, границы `Suspense` и загрузка `lazy` завершаются до сериализации.
5. Метаданные страницы (`title`, `meta`, `link`) выносятся из дерева в `RenderResult.head`, а `html` возвращается без них.
6. Корневой компонент демонтируется: ViewModel проходит `unmounted` и `dispose`.

В разметке остаются якоря и маркеры, которые нужны гидрации:

- `silent-view` и `silent-view-end` — границы view;
- `silent-item` и `silent-end` — элементы и конец списка `For`;
- `silent-show`, `silent-suspense`, `silent-fragment`, `silent-lazy` — границы соответствующих конструкций;
- `silent-hole-N` — динамические вставки шаблона;
- `silent-insert` и `silent-insert-end` — регионы значений `insert` для компонентов, узлов и вставок после статического текста;
- `data-silent-a-N` — адоптируемые узлы и их атрибуты.

На клиенте `hydrate` не клонирует разметку заново, а забирает существующие узлы: `template`/`templateHoles` находят дыры и атрибуты по маркерам в серверном DOM, а `insert` привязывает текстовые значения к существующим `Text`. После адоптации маркеры `data-silent-a-*` снимаются, а значения применяются заново. Пока асинхронные ViewModel не завершились, серверная разметка остаётся видимой и прелоадеры не показываются.

## renderToString

```ts
function renderToString(
  app: AnyComponent,
  options?: RenderOptions,
): Promise<RenderResult>;
```

`RenderResult` содержит два поля: `html` — разметку приложения без метаданных, `head` — сериализованные `title`, `meta` и `link`. `RenderOptions` принимает `props`, `container`, `preloader`, `onError`, `markers`, `signal` и `timeoutMs`. Если `onError` не задан, первая ошибка резолва или загрузки отклоняет промис `renderToString`.

`markers: false` удаляет из `html` и `head` служебные комментарии `silent-*` и атрибуты `data-silent-*` во время обхода дерева: разметка уменьшается, но не подходит для `hydrate`. В `renderToStream` эта опция тоже работает и дополнительно отключает патчи `Suspense` вместе с inline-runtime: поток отдаёт только синхронный shell, а разметка остаётся негидрируемой.

`signal` и `timeoutMs` ограничивают ожидание асинхронных ViewModel, `Suspense` и `lazy`. При отмене или превышении таймаута промис отклоняется `DOMException` с `name: "AbortError"` или `"TimeoutError"`, а сессия рендера, DOM-глобалы и request scope освобождаются. Уже aborted `signal` отклоняет вызов сразу, без создания сессии. Следующий рендер после таймаута или отмены работает как обычно:

```ts
const controller = new AbortController();

try {
  const { html } = await renderToString(App, {
    props,
    signal: controller.signal,
    timeoutMs: 5_000,
  });
  // ...
} catch (error) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    // Отдать fallback или 504.
  }
  throw error;
}
```

На каждый рендер `renderToString` создаёт дочерний request scope от `options.container` (по умолчанию — глобальный `container`) и освобождает его в конце, даже при ошибке. `singleton`-привязки базового контейнера — process-wide состояние, общее для всех запросов; `scoped`-привязки изолированы request scope. Singleton-фабрика, разрешающая `scoped`-сервис из request scope, отклоняется `InvalidScopeError` — не храните данные пользователя или tenant в общих синглтонах.

Минимальный HTTP-сервер на `node:http`:

```js
import { createServer } from "node:http";
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./dist/server/entry-server.js";

const server = createServer(async (request, response) => {
  try {
    const { html, head } = await renderToString(App, {
      props: { title: "Silent Framework" },
    });

    const page = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${head}
  </head>
  <body>
    <div id="app">${html}</div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>`;

    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-cache");
    response.end(page);
  } catch (error) {
    console.error(error);
    response.statusCode = 500;
    response.end("Internal Server Error");
  }
});

server.listen(3000);
```

`html` уже содержит якоря и `data-silent-a-*`, поэтому вставлять его внутрь контейнера нужно как есть, без экранирования. `head` вставляется в `head` документа; заголовок в `html` отсутствует.

## renderToStream

```ts
function renderToStream(
  app: AnyComponent,
  options?: StreamOptions,
): ReadableStream<string>;
```

`StreamOptions` расширяет `RenderOptions` полями `chunkSize`, `onHead`, `onShell`, `onChunk`, `nonce` и `signal`. Размер чанка по умолчанию — 16 КиБ; неположительное значение заменяется на значение по умолчанию.

Это прогрессивный стриминг. Первый чанк — синхронный shell: разметка синхронной части дерева и fallback-содержимое незавершённых границ. Он уходит клиенту до завершения `Suspense`, `lazy` и асинхронных ViewModel; когда граница готова, сервер дописывает патч.

```js
import { createServer } from "node:http";
import { renderToStream } from "@ivlev-dev/silent-server";
import { App } from "./dist/server/entry-server.js";

const server = createServer(async (request, response) => {
  let head = "";
  const stream = renderToStream(App, {
    props: { title: "Silent Framework" },
    chunkSize: 8 * 1024,
    nonce: response.getHeader("x-nonce") ?? undefined,
    onHead(next, info) {
      head = next;
      if (info.final) {
        // Асинхронная часть добавила метаданные: обновите head на клиенте.
      }
    },
    onShell() {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8" />${head}</head><body><div id="app">`);
    },
  });

  try {
    for await (const chunk of stream) {
      response.write(chunk);
    }
    response.end('</div><script type="module" src="/assets/main.js"></script></body></html>');
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.statusCode = 500;
    }
    response.end("Internal Server Error");
  }
});

server.listen(3000);
```

Протокол:

1. Первый чанк — shell. Незавершённая граница обёрнута комментариями `<!--silent-stream:ID-->…<!--silent-stream-end:ID-->`.
2. Когда граница `Suspense`, `lazy` или асинхронная ViewModel готова, сервер дописывает чанк `<template data-silent-stream="ID">…</template><script>window.__silentStream.patch(ID)</script>`. Минимальный inline-runtime приходит один раз перед первым патчем и сам удаляет служебные узлы.
3. Патч заменяет содержимое между маркерами и удаляет сами маркеры. Итоговый DOM совпадает с разметкой `renderToString`, поэтому `hydrate` принимает её без изменений. Вложенные границы патчатся независимо; порядок чанков сохраняется.
4. `onHead(head, { final: false })` вызывается до первого чанка тела, `onHead(head, { final: true })` — только если асинхронная часть добавила метаданные. При `final: true` замените ранее отданный head.

| Опция | Назначение |
| --- | --- |
| `onHead(head, info)` | Head доступен сразу после синхронного shell; `info.final` сообщает, что пришло финальное значение. |
| `onShell(html)` | Синхронный shell до начала асинхронных патчей. |
| `onChunk(chunk)` | Каждый фактически записанный чанк тела. |
| `chunkSize` | Максимальный размер чанка; по умолчанию 16 КиБ. Патчи также режутся по этому лимиту. |
| `nonce` | Nonce для inline-runtime и скриптов патчей (CSP). |
| `markers` | При `false` не пишет маркеры и `data-silent-*`, а также отключает патчи и inline-runtime; итоговый поток негидрируем. |
| `signal` | Отмена рендера и доставки. Промис/поток отклоняются `AbortError`, сессия и DOM-глобалы освобождаются. |
| `timeoutMs` | Предельное время ожидания асинхронного рендера. По истечении поток закрывается `TimeoutError`. |

Ограничения протокола:

- `head` с асинхронных границ не может попасть в HTTP-заголовки: используйте `onHead(..., { final: true })` и обновляйте head на клиенте.
- Патч вставляется через `<template>`; содержимое парсится в контексте body. Фрагменты, допустимые только внутри таблицы/`select`, требуют собственного контейнера.
- Inline-runtime требует разрешённых inline-скриптов или `nonce`. Без JS остаётся shell с fallback-содержимым.
- Ошибка после отправки shell закрывает поток ошибкой: соединение обрывается, fallback остаётся видимым. Ошибки до shell отклоняют поток без отправки тела.
- Backpressure не учитывается: чанки буферизуются в `ReadableStream`, пока читатель их не заберёт.
- Поток удерживает внутреннюю очередь SSR до завершения рендера: другие `renderToString`/`renderToStream` ждут.
- При `markers: false` поток остаётся негидрируемым: досылка готовых `Suspense`/`lazy`-границ отключена, в ответе только синхронный shell с fallback.

`renderToString` не изменился: он ждёт всё дерево и возвращает `{ html, head }` без служебных маркеров стриминга.

## Сборка клиента

Клиент собирается обычным `vite build` с плагином `@ivlev-dev/silent-vite`. Плагин компилирует view, шаблоны и метаданные компонентов; без него JSX не получит нужную серверу и клиенту форму.

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
  build: {
    outDir: "dist/client",
  },
});
```

`index.html` содержит контейнер и клиентский вход:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Точка входа использует `hydrate`, а не `mount`:

```tsx
import { hydrate } from "@ivlev-dev/silent-core";
import { App } from "./app";

const target = document.querySelector("#app");
if (!(target instanceof Element)) {
  throw new Error("#app not found");
}

void hydrate(target, App, {
  props: { title: "Silent Framework" },
  onMismatch: (error) => console.warn(error.message),
});
```

После сборки `dist/client/index.html` содержит ссылки на хешированные JS- и CSS-файлы. Этот файл удобно читать на сервере и использовать как шаблон страницы: хешированные ассеты не нужно перечислять вручную.

## Сборка сервера

Серверный модуль приложения собирается отдельным конфигом Vite с SSR build. Рантайм `@ivlev-dev/silent-*` обязательно держите внешним через `ssr.external`: иначе Vite встроит вторую копию `@ivlev-dev/silent-core` в серверный граф, и приложение с `renderToString` получат разные экземпляры модулей с разными `whenIdle` и `setServerMode`.

`vite.ssr.config.ts`:

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
  ssr: {
    external: [
      "@ivlev-dev/silent-core",
      "@ivlev-dev/silent-di",
      "@ivlev-dev/silent-reactivity",
      "@ivlev-dev/silent-server",
    ],
  },
  build: {
    ssr: "src/entry-server.ts",
    outDir: "dist/server",
    copyPublicDir: false,
  },
});
```

`src/entry-server.ts` экспортирует приложение для HTTP-сервера:

```ts
export { App } from "./app";
```

Сборка и запуск:

```bash
vite build
vite build --config vite.ssr.config.ts
node server.mjs
```

В результате `dist/client` содержит клиентские ассеты и `index.html`, а `dist/server/entry-server.js` — серверный модуль приложения. Сам HTTP-сервер можно держать отдельным `.mjs`-файлом и не собирать: он импортирует готовый `entry-server.js` и `@ivlev-dev/silent-server`.

Альтернативы для серверной части:

- `tsx server.ts` — запуск TypeScript-сервера без отдельной компиляции. `tsx` не применяет компилятор Silent Framework, поэтому приложение всё равно должно быть собрано Vite или загружено через dev-сервер.
- `tsc -p tsconfig.server.json` — компиляция серверного файла в JavaScript. Как и `tsx`, `tsc` не заменяет silent-компилятор: для view нужен плагин.
- В разработке удобно не собирать приложение, а загружать его через Vite: `vite.createServer({ server: { middlewareMode: true }, appType: "custom" })` и `vite.ssrLoadModule("/src/app.tsx")`. Этот сценарий используется в `scripts/ssr-e2e.mjs`.

## Сопоставление props

Сервер и клиент должны получить одинаковые props. Гидрация не сверяет props напрямую: она сверяет форму серверных узлов с тем, что рендерит клиент. Если props различаются, разметка может не совпасть, и view откатится на клиентский рендер; если разметка случайно совпадёт, приложение останется с неверным состоянием.

Props не сериализуются автоматически. Их нужно передать на клиент явно, например через JSON в документе:

```ts
const props = {
  title: "Silent Framework",
  user: { id: 1, name: "Ада" },
};

const { html, head } = await renderToString(App, { props });
const serialized = JSON.stringify(props).replace(/</g, "\\u003c");
```

В шаблоне страницы:

```html
<script>window.__SILENT_PROPS__ = ${serialized};</script>
```

На клиенте:

```ts
declare global {
  interface Window {
    __SILENT_PROPS__?: Record<string, unknown>;
  }
}

const target = document.querySelector("#app");
if (!(target instanceof Element)) {
  throw new Error("#app not found");
}

const props = window.__SILENT_PROPS__ ?? {};
void hydrate(target, App, { props });
```

Правила:

- props должны быть JSON-сериализуемыми; функции, классы, `Map`, `Set` и циклические ссылки так передать нельзя;
- экранируйте `<` в JSON, чтобы строка не закрыла тег `script`;
- не передавайте в props секреты, токены и данные, которые клиент не должен видеть;
- данные, зависящие от пользователя, вычисляйте одинаково на сервере и на клиенте либо передавайте с сервера целиком.

## Продакшен-сервер

Для продакшена важны три вещи: отдача хешированных ассетов с долгим кэшем, отдача HTML с проверкой актуальности и корректная обработка ошибок рендера.

Вариант на `node:http`:

```js
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./dist/server/entry-server.js";

const clientDir = join(process.cwd(), "dist/client");
const assetsDir = join(clientDir, "assets");
const template = await readFile(join(clientDir, "index.html"), "utf8");

const contentTypes = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname.startsWith("/assets/")) {
    const filePath = join(clientDir, url.pathname);
    if (!filePath.startsWith(`${assetsDir}/`)) {
      response.statusCode = 403;
      response.end("Forbidden");
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        throw new Error("not a file");
      }
      response.setHeader(
        "content-type",
        contentTypes[extname(filePath)] ?? "application/octet-stream",
      );
      response.setHeader("cache-control", "public, max-age=31536000, immutable");
      createReadStream(filePath).pipe(response);
    } catch {
      response.statusCode = 404;
      response.end("Not Found");
    }
    return;
  }

  try {
    const props = { title: "Silent Framework" };
    const { html, head } = await renderToString(App, { props });
    const page = template
      .replace("</head>", `${head}</head>`)
      .replace('<div id="app"></div>', `<div id="app">${html}</div>`);

    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "public, max-age=0, must-revalidate");
    response.end(page);
  } catch (error) {
    console.error(error);
    response.statusCode = 500;
    response.end("Internal Server Error");
  }
});

server.listen(3000);
```

Тот же сценарий на Express:

```js
import express from "express";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./dist/server/entry-server.js";

const clientDir = join(process.cwd(), "dist/client");
const template = await readFile(join(clientDir, "index.html"), "utf8");
const app = express();

app.use(
  "/assets",
  express.static(join(clientDir, "assets"), {
    immutable: true,
    maxAge: "1y",
  }),
);

app.use(async (request, response, next) => {
  try {
    const props = { title: "Silent Framework" };
    const { html, head } = await renderToString(App, { props });
    const page = template
      .replace("</head>", `${head}</head>`)
      .replace('<div id="app"></div>', `<div id="app">${html}</div>`);

    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "public, max-age=0, must-revalidate");
    response.send(page);
  } catch (error) {
    next(error);
  }
});

app.use((error, request, response, next) => {
  console.error(error);
  response.status(500).type("text").send("Internal Server Error");
});

app.listen(3000);
```

Заголовки кэширования:

- файлы в `/assets` имеют хеш в имени и не меняются — `cache-control: public, max-age=31536000, immutable`;
- HTML зависит от props, cookies и деплоя — используйте `no-cache` или `public, max-age=0, must-revalidate`;
- если ответ зависит от пользователя, добавьте `private` и `Vary: Cookie`, иначе CDN может отдать чужую разметку.

`renderToString` выполняет рендеры последовательно внутри процесса из-за общих DOM-глобалов. Для нагрузки запускайте несколько процессов Node (например, через кластер или несколько реплик), а не рассчитывайте на параллелизм внутри одного процесса.

## Диагностика

При расхождении серверной и клиентской разметки бросается `HydrationMismatchError`:

```ts
class HydrationMismatchError extends Error {
  readonly name: "HydrationMismatchError";
}
```

Ошибка возникает при адоптации шаблона, якоря или региона вставки. Рантайм ловит её, ближайший view отказывается от адоптации и рендерится клиентски, а сама ошибка передаётся в `onMismatch`. Если обработчик не задан, выводится предупреждение в консоль.

```ts
import { hydrate } from "@ivlev-dev/silent-core";

const target = document.querySelector("#app");
if (!(target instanceof Element)) {
  throw new Error("#app not found");
}

void hydrate(target, App, {
  props,
  onMismatch: (error) => {
    console.warn(error.name, error.message);
    reportToMonitoring(error);
  },
});
```

Типичные причины расхождения:

- на сервер и клиент переданы разные props или данные из БД/кэша успели измениться;
- в разметке участвуют `Date.now()`, `Math.random()`, текущая локаль или часовой пояс;
- ветвление зависит от `typeof window`, `window` или `document` внутри компонента;
- компонент собирает DOM вручную, а не через `template()`/`templateHoles()`;
- `title` находится не прямым потомком корневого элемента шаблона view;
- сервер и клиент используют разные DI-контейнеры или разные реализации одного интерфейса;
- серверная разметка была изменена прокси, CDN или middleware до гидрации.

Ошибки самого серверного рендера обрабатываются опцией `onError`:

```ts
import { renderToString } from "@ivlev-dev/silent-server";

const { html, head } = await renderToString(App, {
  props,
  onError: (error, component) => {
    console.error("SSR error in", component, error);
  },
});
```

Если `onError` задан, обработчик вызывается, а рендер завершается. Без обработчика первая ошибка отклоняет промис `renderToString`, и HTTP-сервер должен вернуть 500.

Для отладки сравнивайте `html` из `renderToString` с разметкой, которую клиент строит при обычном `mount` с теми же props: различия в структуре узлов и есть источник расхождения.

## Ограничения

- Мини-DOM реализует только подмножество, необходимое шаблонам компилятора. События и `replaceChildren` не поддерживаются, интерактивные эффекты на сервере выполняются, но ничего не делают.
- Внутри компонентов нельзя рассчитывать на произвольные браузерные API: `window`, `document` и навигация доступны только на клиенте.
- Поддерживается один заголовок страницы. Несколько одновременных `title` не дедуплицируются, поэтому рендерите один `title`.
- `title` должен быть прямым потомком корневого элемента шаблона view. Заголовки внутри `svg` и элементы с `itemprop` в `head` не выносятся.
- Гидрация адоптирует только разметку, созданную через `template()`/`templateHoles()`. Произвольный DOM, собранный вручную, рендерится клиентски.
- DOM-глобалы общие на процесс, поэтому параллельные вызовы `renderToString` сериализуются внутренней очередью.
- Пакет поставляется только как ESM и требует Node.js 22 или новее.
- `RenderResult.head` содержит только сериализованные метаданные. Состояние приложения, кэши, пользовательские данные и сигналы автоматически не передаются — их нужно сериализовать в props или отдельный скрипт самостоятельно.
