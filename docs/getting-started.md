# С чего начать

Silent Framework — легковесный фронтенд-фреймворк с гранулярной реактивностью, компилируемым JSX, MVVM и compile-time DI. Виртуального DOM нет: сигналы обновляют конкретные узлы, а view получает ViewModel через асинхронный DI. Этот гайд проведёт от пустой папки до работающего счётчика.

## Требования

- Node.js >= 22.
- Vite >= 8.
- TypeScript 7.
- Все пакеты `@ivlev-dev/silent-*` — ESM-only, поэтому проект должен быть ESM (`"type": "module"`).

Примеры используют `pnpm`, но подойдут npm или yarn с теми же пакетами.

## Создание проекта

```bash
mkdir silent-app
cd silent-app
pnpm init
pnpm add @ivlev-dev/silent-core
pnpm add -D @ivlev-dev/silent-vite vite@^8 typescript@^7
```

`@ivlev-dev/silent-core` ставится в `dependencies`: это рантайм. `@ivlev-dev/silent-vite`, `vite` и `typescript` — в `devDependencies`.

**Одного `@ivlev-dev/silent-vite` недостаточно.** Плагин не содержит рантайма: без `@ivlev-dev/silent-core` приложение не соберётся и не запустится. `silent-core` уже тянет `@ivlev-dev/silent-di` и `@ivlev-dev/silent-reactivity`, а `silent-vite` — `@ivlev-dev/silent-swc`; отдельно их устанавливать не нужно.

Фрагмент `package.json` — добавьте ESM и скрипты, не удаляя поля зависимостей:

```json
{
  "name": "silent-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  }
}
```

Поля `dependencies` и `devDependencies` уже добавлены командами `pnpm add`.

Версии всех `@ivlev-dev/silent-*` синхронизированы: актуальная — 0.3.0.

## Настройка

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
});
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "strict": true,
    "useDefineForClassFields": true,
    "experimentalDecorators": false,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "jsxImportSource": "@ivlev-dev/silent-core",
    "types": ["vite/client"],
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "vite.config.ts"]
}
```

`jsx` и `jsxImportSource` обязательны: JSX компилируется рантаймом Silent Framework, а не React. `experimentalDecorators` должен оставаться выключенным — используются Stage-3 декораторы.

`index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Silent Framework</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx
import { mount } from "@ivlev-dev/silent-core";
import { Counter } from "./counter";

void mount("#app", Counter, { props: { step: 1 } });
```

`mount` принимает селектор или `Element`, очищает контейнер (если не передать `clear: false`) и возвращает `Promise<MountHandle>` с `ready` и `dispose()`. Файлы `counter.vm.ts`, `counter.tsx` и `preloader.tsx` появятся ниже.

## Первый ViewModel

`src/counter.vm.ts`:

```ts
import { computed, reactive, ViewModel } from "@ivlev-dev/silent-core";

export interface CounterProps {
  step: number;
}

export class CounterVM extends ViewModel<CounterProps> {
  @reactive accessor count = 0;

  @computed get double(): number {
    return this.count * 2;
  }

  increment(): void {
    this.count += this.props.step;
  }
}
```

- `ViewModel<CounterProps>` типизирует `this.props`, даёт `this.view`, хуки жизненного цикла и `dispose()`.
- `@reactive accessor` создаёт глубокий реактивный прокси: отдельный сигнал получает каждое вложенное свойство и индекс массива. Декоратор работает только с `accessor`-полями.
- `@computed` вычисляет значение лениво и мемоизирует его на экземпляр.
- `increment()` меняет сигнал; обновится только тот DOM-узел, который читает `count`.

`props` назначает рантайм перед вызовом `created`; конструктор для этого не нужен.

## Первый view

`src/counter.tsx`:

```tsx
import type { CounterVM } from "./counter.vm";
import { CounterPreloader } from "./preloader";

export function Counter(
  this: { vm: CounterVM; preloader: typeof CounterPreloader },
  props: { step: number },
) {
  return (
    <div>
      <button onClick={() => this.vm.increment()}>+</button>
      <strong>{this.vm.count}</strong>
      <span> × 2 = {this.vm.double}</span>
      <span>шаг: {props.step}</span>
    </div>
  );
}
```

`this`-параметр — это контракт для компилятора, а не аргумент вызова:

- TypeScript и JSX видят у `Counter` только параметр `props`, поэтому `vm` в вызов не передаётся: `<Counter step={1} />`. Попытка написать `<Counter vm={...} step={1} />` — ошибка типа.
- Из `this`-типа компилятор извлекает токены `CounterVM` и `CounterPreloader` и добавляет к функции метаданные `Symbol.for("silent.view")`.
- При рендере рантайм создаёт дочерний DI-scope, асинхронно резолвит `CounterVM`, назначает `vm.props`, вызывает view с `this = { vm, preloader }` и только потом вставляет узлы в DOM.
- VM импортируется через `import type` — это обязательное условие примера: компилятор получает токен типа и сам добавляет нужный value-import в метаданные. Прелоадер импортируется обычным импортом, потому что используется в `typeof` и должен быть доступен как значение.

Если у компонента нет `this.vm`, он считается синхронным: DI-scope не создаётся, VM не резолвится. Так работают прелоадеры и простые UI-листья.

## Прелоадер

`src/preloader.tsx`:

```tsx
export function CounterPreloader() {
  return <span>Загрузка…</span>;
}
```

Пока `CounterVM` резолвится, рантайм показывает этот компонент между маркерами view. В готовом view тот же компонент доступен как `this.preloader`.

Порядок выбора прелоадера:

1. `preloader` из `this`-типа (метаданные view).
2. Прелоадер, прикреплённый через `setPreloader` или `setFallback`.
3. Свойство `preloader` (алиас `fallback`) у токена VM, например статическое поле класса.
4. Глобальный `defaultPreloader` из `setDefaultPreloader` или `mount({ preloader })`.
5. Пустой якорь, если прелоадера нет.

Прелоадер обязан быть синхронным компонентом без ViewModel: VM в него не передаётся. Внутри `Suspense` прелоадеры вложенных view не рендерятся — граница показывает свой `fallback`. Опция плагина `silent({ requirePreloader: true })` делает прелоадер обязательным для view.

Теперь можно запустить dev-сервер:

```bash
pnpm dev
```

Откройте `http://localhost:5173` — счётчик работает. Правки view применяются через HMR с сохранением ViewModel и состояния сигналов; при изменении модуля VM создаётся новый экземпляр с переносом `@reactive`-полей. Проверка типов — `pnpm typecheck`.

## Жизненный цикл

Хуки ViewModel вызываются в таком порядке:

- `created` — после назначения `props`, до рендера.
- `beforeMount` — перед вставкой view в DOM.
- `mounted` — после вставки корневого узла; `this.view` уже доступен.
- `updated` — при повторном рендере после HMR; заменяет пару `created`/`beforeMount`/`mounted`.
- `beforeUnmount` — перед удалением view.
- `unmounted` — после удаления view.
- `dispose()` — после `unmounted`; останавливает эффекты, `@watch` и `@computed`. Повторный вызов безопасен.

```ts
export class CounterVM extends ViewModel<CounterProps> {
  created(): void {}
  beforeMount(): void {}
  mounted(): void {}
  updated(): void {}
  beforeUnmount(): void {}
  unmounted(): void {}
}
```

Хуки опциональны и распознаются по имени на объекте VM: наследовать `ViewModel` не обязательно.

## Списки и условия

Пример отдельного view. VM лежит в `src/demo.vm.ts`:

```ts
import { reactive, ViewModel } from "@ivlev-dev/silent-core";

export type DemoStatus = "idle" | "ok" | "error";

export class DemoVM extends ViewModel {
  @reactive accessor items: { id: number; name: string }[] = [
    { id: 1, name: "Первый" },
    { id: 2, name: "Второй" },
  ];

  @reactive accessor numbers: number[] = [10, 20, 30];
  @reactive accessor ready = true;
  @reactive accessor status: DemoStatus = "ok";
}
```

`src/demo.tsx`:

```tsx
import type { DemoVM } from "./demo.vm";
import { ErrorBoundary, For, Index, Match, Show, Switch } from "@ivlev-dev/silent-core";

function ErrorView() {
  return <span>Ошибка</span>;
}

function ContentView() {
  return <span>Контент</span>;
}

export function Demo(this: { vm: DemoVM }) {
  return (
    <section>
      <For each={this.vm.items} fallback={<p>Пусто</p>}>
        {(item: { id: number; name: string }) => <p>{item.name}</p>}
      </For>

      <Index each={this.vm.numbers}>
        {(value) => <span>{value()} </span>}
      </Index>

      <Show when={this.vm.ready} fallback={<b>Не готово</b>}>
        <span>Готово</span>
      </Show>

      <Switch fallback={<span>Неизвестно</span>}>
        <Match when={this.vm.status === "error"}>
          <ErrorView />
        </Match>
        <Match when={this.vm.status === "ok"}>
          <ContentView />
        </Match>
      </Switch>

      <ErrorBoundary
        fallback={(error, reset) => (
          <button onClick={reset}>{String(error)}</button>
        )}
      >
        <ContentView />
      </ErrorBoundary>
    </section>
  );
}
```

- `For` — keyed-список: узлы привязаны к значениям, при перестановке DOM не пересоздаётся. `fallback` показывается для пустого массива.
- `Index` — неключевой список: узлы закреплены за позициями, а `value()` — accessor текущего значения. Меняется содержимое, а не сами узлы.
- `Show` — условный рендер. Правда — всё, кроме `null`, `undefined`, `false`, `0` и `""`; иначе показывается `fallback`.
- `Switch`/`Match` — выбирается первый правдивый `Match`, иначе `fallback`. `Match` нельзя использовать вне `Switch`.
- `ErrorBoundary` ловит синхронные ошибки рендера детей и асинхронные ошибки дочерних view. `fallback(error, reset)` получает ошибку и функцию `reset()`, которая повторяет рендер. Ошибки в обработчиках событий и в эффектах, созданных вне границы, не перехватываются.

Файлы `demo.vm.ts` и `demo.tsx` — отдельный пример; в минимальный проект их можно не добавлять. Если включён `requirePreloader: true`, добавьте прелоадер и в `Demo`.

## SSR

Для серверного рендера установите `@ivlev-dev/silent-server`:

```bash
pnpm add @ivlev-dev/silent-server
```

Пакет не тянет jsdom или linkedom: внутри собственный мини-DOM. На сервере используйте `renderToString` (или `renderToStream`), на клиенте — `hydrate` вместо `mount`; гидрация забирает серверные узлы и не показывает прелоадеры во время асинхронного резолва VM. В SSR-сборке Vite держите рантайм внешним через `ssr.external`, иначе приложение получит вторую копию рантайма. Подробнее: [`docs/guides/ssr.md`](./guides/ssr.md).

## Структура проекта

```
silent-app/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── counter.tsx
    ├── counter.vm.ts
    ├── main.tsx
    └── preloader.tsx
```

## Дальше

- Гайды: [`docs/guides/ssr.md`](./guides/ssr.md), [`docs/guides/hydration.md`](./guides/hydration.md), [`docs/guides/di.md`](./guides/di.md), [`docs/guides/migration-from-solid.md`](./guides/migration-from-solid.md); каталог — [`docs/guides/`](./guides/).
- Справочник API: [`docs/api/core.md`](./api/core.md), [`docs/api/vite.md`](./api/vite.md), [`docs/api/di.md`](./api/di.md), [`docs/api/reactivity.md`](./api/reactivity.md), [`docs/api/swc.md`](./api/swc.md), [`docs/api/index.md`](./api/index.md).
- Полный пример: [`examples/counter`](../examples/counter).
- SSR с реальным HTTP-сервером: [`examples/ssr-counter`](../examples/ssr-counter).
- Архитектура рантайма: [`docs/architecture.md`](./architecture.md).
