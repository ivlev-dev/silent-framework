# Silent Framework

Легковесный фронтенд-фреймворк с гранулярной реактивностью, компилируемым JSX, MVVM и compile-time DI.

## Возможности

- Сигналы, мемо, эффекты, батчинг и точечные обновления DOM без виртуального DOM.
- Stage-3 декораторы `@reactive`, `@computed`, `@watch`.
- Глубокая реактивность объектов и массивов, включая `push`, `splice`, `sort`.
- MVVM: каждый view получает ViewModel через async DI.
- DI без декораторов: интерфейсы, автопоиск реализаций, скоупы, кеш промисов, обнаружение циклов.
- Компилятор на Rust + `swc_core` и нативный Node-API addon.
- Vite 8 плагин с полной компиляцией TS/TSX и HMR.
- Прелоадеры на уровне view и HMR с сохранением состояния.
- `For`, `Index`, `Show`, `Switch`/`Match`, `ErrorBoundary`: keyed- и неключевые списки, условный рендер и границы ошибок.
- `Suspense` и `lazy`: асинхронные границы и отложенная загрузка модулей.
- SSR без внешних DOM-зависимостей (`@ivlev-dev/silent-server`), `renderToStream` и гидрация без вспышки прелоадера.
- `<title>`, `<meta>` и `<link>` из любого компонента выносятся в `<head>` — как в React 19, с SSR-поддержкой.
- Справочник API с автопроверкой полноты (`pnpm api:check`).

## Установка

```bash
pnpm add @ivlev-dev/silent-core @ivlev-dev/silent-di @ivlev-dev/silent-reactivity
pnpm add -D @ivlev-dev/silent-vite
# для SSR:
pnpm add @ivlev-dev/silent-server
```

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
});
```

По умолчанию плагин компилирует TS/TSX с `target: "es2024"`, включает source maps и HMR.

## Компонент и ViewModel

```tsx
import { computed, reactive, ViewModel, watch } from "@ivlev-dev/silent-core";

function CounterPreloader() {
  return <span>Загрузка...</span>;
}

export class CounterVM extends ViewModel<{ step: number }> {
  @reactive accessor count = 0;

  @computed get double() {
    return this.count * 2;
  }

  @watch((vm: CounterVM) => vm.count, { immediate: true })
  onCount(next: number, prev: number | undefined): void {
    console.log(prev, next);
  }

  increment(): void {
    this.count += this.props.step;
  }
}

export function Counter(
  this: { vm: CounterVM; preloader: typeof CounterPreloader },
  props: { step: number },
) {
  return (
    <div>
      <button onClick={() => this.vm.increment()}>+</button>
      <span>{this.vm.count}</span>
      <span>{this.vm.double}</span>
    </div>
  );
}
```

`vm` и `preloader` извлекаются из `this`-типа компилятором. `<Counter step={2} />` типизируется без параметра `vm`.

Если `preloader` не указан, используется глобальный прелоадер или пустой якорь. Опция плагина `requirePreloader: true` делает его обязательным.

## Списки и условия

```tsx
<For each={this.vm.items}>{(item) => <li>{item.name}</li>}</For>
<Index each={this.vm.numbers}>{(value) => <li>{value()}</li>}</Index>
<Show when={this.vm.ready} fallback={<b>нет</b>}>готово</Show>
<Switch fallback={<span>неизвестно</span>}>
  <Match when={this.vm.status === "error"}><ErrorView /></Match>
  <Match when={this.vm.status === "ok"}><ContentView /></Match>
</Switch>
<ErrorBoundary fallback={(error, reset) => <button onClick={reset}>{String(error)}</button>}>
  <Profile />
</ErrorBoundary>
```

- `For` — keyed-список: узлы привязаны к значениям, перестановки сохраняют DOM.
- `Index` — неключевой список: узлы закреплены за позициями, обновляется только содержимое.
- `Show` и `Switch`/`Match` — условный рендер; `Match` выбирается первой правдивой веткой.
- `ErrorBoundary` ловит синхронные ошибки рендера и асинхронные ошибки дочерних view; `reset()` повторяет рендер.

## Suspense и lazy

```tsx
import { lazy, Suspense } from "@ivlev-dev/silent-core";

const Profile = lazy<{ id: number }>(() => import("./profile"));

export function App() {
  return (
    <Suspense fallback={<span>Загрузка...</span>}>
      <Profile id={1} />
    </Suspense>
  );
}
```

`Suspense` держит fallback, пока не завершатся все асинхронные view внутри. `lazy` кеширует загрузку модуля на обёртку, поддерживает `preloader` и `onError` в опциях.

## SSR и гидрация

Серверный рендер не тащит jsdom или linkedom: в `@ivlev-dev/silent-server` собственный мини-DOM (парсер шаблонов компилятора, документ, TreeWalker, сериализатор).

```ts
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";

const { html, head } = await renderToString(App, { props: { title: "Hi" } });

const page = `<!doctype html><html><head>${head}</head><body><div id="app">${html}</div></body></html>`;
```

`<title>`, `<meta>` и `<link>` можно рендерить прямо во view — они уедут в `head`, а в SSR попадут в `head` результата:

```tsx
export function Page(this: { vm: PageVM }, props: { name: string }) {
  return (
    <div>
      <title>{`Профиль ${props.name}`}</title>
      <h1>{props.name}</h1>
    </div>
  );
}
```

Несколько одновременных заголовков не дедуплицируются (как в React 19 — рендерите один), `<title>` внутри `<svg>` и метаданные с `itemProp` не выносятся.

Тело можно отдавать чанками через `renderToStream` — `head` приходит в `onHead` до первого чанка:

```ts
import { renderToStream } from "@ivlev-dev/silent-server";

const stream = renderToStream(App, {
  onHead: (head) => res.write(`<!doctype html><html><head>${head}</head><body>`),
});

for await (const chunk of stream) {
  res.write(chunk);
}
res.end("</body></html>");
```

Рендер дожидается асинхронных ViewModel, `Suspense` и `lazy`, сериализует дерево с якорями и серверными маркерами атрибутов. Вызовы сериализуются внутренней очередью, DOM-глобалы живут только на время рендера.

На клиенте используйте `hydrate` вместо `mount`:

```ts
import { hydrate } from "@ivlev-dev/silent-core";

void hydrate("#app", App, { props: { title: "Hi" } });
```

`hydrate` не трогает серверную разметку, пока не завершатся все асинхронные ViewModel, и **переиспользует серверные узлы**: шаблоны, компоненты, списки, `Show`, `Suspense` и `lazy` адоптируют существующую разметку и привязывают к ней эффекты. При несовпадении формы узла ближайший view отказывается от адоптации и рендерится клиентски; ошибка приходит в `onMismatch`.

Для SSR-сборки Vite держите рантайм внешним, иначе приложение получит вторую копию рантайма и гидрация не дождётся компонентов:

```ts
export default defineConfig({
  plugins: [silent()],
  ssr: {
    external: ["@ivlev-dev/silent-core", "@ivlev-dev/silent-di", "@ivlev-dev/silent-reactivity", "@ivlev-dev/silent-server"],
  },
});
```

## API

Полный справочник: [`docs/api/index.md`](./docs/api/index.md). Проверка полноты — `pnpm api:check`: скрипт сверяет экспорты `dist/*.d.ts` с документацией и падает при расхождениях.

## Реактивность

```ts
import { batch, createEffect, createSignal } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(0);
createEffect(() => console.log(count()));
batch(() => {
  setCount(1);
  setCount(2);
});
```

`@reactive accessor user = { name: "Ann", address: { city: "Moscow" } }` создаёт отдельный сигнал на каждое вложенное свойство. Изменение `user.address.city` не перезапускает эффекты, читающие `user.name`.

## DI

```ts
import type { Store } from "./types";

export class Service {
  constructor(private readonly store: Store) {}
}
```

Сканер индекса находит `class MemoryStore implements Store`, и конструктор компилируется в фабрику с разрешением реализации. Поддерживаются `singleton`, `transient`, `scoped`, `peek`, `has`, `dispose`, `CircularDependencyError`.

## HMR

В dev-режиме компилятор внедряет `import.meta.hot.accept`. При изменении view сохраняется ViewModel и состояние сигналов. При изменении модуля ViewModel создаётся новый экземпляр с переносом значений `@reactive`-полей.

## Опции плагина

```ts
silent({
  include: /\.(ts|tsx|js|jsx)$/,
  exclude: /node_modules/,
  root: process.cwd(),
  swc: {
    jsc: { target: "es2020" },
    minify: false,
  },
  requirePreloader: false,
  hmr: true,
  index: true,
});
```

`swc` принимает опции компилятора SWC. JSX всегда компилируется рантаймом Silent Framework.

## Бенчмарки

`pnpm bench` сравнивает рантайм с SolidJS 1.9.18 в jsdom: примитивы реактивности и keyed-список (`For` против `mapArray`). Каждый замер — лучший результат из трёх прогонов tinybench (500 мс на задачу), Intel Core i5-10400, Node.js 26.

| Сценарий | silent ops/s | solid ops/s | silent/solid |
| --- | ---: | ---: | ---: |
| signal: 10k writes | 294 | 300 | 0.98x |
| signal: 10k batched writes | 3 885 | 4 179 | 0.93x |
| memo chain: 5k writes | 155 | 168 | 0.92x |
| deep reactive: 10k path writes | 120 | 87 | 1.38x |
| effect → textContent: 10k updates | 172 | 176 | 0.98x |
| keyed list: create 1000 rows | 82 | 322 | 0.25x |
| keyed list: append 100 rows | 837 | 2 171 | 0.39x |
| keyed list: reorder 1000 rows | 587 | 1 242 | 0.47x |

Примитивы работают на уровне Solid, вложенная реактивность быстрее. Разрыв в `For` — стоимость отдельного реактивного владельца и якоря на элемент; реконсиляция без изменения порядка не трогает DOM. Цифры зависят от машины — сравнивайте только свой прогон.

## Ограничения

- Синхронные компоненты без ViewModel разрешены только для прелоадеров и простых UI-листьев.
- Интерфейс в DI должен иметь ровно одну реализацию в индексе; иначе используйте явный `bind`.
- Сложные re-export и generic-типы в DI требуют ручной привязки.
- HMR рантайма самого фреймворка выполняет полную перезагрузку.

## Разработка

```bash
pnpm install
pnpm build:native
pnpm build
pnpm test
pnpm typecheck
pnpm api:check
pnpm dev
pnpm bench
pnpm test:e2e
pnpm test:ssr
pnpm install:check
```

## Релиз

Все пакеты `@ivlev-dev/silent-*` версионируются синхронно (сейчас `0.2.0`). Релиз запускается тегом:

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions `Release` соберёт нативные бинарники под Linux/Windows, прогонит тесты, проверит совпадение тега и версий, соберёт пакеты и опубликует их в npm. Для публикации нужен секрет репозитория `NPM_TOKEN`. Локальная проверка установки из tarball'ов — `pnpm install:check`.
