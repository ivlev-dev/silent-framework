# @ivlev-dev/silent-core

Рантайм Silent Framework: MVVM, Stage-3 декораторы реактивности, JSX-рантайм, управляющие конструкции, прелоадеры и гидрация без виртуального DOM.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-core)](https://www.npmjs.com/package/@ivlev-dev/silent-core) [![license](https://img.shields.io/npm/l/@ivlev-dev/silent-core)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE) [![node](https://img.shields.io/node/v/@ivlev-dev/silent-core)](https://www.npmjs.com/package/@ivlev-dev/silent-core)

## Возможности

- Сигналы, мемо и эффекты с батчингом; обновляется только затронутый DOM-узел.
- Глубокая реактивность объектов и массивов: отдельный сигнал на каждое вложенное свойство и индекс.
- MVVM: view получает ViewModel через асинхронный DI, DI-скоуп наследуется вложенными компонентами.
- Stage-3 декораторы `@reactive`, `@computed` и `@watch` для полей, геттеров и методов.
- Прелоадеры на уровне view: из метаданных, через `setPreloader`, из VM или глобальные.
- `For`, `Show`, `Suspense` и `lazy`: keyed-реконсиляция, условный рендер и асинхронные границы.
- Гидрация с адоптацией серверных узлов и вынос `<title>` в `<head>`.
- HMR с сохранением ViewModel и состояния сигналов.

## Установка

```bash
pnpm add @ivlev-dev/silent-core
```

```bash
npm install @ivlev-dev/silent-core
```

```bash
yarn add @ivlev-dev/silent-core
```

`@ivlev-dev/silent-di` и `@ivlev-dev/silent-reactivity` устанавливаются как зависимости пакета. Для компиляции TSX нужен плагин Vite:

```bash
pnpm add -D @ivlev-dev/silent-vite
```

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
});
```

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@ivlev-dev/silent-core"
  }
}
```

Пакет поставляется только как ESM. Требуется Node.js 22 или новее.

## Быстрый старт

ViewModel с реактивным полем и вычисляемым значением:

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

View-компонент получает VM через `this`, а props — обычным параметром:

```tsx
import type { CounterVM } from "./counter.vm";

export function CounterPreloader() {
  return <span>Загрузка…</span>;
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
      <span>шаг: {props.step}</span>
    </div>
  );
}
```

VM импортируется через `import type`: компилятор извлекает токен `CounterVM` и `CounterPreloader` из `this`-типа и добавляет метаданные `silent.view`. В месте использования параметр `vm` не передаётся:

```tsx
import { mount } from "@ivlev-dev/silent-core";
import { Counter } from "./counter";

const handle = await mount("#app", Counter, { props: { step: 2 } });

// handle.ready — промис готовности, handle.dispose() — демонтаж
```

`mount` принимает селектор или `Element`, очищает контейнер (если не задано `clear: false`) и ждёт разрешения ViewModel.

## Жизненный цикл и прелоадеры

Порядок хуков: `created` → `beforeMount` → рендер → `mounted`. При HMR-обновлении вызывается `updated`; при демонтаже — `beforeUnmount` → `unmounted` → `dispose()`.

```tsx
import { reactive, ViewModel } from "@ivlev-dev/silent-core";

export class ProfileVM extends ViewModel<{ id: number }> {
  @reactive accessor name = "";

  created(): void {
    this.name = "Профиль";
  }

  mounted(): void {
    console.log("view вставлен в DOM", this.props.id);
  }

  unmounted(): void {
    console.log("view снят");
  }
}

export function ProfilePreloader() {
  return <span>Загрузка профиля…</span>;
}

export function Profile(
  this: { vm: ProfileVM; preloader: typeof ProfilePreloader },
) {
  return <h1>{this.vm.name}</h1>;
}
```

Пока ViewModel резолвится, рантайм между маркерами view показывает `ProfilePreloader`; тот же компонент доступен внутри view как `this.preloader`. Приоритет выбора: прелоадер из метаданных → `setPreloader`/`setFallback` → свойство `preloader` у VM → `setDefaultPreloader`/`mount({ preloader })` → пустой якорь. Прелоадер обязан быть синхронным компонентом без ViewModel.

## Control flow

### `For`

```tsx
import { For } from "@ivlev-dev/silent-core";

<ul>
  <For each={this.vm.items} fallback={<li>Пусто</li>}>
    {(item: { name: string }) => <li>{item.name}</li>}
  </For>
</ul>
```

`each` принимает массив или функцию-толкатель. Ключом служит сам элемент, поэтому подходят примитивы и стабильные ссылки; при неизменном порядке DOM не трогается.

### `Show`

```tsx
import { Show } from "@ivlev-dev/silent-core";

<Show when={this.vm.count > 0} fallback={<span>Нет данных</span>}>
  <span>{this.vm.count}</span>
</Show>
```

«Правда» — всё, кроме `null`, `undefined`, `false`, `0` и `""`.

### `Suspense`

```tsx
import { Suspense } from "@ivlev-dev/silent-core";

<Suspense fallback={<span>Загрузка…</span>}>
  <Profile id={1} />
</Suspense>
```

Граница ждёт `ready` всех вложенных view и переключается на содержимое после их готовности. Прелоадеры вложенных view внутри `Suspense` не рендерятся.

### `lazy`

```tsx
import { lazy, Suspense } from "@ivlev-dev/silent-core";

const Profile = lazy<{ id: number }>(() => import("./profile"));

<Suspense fallback={<span>Загрузка…</span>}>
  <Profile id={1} />
</Suspense>
```

Модуль загружается один раз на обёртку; принимаются и компонент, и `{ default }`-экспорт. Опции `preloader` и `onError` задаются вторым аргументом.

## Гидрация

Серверный рендер выполняет `renderToString` из `@ivlev-dev/silent-server` и возвращает `html` и `head`. `<title>`, отрендеренный внутри view, в `html` не попадает — он выносится в `head`:

```tsx
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";

const { html, head } = await renderToString(App, { props: { title: "Привет" } });

const page = `<!doctype html><html><head>${head}</head><body><div id="app">${html}</div></body></html>`;
```

```tsx
import { ViewModel } from "@ivlev-dev/silent-core";

export class PageVM extends ViewModel<{ name: string }> {}

export function Page(this: { vm: PageVM }, props: { name: string }) {
  return (
    <div>
      <title>{`Профиль ${props.name}`}</title>
      <h1>{props.name}</h1>
    </div>
  );
}
```

На клиенте вместо `mount` используется `hydrate`: он забирает существующие серверные узлы и привязывает к ним эффекты, не показывая прелоадеры во время асинхронного резолва VM. Заголовок создаётся заново и занимает `document.head`.

```ts
import { hydrate } from "@ivlev-dev/silent-core";
import { App } from "./app";

const handle = await hydrate("#app", App, {
  props: { title: "Привет" },
  onMismatch: (error) => console.warn(error.message),
});
```

При несовпадении формы узла бросается `HydrationMismatchError`; ближайший view отказывается от адоптации и рендерится клиентски, ошибка передаётся в `onMismatch`. Для SSR-сборки Vite держите рантайм внешним (`ssr.external`), иначе приложение получит вторую копию рантайма.

## API

| Символ | Назначение |
| --- | --- |
| `reactive` | Stage-3 декоратор `accessor`-поля: глубокий реактивный прокси, отдельный сигнал на каждое вложенное свойство. |
| `computed` | Stage-3 декоратор геттера: ленивое мемоизированное значение на экземпляр. |
| `watch` | Декоратор метода: следит за селектором и вызывает `(next, prev)`. |
| `ViewModel` | Базовый класс VM: `props`, `view`, хуки жизненного цикла и `dispose()`. |
| `ComponentContext` | DI-токен view: `props`, `container`, `signal`, `view`. |
| `createComponent` | Создаёт компонент и возвращает `{ node, ready, dispose }`. |
| `component` | Создаёт компонент с текущими runtime-опциями и возвращает только `Node`. |
| `mount` | Монтирует корневой компонент в `Element` или селектор; возвращает `Promise<MountHandle>`. |
| `hydrate` | Гидрация серверной разметки с адоптацией узлов; возвращает `Promise<MountHandle>`. |
| `For` | Keyed-список с реконсиляцией и `fallback`. |
| `Show` | Условный рендер с `fallback`. |
| `Suspense` | Асинхронная граница: `fallback`, пока не готовы вложенные view. |
| `lazy` | Отложенная загрузка модуля компонента с `preloader` и `onError`. |
| `setDefaultPreloader` | Глобальный прелоадер; `null` сбрасывает на пустой якорь. |
| `setPreloader`, `setFallback` | Прикрепляет прелоадер к функции компонента (`setFallback` — алиас). |
| `setErrorHandler` | Глобальный обработчик ошибок; `null` возвращает `console.error`. |
| `getReady` | Промис готовности узла, в том числе для вручную вставленных компонентов. |
| `whenIdle` | Ждёт завершения всех отслеживаемых рантаймом промисов. |
| `HydrationMismatchError` | Ошибка несовпадения серверной и клиентской разметки. |
| `createSignal`, `createMemo`, `createEffect`, `batch`, `untrack`, `onCleanup`, `createRoot` | Примитивы реактивности, реэкспорт из `@ivlev-dev/silent-reactivity`. |
| `deepReactive`, `isReactive`, `unwrap` | Работа с глубокими реактивными прокси. |
| `Container`, `container`, `createToken`, `DI_CREATE`, `CircularDependencyError` | DI, реэкспорт из `@ivlev-dev/silent-di`. |
| `ViewContext`, `ViewComponent`, `SyncComponent`, `AnyComponent`, `Preloader` | Типы для `this`-контекста, view- и синхронных компонентов. |
| `MountOptions`, `MountHandle`, `ComponentResult`, `WatchOptions`, `SuspenseProps`, `LazyOptions` | Типы опций и результатов. |
| `template`, `templateHoles`, `insert`, `text`, `attr`, `prop`, `style`, `spread`, `on`, `ref`, `effect`, `fragment`, `dynamic`, `createElement` | DOM-примитивы JSX-рантайма для скомпилированного кода. |
| `getViewMeta`, `getComponentName`, `isViewComponent`, `setReady` | Работа с метаданными и готовностью компонентов. |
| `VIEW_META`, `PRELOADER`, `COMPONENT_READY`, `COMPONENT_DISPOSE` | Символы метаданных. |
| `setMetadataCollector` | Внутренний хук SSR для сбора `<title>`; прикладным кодом не используется. |

## Ограничения и совместимость

- Пакет ESM-only (`"type": "module"`, экспорт только через `import`), требуется Node.js 22+.
- Метаданные `silent.view` формирует компилятор (`@ivlev-dev/silent-vite`). «Голый» JSX-рантайм не отрендерит view-компонент с асинхронным резолвом VM.
- VM и прелоадер должны быть связаны с компонентом через `import type` или value-import в `this`-типе, иначе токены не разрешатся.
- Компонент без метаданных с `vm` считается синхронным: у него нет `this.vm`, scope не создаётся, готовность не ожидается. Синхронными остаются прелоадеры и простые UI-листья.
- Прелоадер не может быть view-компонентом: VM в него не передаётся.
- В DI интерфейс должен иметь ровно одну реализацию в индексе, иначе нужен явный `bind`.
- Гидрация адоптирует только разметку, созданную через `template()`/`templateHoles()`; `<title>` должен быть прямым потомком корневого элемента шаблона view.
- `renderToString` не поддерживает стриминг; серверный мини-DOM не реализует события.
- Версия 0.1.x: публичный API может меняться до 1.0.

## Ссылки

- Репозиторий: https://github.com/ivlev-dev/silent-framework
- Документация: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/core.md
- CHANGELOG: https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md
- Issues: https://github.com/ivlev-dev/silent-framework/issues

---

MIT © ivlev-dev
