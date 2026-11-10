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

Сервер дожидается загрузки модуля и асинхронных view внутри границы, после чего сериализует итоговое содержимое. Опция `preloader` задаёт прелоадер на время рендера, `container` — DI-контейнер корневого view, а `onError` перехватывает ошибки компонентов: без обработчика первая ошибка отклоняет промис `renderToString`.

## API

| Символ | Назначение |
| --- | --- |
| `renderToString(app, options?)` | Рендерит корневой компонент в `Promise<RenderResult>`; вызовы сериализуются внутренней очередью. |
| `RenderResult` | Результат рендера: `{ html, head }`. |
| `RenderResult.html` | Сериализованная разметка приложения без `<title>`, с якорями и маркерами для гидрации. |
| `RenderResult.head` | HTML метаданных, вынесенных из дерева, в первую очередь `<title>`. |
| `RenderOptions` | Опции рендера. |
| `RenderOptions.props` | Props корневого компонента. |
| `RenderOptions.container` | DI-контейнер корневого view; по умолчанию корневой контейнер `@ivlev-dev/silent-di`. |
| `RenderOptions.preloader` | Прелоадер на время рендера. |
| `RenderOptions.onError` | Обработчик ошибок компонентов; если не задан, первая ошибка отклоняет промис. |

## Ограничения и совместимость

- Только ESM и Node.js `>=22`; пакет не содержит CommonJS-сборки.
- Мини-DOM реализует подмножество, необходимое шаблонам компилятора; произвольные браузерные API внутри компонентов недоступны.
- DOM-глобалы общие на процесс, поэтому параллелизм SSR внутри процесса ограничен внутренней очередью `renderToString`.
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
