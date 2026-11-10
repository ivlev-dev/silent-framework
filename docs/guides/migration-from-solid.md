# Миграция с SolidJS

Silent Framework и SolidJS разделяют одну идею: гранулярная реактивность и отсутствие виртуального DOM. Сигналы, мемо и эффекты обновляют только затронутые узлы. Главное отличие Silent — жёсткая модель MVVM с асинхронным DI и собственный компилятор: view-компонент не содержит логики состояния, а ViewModel получается через автопоиск реализаций интерфейсов.

Ниже — соответствие API, пример миграции компонента, реактивность в классах, DI и сборка.

## Таблица соответствий

| Solid | Silent | Примечание |
| --- | --- | --- |
| `createSignal` | `createSignal` (из `@ivlev-dev/silent-reactivity` или `@ivlev-dev/silent-core`) | Та же пара `[read, set]`; `Setter` принимает значение или апдейтер. Опция `equals`. |
| `createEffect` | `createEffect` | Обновления планируются в микротаске. Для синхронного старта есть `createRenderEffect`. |
| `createMemo` | `createMemo` | Ленивое вычисление; уведомление только при реальном изменении (с учётом `equals`). |
| `For` | `For` | Keyed-список, ключ — сам элемент; при неизменном порядке DOM не трогается. |
| `Index` | `Index` | Неключевой список: узлы закреплены за позициями, обновляется содержимое. |
| `Show` | `Show` | «Правда» — всё, кроме `null`, `undefined`, `false`, `0` и `""`; есть `fallback`. |
| `Switch` / `Match` | `Switch` / `Match` | Выбирается первая правдивая ветка; есть `fallback`. |
| `createRoot` | `createRoot` | Создаёт корневой `Owner`; `dispose()` уничтожает эффекты поддерева. |
| `onCleanup` | `onCleanup` | Регистрирует очистку в текущем `Owner`. |
| `batch` | `batch` | Откладывает flush до выхода из самого внешнего `batch`. |
| `untrack` | `untrack` | Чтения внутри не регистрируют зависимости. |
| `Suspense` | `Suspense` | Ждёт готовности вложенных view; прелоадеры внутри не рендерятся. |
| `lazy` | `lazy` | Кеширует загрузку модуля; принимает компонент или `{ default }`; опции `preloader`, `onError`. |
| `createComputed` (Solid) | `@computed` / `createMemo` | `@computed` привязан к экземпляру ViewModel и лениво мемоизируется. |
| `on` (Solid) | `on` | Запускает функцию на изменение конкретных зависимостей; есть опция `defer`. |
| `createStore` (solid-js/store) | `deepReactive` / `@reactive accessor` | Глубокий прокси с сигналом на каждое свойство; мутирующие методы массивов (`push`, `splice` и др.) уведомляют только затронутые индексы. |
| Solid Router / solid-start | Нет прямого аналога | Маршрутизация и SSR-фреймворк не входят в ядро; используются `mount`/`hydrate` и `@ivlev-dev/silent-server`. |

## Компоненты

В Solid компонент — обычная функция, состояние хранится в замыканиях. В Silent компонент получает `ViewModel` через `this`, а состояние живёт в классе.

**Solid (до):**

```tsx
import { createSignal, For } from "solid-js";

interface Item {
  name: string;
}

export function Counter(props: { step: number }) {
  const [count, setCount] = createSignal(0);
  const [items, setItems] = createSignal<Item[]>([]);

  const double = () => count() * 2;

  const increment = () => setCount((c) => c + props.step);
  const addItem = () => setItems((prev) => [...prev, { name: `item-${prev.length + 1}` }]);

  return (
    <section>
      <button onClick={increment}>+</button>
      <strong>{count()}</strong>
      <span>{double()}</span>
      <ul>
        <For each={items()}>{(item) => <li>{item.name}</li>}</For>
      </ul>
      <button onClick={addItem}>Добавить</button>
    </section>
  );
}
```

**Silent (после)** — `counter.vm.ts`:

```ts
import { computed, reactive, ViewModel } from "@ivlev-dev/silent-core";

export class Item {
  @reactive accessor name: string;

  constructor(name: string) {
    this.name = name;
  }
}

export interface CounterProps {
  step: number;
}

export class CounterVM extends ViewModel<CounterProps> {
  @reactive accessor count = 0;
  @reactive accessor items: Item[] = [];

  @computed get double(): number {
    return this.count * 2;
  }

  increment(): void {
    this.count += this.props.step;
  }

  addItem(): void {
    this.items.push(new Item(`item-${this.items.length + 1}`));
  }
}
```

**Silent (после)** — `counter.tsx`:

```tsx
import type { CounterVM } from "./counter.vm";
import { For } from "@ivlev-dev/silent-core";

export function Counter(
  this: { vm: CounterVM },
  props: { step: number },
) {
  return (
    <section>
      <button onClick={() => this.vm.increment()}>+</button>
      <strong>{this.vm.count}</strong>
      <span>{this.vm.double}</span>
      <ul>
        <For each={this.vm.items}>
          {(item: Item) => <li>{item.name}</li>}
        </For>
      </ul>
      <button onClick={() => this.vm.addItem()}>Добавить</button>
    </section>
  );
}
```

`VM` импортируется через `import type`: компилятор извлекает токен из `this`-типа и добавляет метаданные `silent.view`. В месте вызова параметр `vm` не передаётся: `<Counter step={2} />`.

## Реактивность в классах

Вместо сигналов в замыканиях Silent предлагает декораторы Stage 3, привязанные к экземпляру:

```ts
import { computed, reactive, ViewModel, watch } from "@ivlev-dev/silent-core";

export class ProfileVM extends ViewModel<{ id: number }> {
  @reactive accessor name = "";
  @reactive accessor address = { city: "Moscow" };

  @computed get title(): string {
    return `${this.name} — ${this.address.city}`;
  }

  @watch((vm: ProfileVM) => vm.name, { immediate: true })
  onName(next: string, prev: string | undefined): void {
    console.log(prev, next);
  }
}
```

- `@reactive accessor` — создаёт отдельный сигнал на каждое вложенное свойство (глубоко). Изменение `address.city` не перезапускает эффекты, читающие `name`.
- `@computed` — ленивый мемо-геттер на экземпляр.
- `@watch` — метод-наблюдатель: принимает селектор и опции (`immediate`, `defer`), вызывается с `(next, prev)`.

Для вне-классовых сценариев доступны примитивы `createSignal`, `createMemo`, `createEffect`, `deepReactive` из `@ivlev-dev/silent-reactivity`.

## DI

ViewModel может объявить зависимость от интерфейса через конструктор, импортировав тип:

```ts
import type { Logger } from "./logger";
import { ViewModel } from "@ivlev-dev/silent-core";

export interface CounterProps {
  step: number;
}

export class CounterVM extends ViewModel<CounterProps> {
  constructor(private readonly logger: Logger) {
    super();
  }

  log(message: string): void {
    this.logger.log(message);
  }
}
```

Реализация:

```ts
export class ConsoleLogger implements Logger {
  log(message: string): void {
    console.log(message);
  }
}
```

Компилятор `@ivlev-dev/silent-vite` сканирует проект и строит индекс интерфейсов. Если у интерфейса ровно одна реализация, она подставляется автоматически. При нескольких реализациях или сложных re-export/generic используйте явный `bind`. Поддерживаются скоупы `singleton`, `transient`, `scoped`, а также `peek`, `has`, `dispose`, `CircularDependencyError`.

## Сборка

Замените `vite-plugin-solid` на `@ivlev-dev/silent-vite` и укажите `jsxImportSource`:

```bash
pnpm remove vite-plugin-solid
pnpm add -D @ivlev-dev/silent-vite
```

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
    "jsx": "react-jsx",
    "jsxImportSource": "@ivlev-dev/silent-core"
  }
}
```

Плагин работает с `enforce: "pre"` и компилирует TS/TSX через нативный addon. Параметры (`include`, `exclude`, `root`, `swc`, `requirePreloader`, `hmr`, `index`) — см. `docs/api/vite.md`.

## Чего нет

Честный список ограничений и отличий на 0.2.x, чтобы при миграции не ожидать лишнего:

- Нет `createStore` из `solid-js/store` с обновлениями по путям. Ближайшие инструменты — `deepReactive` и `@reactive accessor` с глубокими прокси и мутирующими методами массивов.
- Нет аналога solid-start: файловой маршрутизации, server functions, actions/resources и SSR-фреймворка. Серверный рендер — `renderToString`/`renderToStream` из `@ivlev-dev/silent-server`, клиент — `hydrate`.
- Нет примитива ресурса (`createResource`), связанного с `Suspense`: `Suspense` в Silent ждёт готовности вложенных view и их ViewModel, а не произвольных промисов. Асинхронность решается через ViewModel и `lazy`.
- Строгая модель компонентов: view-компоненты обязаны получать `ViewModel` через `this` и компилируются с метаданными `silent.view`; произвольные функциональные компоненты допустимы только как синхронные прелоадеры/простые UI-листья.
- `renderToString` не стримит: для чанков используйте `renderToStream`. Мини-DOM сервера не реализует события.
- Ключевые списки (`For`) заметно медленнее Solid в бенчмарках из-за отдельного реактивного владельца и якоря на элемент.
- HMR самих view сохраняет состояние; изменения сигнатур, затрагивающих VM, приводят к полной перезагрузке модуля. HMR рантайма фреймворка — полная перезагрузка.
- DI требует ровно одной реализации интерфейса в индексе, иначе нужен явный `bind`; сложные re-export и generic в DI могут потребовать ручной привязки.
- Публичный API до 1.0 может меняться (0.2.x → 0.3.0).
- ESM-only, требуется Node.js 22+; TSX не работает без компилятора `@ivlev-dev/silent-vite`.

## Чек-лист миграции

1. Установить `@ivlev-dev/silent-core`, `@ivlev-dev/silent-di`, `@ivlev-dev/silent-reactivity`, dev-зависимость `@ivlev-dev/silent-vite`; удалить `solid-js` и `vite-plugin-solid`.
2. Обновить `vite.config.ts`: подключить `silent()` из `@ivlev-dev/silent-vite`.
3. Обновить `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "@ivlev-dev/silent-core"`.
4. Вынести состояние каждого компонента в класс `ViewModel` с `@reactive`, `@computed`, `@watch`.
5. Переписать компоненты: сигнатура `function View(this: { vm: ...; preloader?: ... }, props)`, чтение состояния через `this.vm`.
6. Импортировать `VM` и прелоадер через `import type`.
7. Заменить `createSignal`/`createEffect`/`createMemo` на эквиваленты Silent (или убрать в пользу декораторов).
8. Заменить `For`/`Index`/`Show`/`Switch`/`Match` на импорты из `@ivlev-dev/silent-core`.
9. Заменить `Suspense`/`lazy` на импорты из `@ivlev-dev/silent-core`, добавить `preloader` при необходимости.
10. Переписать `createStore` на `deepReactive`/`@reactive accessor` или на сигналы в полях.
11. Ввести DI: инъектировать сервисы через конструктор по `import type`, реализовать интерфейсы; проверить индекс (`index: true`).
12. Монтирование: заменить `render` на `mount`/`hydrate`; для SSR — `renderToString`/`renderToStream` и `@ivlev-dev/silent-server`.
13. Настроить SSR-сборку: `ssr.external` для пакетов рантайма.
14. Прогнать `pnpm typecheck`, `pnpm build`, тесты и `pnpm api:check`.
15. Проверить HMR и прелоадеры в dev-режиме.
