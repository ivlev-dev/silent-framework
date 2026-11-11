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

Одной командой — метапакет с рантаймом и плагином:

```bash
pnpm add @ivlev-dev/silent
pnpm add -D vite typescript
# для SSR:
pnpm add @ivlev-dev/silent-server
```

Точечная установка:

```bash
pnpm add @ivlev-dev/silent-core
pnpm add -D @ivlev-dev/silent-vite vite typescript
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

При установке метапакета плагин доступен и оттуда: `import { silent } from "@ivlev-dev/silent"`.

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
  view: true,
});
```

`swc` принимает опции компилятора SWC. JSX всегда компилируется рантаймом Silent Framework.

`view: false` отключает view/VM-рантайм и его lazy-чанк. Используй это только если в приложении нет компонентов с ViewModel: стартовый бандл уменьшается примерно на 3 KB min, но `mount`/`hydrate` с VM-компонентом бросят ошибку.

## Версионирование

Проект в стадии `0.x`: ломающее изменение публичного API или новая функциональность → вторая цифра, исправления/производительность/рефакторинг → третья (`0.6.0` → `0.6.1`). Все пакеты и `Cargo.toml` версионируются синхронно. Подробности и шаги релиза — [docs/releasing.md](./docs/releasing.md).

## Бенчмарки

`pnpm bench` сравнивает рантайм с SolidJS 1.9.18 в jsdom: примитивы реактивности и keyed-список (`For` против `mapArray`). Каждый замер — лучший результат из трёх прогонов tinybench (500 мс на задачу), Intel Core i5-10400, Node.js 26.

| Сценарий | silent ops/s | solid ops/s | silent/solid |
| --- | ---: | ---: | ---: |
| signal: 10k writes | 359 | 298 | 1.20x |
| signal: 10k batched writes | 7 622 | 4 220 | 1.81x |
| memo chain: 5k writes | 200 | 162 | 1.23x |
| deep reactive: 10k path writes | 119 | 85 | 1.40x |
| effect → textContent: 10k updates | 193 | 175 | 1.10x |
| keyed list: create 1000 rows | 73 | 290 | 0.25x |
| keyed list: append 100 rows | 989 | 2 013 | 0.49x |
| keyed list: reorder 1000 rows | 1 396 | 1 170 | 1.19x |

Примитивы быстрее Solid на 10–40%, batched writes — в 1.8 раза быстрее. Разрыв в `For` остаётся на создании и добавлении — стоимость отдельного реактивного владельца и якоря на элемент; перестановки уже быстрее Solid. Цифры зависят от машины — сравнивайте только свой прогон.

`pnpm bench:ssr` измеряет SSR и гидрацию:

- SSR: `renderToString` Silent против Solid (`ssr`-теги из `solid-js/web`), 20 элементов.
- Гидрация: `hydrate` Silent — регрессионный ориентир. Solid `hydrate` требует разметку с `data-hk` от JSX-компилятора, которого в наборе нет, поэтому сравнение не приводится.

| Сценарий | ops/s |
| --- | ---: |
| SSR: silent renderToString | 99 900 |
| SSR: solid renderToString | 206 300 |
| Гидрация: silent hydrate (20 шаблонов) | 1 368 |

`pnpm bench:hydrate` сравнивает гидрацию Silent и Solid в одном jsdom (20 строк, SSR-разметка Solid скомпилирована с `data-hk`):

| Сценарий | ops/s | к Solid |
| --- | ---: | ---: |
| Silent hydrate | 1 368 | 0.61x |
| Solid hydrate | 2 249 | 1.00x |

`pnpm bench:browser` повторяет сравнение в реальном Chromium (20 строк, 300 замеров по 20 гидраций). Из замера исключена подготовка контейнера (`innerHTML`), её стоимость показана отдельно в столбце «разбор»:

| Сценарий | ops/s | к Solid |
| --- | ---: | ---: |
| Silent hydrate | 8 746 | 0.32x |
| Solid hydrate | 27 372 | 1.00x |

Гидрация Silent требует материализации клиентского дерева и только потом переиспользует серверные узлы; Solid привязывается к готовым узлам по `data-hk`. Разбор SSR-разметки у Silent дороже (больше маркеров) и в ops/s не входит.

`pnpm bench:build` собирает одинаковые Vite-приложения на Silent и Solid (3 cold + 3 warm прогона):

| Приложение | cold, ms | warm, ms | start JS, KB | start gzip, KB | all JS, KB | CSS, KB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Silent (`view: false`) | 56 | 27 | 23.2 | 8.3 | 23.2 | 0.2 |
| Silent (default, VM) | 32 | 26 | 26.4 | 9.5 | 38.8 | 0.2 |
| Solid | 147 | 40 | 12.6 | 5.1 | 12.6 | 0.2 |

У Silent с VM `all JS` включает lazy-чанк `component-view` (8.98 KB / 3.66 KB gzip), который загружается только при наличии ViewModel. При `view: false` lazy-чанк и `vite/preload-helper` не генерируются.

SSR Silent медленнее: собственный мини-DOM разбирает шаблон и сериализует дерево, тогда как Solid собирает строку из `ssr`-тегов. Это цена SSR без jsdom/linkedom. Пересоздание DOM-глобалов на каждый рендер убрано, и разрыв сократился примерно с 5× до 2×; для паритета нужен строковый SSR-режим компилятора. Сборка Silent быстрее, но бандл больше из-за рантайма reactivity/DI/core.

## Ограничения

- Синхронные компоненты без ViewModel разрешены только для прелоадеров и простых UI-листьев.
- Интерфейс в DI должен иметь ровно одну реализацию в индексе; иначе используйте явный `bind`.
- Сложные re-export и generic-типы в DI требуют ручной привязки.
- HMR рантайма самого фреймворка выполняет полную перезагрузку.

## Документация

- [С чего начать](./docs/getting-started.md)
- [SSR и деплой](./docs/guides/ssr.md)
- [Гидрация](./docs/guides/hydration.md)
- [Dependency Injection](./docs/guides/di.md)
- [Миграция с SolidJS](./docs/guides/migration-from-solid.md)
- [Справочник API](./docs/api/index.md)
- Примеры: [`examples/counter`](./examples/counter), [`examples/ssr-counter`](./examples/ssr-counter)

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
pnpm bench:ssr
pnpm test:e2e
pnpm test:ssr
pnpm install:check
pnpm deprecate:legacy --dry-run
```

## Релиз

Все пакеты `@ivlev-dev/silent-*` версионируются синхронно (сейчас `0.6.2`). Правила и пошаговый процесс — [docs/releasing.md](./docs/releasing.md). Релиз запускается тегом:

```bash
git tag v0.6.2
git push origin v0.6.2
```

GitHub Actions `Release` соберёт нативные бинарники под Linux/Windows, прогонит тесты, проверит совпадение тега и версий, соберёт пакеты и опубликует их в npm. Для публикации нужен секрет репозитория `NPM_TOKEN`. Локальная проверка установки из tarball'ов — `pnpm install:check`.
