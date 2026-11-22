# @ivlev-dev/silent-server

SSR для Silent Framework без jsdom и linkedom: собственный мини-DOM, асинхронные ViewModel и гидрация серверной разметки.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-server)](https://www.npmjs.com/package/@ivlev-dev/silent-server)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-server)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-server)](https://www.npmjs.com/package/@ivlev-dev/silent-server)

## Возможности

- `renderToString` возвращает `{ html, head }`: разметку приложения и метаданные для `<head>`.
- Собственный мини-DOM: парсер шаблонов компилятора, документ, `TreeWalker` и сериализатор без внешних DOM-зависимостей.
- Асинхронные ViewModel, `Suspense` и `lazy` дожидаются до сериализации — в результат попадает итоговое содержимое.
- `<title>` из любого компонента выносится из дерева в `RenderResult.head`, как в React 19.
- Серверные якоря и маркеры `data-silent-a-*` сохраняются для адоптации узлов при `hydrate`.
- Вызовы сериализуются внутренней очередью, а DOM-глобалы живут только на время рендера.

## Установка

```bash
pnpm add @ivlev-dev/silent-server
```

```bash
npm install @ivlev-dev/silent-server
```

```bash
yarn add @ivlev-dev/silent-server
```

Пакет поставляется как ESM с объявлениями типов и требует Node.js 22 или новее.

## Быстрый старт

```ts
import { createServer } from "node:http";
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app.js";

createServer(async (request, response) => {
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
    <script type="module" src="/client.js"></script>
  </body>
</html>`;

    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(page);
  } catch (error) {
    response.statusCode = 500;
    response.end("Internal Server Error");
    console.error(error);
  }
}).listen(3000);
```

`html` не содержит `<title>`: заголовок уже находится в `head`. Приложение должно быть собрано компилятором Silent Framework — например, плагином `@ivlev-dev/silent-vite` — так же, как для клиентского рендера.

## Гидрация на клиенте

Клиентский вход использует `hydrate` из `@ivlev-dev/silent-core` вместо `mount` и получает те же `props`, что и сервер:

```ts
import { hydrate } from "@ivlev-dev/silent-core";
import { App } from "./app.js";

const target = document.querySelector("#app");
if (target === null) {
  throw new Error("#app not found");
}

void hydrate(target, App, {
  props: { title: "Silent Framework" },
  onMismatch: (error) => console.warn(error.message),
});
```

`hydrate` не перерисовывает приложение заново: view находит свои маркеры, `templateHoles` занимает существующие узлы, а `For`, `Show`, `Suspense`, `lazy` и `fragment` адоптируют свои якоря и регионы. Маркеры `data-silent-a-*` снимаются с адоптированных элементов, значения применяются заново. Пока асинхронные ViewModel не завершились, серверная разметка остаётся видимой, а прелоадеры не показываются.

Заголовок страницы в серверной разметке отсутствует: клиент создаёт `<title>` заново и вставляет его в `document.head`. При несовпадении формы узла бросается `HydrationMismatchError`, ближайший view откатывается на клиентский рендер, а ошибка приходит в `onMismatch`.

## Асинхронные ViewModel

`renderToString` создаёт корневой компонент и ждёт его `ready`, `whenIdle` и `flushSync`, поэтому асинхронное разрешение ViewModel через DI, границы `Suspense` и загрузка `lazy` завершаются до сериализации:

```tsx
import { lazy, Suspense } from "@ivlev-dev/silent-core";

const Profile = lazy<{ id: number }>(() => import("./profile.js"));

export function App() {
  return (
    <Suspense fallback={<span>Загрузка...</span>}>
      <Profile id={1} />
    </Suspense>
  );
}
```

Сервер дожидается загрузки модуля и асинхронных view внутри границы, после чего сериализует итоговое содержимое. Опция `preloader` задаёт прелоадер на время рендера, а `onError` перехватывает ошибки компонентов: без обработчика первая ошибка отклоняет промис `renderToString`.

## DI и жизненный цикл запроса

`renderToString` создаёт на каждый рендер дочерний request scope от `options.container` (по умолчанию — глобальный `container`) и передаёт его в runtime-опции корневого компонента. В конце рендера scope освобождается, даже если рендер завершился ошибкой.

- `singleton`-привязки живут в контейнере-владельце: это process-wide состояние, общее для всех запросов. Создавайте их на общем контейнере (`options.container` или глобальном `container`) и не храните в них пользователя, tenant или другие данные запроса.
- `scoped`-привязки живут в request scope и во вложенных view-скоупах: это данные одного запроса. Экземпляры освобождаются вместе со scope, включая вызов `[Symbol.dispose]`.
- `singleton`, фабрика которого разрешает `scoped`-сервис из request scope, отклоняется `InvalidScopeError`: иначе запрос-специфичный экземпляр был бы захвачен синглтоном навсегда. Для per-request сервисов используйте `scoped` и не поднимайте их в корневой контейнер.

```ts
const app = new Container("app");
app.bind(Session, () => loadSession()).inScopedScope();
app.bind(Logger, () => new Logger());

const { html } = await renderToString(App, { container: app });
```


## Прогрессивный стриминг

`renderToStream(app, options)` возвращает `ReadableStream<string>` с телом документа. В отличие от нарезки готовой строки, первый чанк — это синхронный shell, который отдаётся до завершения `Suspense`, `lazy` и асинхронных ViewModel. `head` отдаётся через `onHead` сразу вместе с shell.

```ts
import { renderToStream } from "@ivlev-dev/silent-server";

const stream = renderToStream(App, {
  onHead(head, info) {
    if (info.final) {
      replaceHead(head);
      return;
    }
    documentHead = head;
  },
  onShell(shell) {
    shellLength = shell.length;
  },
});

for await (const chunk of stream) {
  response.write(chunk);
}
response.end();
```

Протокол:

1. Первый чанк — shell: итоговая разметка синхронной части дерева и fallback-содержимое незавершённых границ. Незавершённая граница обёрнута комментариями `<!--silent-stream:ID-->…<!--silent-stream-end:ID-->`.
2. Когда граница `Suspense`, `lazy` или асинхронная ViewModel готова, сервер дописывает чанк `<template data-silent-stream="ID">…</template><script>window.__silentStream.patch(ID)</script>`. Минимальный inline-runtime приходит один раз перед первым патчем и сам удаляет служебные узлы.
3. Патч заменяет содержимое между маркерами и удаляет сами маркеры. Итоговый DOM совпадает с разметкой `renderToString`, поэтому `hydrate` принимает её без изменений. Вложенные границы патчатся независимо; порядок чанков сохраняется.
4. `onHead(head, { final: false })` вызывается до первого чанка тела, `onHead(head, { final: true })` — только если асинхронная часть добавила метаданные. При `final: true` замените ранее отданный head.

Опции:

| Опция | Назначение |
| --- | --- |
| `onHead(head, info)` | Head доступен сразу после синхронного shell; `info.final` сообщает, что пришло финальное значение. |
| `onShell(html)` | Синхронный shell до начала асинхронных патчей. |
| `onChunk(chunk)` | Каждый фактически записанный чанк тела. |
| `chunkSize` | Максимальный размер чанка; по умолчанию 16 КиБ. Патчи также режутся по этому лимиту. |
| `nonce` | Nonce для inline-runtime и скриптов патчей (CSP). |
| `signal` | Внешняя отмена: рендер и доставка прекращаются, поток завершается `AbortError`, сессия и очередь SSR освобождаются. |
| `reader.cancel()` | Штатная отмена читателем: рендер прерывается, очередь SSR отпускается, error-chunk не отправляется. |

`reader.cancel()`, `break`/`return` в `for await` и `options.signal` останавливают рендер и отпускают очередь SSR, поэтому зависший ресурс не блокирует следующие рендеры. Разница: `options.signal` дополнительно завершает поток ошибкой `AbortError`; `reader.cancel()` считается штатным закрытием. Отмена после завершения — no-op. Без отмены и без `timeoutMs` зависший стрим удерживает очередь до собственного завершения.

Ограничения протокола:

- `head` с асинхронных границ не может попасть в HTTP-заголовки: используйте `onHead(..., { final: true })` и обновляйте head на клиенте.
- Патч вставляется через `<template>`; содержимое парсится в контексте body. Фрагменты, допустимые только внутри таблицы/`select`, требуют собственного контейнера.
- Inline-runtime требует разрешённых inline-скриптов или `nonce`. Без JS остаётся shell с fallback-содержимым.
- Ошибка после отправки shell закрывает поток ошибкой: соединение обрывается, fallback остаётся видимым. Ошибки до shell отклоняют поток без отправки тела.
- Backpressure не учитывается: чанки буферизуются в `ReadableStream`, пока читатель их не заберёт.
- Поток удерживает внутреннюю очередь SSR до завершения рендера или отмены (`reader.cancel()`/`options.signal`): другие `renderToString`/`renderToStream` ждут.

`renderToString` не изменился: он по-прежнему ждёт всё дерево и возвращает `{ html, head }` без служебных маркеров стриминга.

## Worker pool

Subpath `@ivlev-dev/silent-server/pool` добавляет opt-in worker pool для параллельного SSR. Основной процесс по-прежнему рендерит один раз за раз из-за общих DOM-глобалов; пул поднимает `worker_threads`, в каждом свой экземпляр модулей и свои DOM-шимы, поэтому задачи выполняются параллельно.

```ts
import { createRenderPool } from "@ivlev-dev/silent-server/pool";

const pool = createRenderPool<[string]>(new URL("./dist/server/entry-server.js", import.meta.url), {
  workers: 2,
  warmup: "eager",
  timeoutMs: 10_000,
});

await pool.ready();
const { html, head } = await pool.render(["/"]);
```

Entry-модуль должен быть **собранным** ESM-файлом и экспортировать `render` и/или `renderStream`:

```ts
export function render(url: string): Promise<{ html: string; head: string }> {
  return renderToString(App, { props: { url } });
}

export function renderStream(
  url: string,
  handlers: RenderStreamHandlers,
): ReadableStream<string> {
  return renderToStream(App, {
    props: { url },
    signal: handlers.signal,
    onHead: handlers.onHead,
    onShell: handlers.onShell,
  });
}
```

`renderStream` получает обработчики последним аргументом: `signal`, обязательный `onHead(head, { final })` и необязательный `onShell(html)`. Стрим отдаёт `StreamHandle` с `stream`, `head`, `finalHead`, `done` и `cancel()`; успех — только `end`, а при закрытии порта или выходе воркера до `end` задача отклоняется `worker-exited`.

| API | Назначение |
| --- | --- |
| `createRenderPool(entry, options?)` | Создаёт пул; entry — путь или `file:` URL (`data:` отклоняется). |
| `pool.render(args, options?)` | Unary-рендер: `Promise<{ html, head }>`; `options.signal`/`timeoutMs`. |
| `pool.renderStream(args, options?)` | Стриминг: сразу возвращает `StreamHandle`. |
| `pool.ready()` | Поднимает воркеры и ждёт загрузки entry. |
| `pool.stats()` | Состояние, очередь, счётчики задач и падений. |
| `pool.close({ force?, timeoutMs? })` | Идемпотентное закрытие: очередь отклоняется, стримы отменяются, unary-задачи доигрываются; `timeoutMs: 0` или `force: true` завершают воркеры сразу. |
| `pool[Symbol.asyncDispose]()` | То же, что `close()`; работает с `await using`. |

Опции: `workers` (по умолчанию `min(4, availableParallelism())`), `warmup` (`"lazy"`/`"eager"`), `timeoutMs` (30 с; ограничивает ожидание в очереди и отдельно — выполнение; таймаут очереди не завершает воркер), `idleTimeoutMs` (равен `timeoutMs`; продлевается на `head`/`shell`/чанках, на каждом чтении consumer'а и на `resume`, тикает и на паузе; `0` отключает только простой), `terminateGraceMs` (500 мс), `maxQueue` (`workers * 64`), `maxTasksPerWorker`, `name`, `env`, `execArgv`, `resourceLimits`, `onEvent`, `onError`.

Инфраструктурные ошибки — экземпляры `PoolError`, класс экспортируется из subpath: проверяйте `error instanceof PoolError`, а причину — по полю `code`: `pool-closed`, `queue-full`, `args-not-cloneable`, `entry-load-failed`, `worker-start-failed`, `protocol-mismatch`, `render-unsupported`, `stream-unsupported`, `stream-contract`, `stream-head-missing`, `stream-overflow`, `worker-exited`, `busy`, `timeout` (`name: "TimeoutError"`), `aborted` (`name: "AbortError"`). Ошибки entry сохраняют `name`/`message`/`stack`/`code`/`cause`, но не проходят `instanceof` исходного класса. Некорректное сообщение воркера переводит пул в `state: "failed"` (`protocol-mismatch`), не роняя процесс.

Ограничения:

- entry должен быть собран Vite/`tsc`; `vite.ssrLoadModule`, dev-модули и `data:` URL не поддерживаются;
- падение воркера до `ready` без оставшихся готовых воркеров сразу переводит пул в `failed` (`entry-load-failed`); если пул уже обслуживает запросы, boot-воркер рестартует; падения после `ready` рестартуют воркер, пока их не станет больше 5 за 30 с;
- `singleton`-привязки DI, кэши и модульное состояние — per-worker, а `process.env` фиксируется при спавне воркера;
- один job на воркер; вложенный `renderToString`/`renderToStream` внутри активного рендера запрещён;
- аргументы проходят structured clone и бюджет 8 × 1024 × 1024 единиц / глубину 64; превышение даёт `args-not-cloneable`;
- честного backpressure нет: `highWaterMark` (64 × 1024 символов) и `maxBufferedChars` (4 000 000) ограничивают буфер пула, а переполнение даёт `stream-overflow`;
- финальный head после отправки `<head>` применить нельзя — используйте shell-head; `finalHead` годится для логов/трейлера;
- `worker.terminate()` не выполняет `finally`, поэтому не полагайтесь на очистку в `finally` при таймауте/отмене.

**Не бандлите subpath `/pool`.** Путь к воркеру вычисляется как `new URL("./worker-main.js", import.meta.url)`, поэтому `@ivlev-dev/silent-server/pool` должен загружаться из `node_modules` как есть; после бандлинга в один файл `worker-main.js` рядом не окажется.

Подробный гайд: [docs/guides/ssr-pool.md](https://github.com/ivlev-dev/silent-framework/blob/main/docs/guides/ssr-pool.md). Пример: [examples/ssr-pool](https://github.com/ivlev-dev/silent-framework/tree/main/examples/ssr-pool).

## API

| Символ | Назначение |
| --- | --- |
| `renderToString(app, options?)` | Рендерит корневой компонент в `Promise<RenderResult>`; вызовы сериализуются внутренней очередью. |
| `renderToStream(app, options?)` | Возвращает `ReadableStream<string>` с прогрессивным shell и патчами границ. |
| `RenderResult` | Результат рендера: `{ html, head }`. |
| `RenderResult.html` | Сериализованная разметка приложения без `<title>`, с якорями и маркерами для гидрации. |
| `RenderResult.head` | HTML метаданных, вынесенных из дерева, в первую очередь `<title>`. |
| `RenderOptions` | Опции рендера. |
| `RenderOptions.props` | Props корневого компонента. |
| `RenderOptions.container` | Базовый DI-контейнер; на каждый рендер от него создаётся дочерний request scope. По умолчанию — корневой контейнер `@ivlev-dev/silent-di`. |
| `RenderOptions.preloader` | Прелоадер на время рендера. |
| `RenderOptions.onError` | Обработчик ошибок компонентов; если не задан, первая ошибка отклоняет промис. |

## Ограничения и совместимость

- Только ESM и Node.js `>=22`; пакет не содержит CommonJS-сборки.
- Мини-DOM реализует подмножество, необходимое шаблонам компилятора; произвольные браузерные API внутри компонентов недоступны.
- DOM-глобалы общие на процесс, поэтому параллелизм SSR внутри процесса ограничен внутренней очередью `renderToString`.
- Root bindings в DI общие для процесса, а `scoped`-bindings изолированы request scope каждого вызова `renderToString`.
- В Vite-сборке держите рантайм внешним, иначе приложение и `renderToString` получат разные экземпляры модулей:

```ts
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
});
```

- Гидрация адоптирует только значения, созданные через `template()`/`templateHoles()`; DOM, собранный вручную, рендерится клиентски.
- `<title>` должен быть прямым потомком корневого элемента шаблона view; вложенные глубже заголовки вызывают откат к клиентскому рендеру.
- Несколько заголовков одновременно не дедуплицируются — рендерите один `<title>`. Заголовки внутри `<svg>` и с `itemProp` не выносятся в `head`.

## Ссылки

- Репозиторий: https://github.com/ivlev-dev/silent-framework
- Документация: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/core.md
- CHANGELOG: https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md
- Issues: https://github.com/ivlev-dev/silent-framework/issues

---

MIT © ivlev-dev
