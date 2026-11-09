# Silent Framework — архитектурные контракты

Документ фиксирует публичные API и внутренние соглашения между пакетами и Rust-компилятором.

## Пакеты

- `@silent/reactivity` — граф сигналов, эффекты, мемо, батчинг, глубокие прокси.
- `@silent/di` — асинхронный контейнер зависимостей.
- `@silent/core` — декораторы, ViewModel, JSX runtime, компоненты, монтирование, HMR.
- `@silent/swc` — нативный Node-API addon.
- `@silent/vite` — Vite-плагин.
- `@silent/server` — SSR: мини-DOM, `renderToString`, сериализация без внешних DOM-зависимостей.

Все пакеты публикуются как ESM; относительные импорты в собранном коде содержат явное расширение `.js`, чтобы пакеты грузились в чистом Node без бандлера.

## `@silent/reactivity`

```ts
export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((prev: T) => T)) => T;

export interface SignalOptions<T> {
  equals?: (a: T, b: T) => boolean;
}

export interface MemoOptions<T> extends SignalOptions<T> {}

export interface Owner {
  readonly disposed: boolean;
  dispose(): void;
}

export function createSignal<T>(value: T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>];
export function createMemo<T>(fn: () => T, options?: MemoOptions<T>): Accessor<T>;
export function createEffect(fn: () => void): void;
export function createRenderEffect(fn: () => void): void;
export function createRoot<T>(fn: (dispose: () => void) => T): T;
export function getOwner(): Owner | null;
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T;
export function onCleanup(fn: () => void): void;
export function untrack<T>(fn: () => T): T;
export function batch<T>(fn: () => T): T;
export function flushSync(): void;
export function on<T>(
  deps: Accessor<T> | Accessor<T>[],
  fn: (value: T, prev: T) => void,
  options?: { defer?: boolean },
): void;

export function deepReactive<T>(value: T): T;
export function unwrap<T>(value: T): T;
export function isReactive(value: unknown): boolean;
export function isReactiveClass(value: unknown): boolean;

export interface ReactiveStore {
  readonly disposed: boolean;
  dispose(): void;
}

export function createReactiveStore(): ReactiveStore;
export function storeFor(instance: object): ReactiveStore;
export function readField<T>(instance: object, key: PropertyKey, getRaw: () => T): T;
export function writeField<T>(instance: object, key: PropertyKey, value: T, setRaw: (value: T) => void): T;
export function registerCleanup(store: ReactiveStore, fn: () => void): void;
export function getComputed<T>(instance: object, key: PropertyKey, compute: () => T): T;
```

Поведение:

- `createEffect` выполняется один раз в микротаске и затем при изменении зависимостей.
- `createRenderEffect` первый запуск синхронный, обновления — в общем flush.
- `batch` откладывает flush до выхода из внешнего батча.
- `flushSync` принудительно прогоняет очередь.
- `createMemo` ленивый, кеширует значение и не запускает зависимые эффекты, если значение не изменилось.
- `onCleanup` внутри эффекта выполняется перед повторным запуском и при dispose.
- `deepReactive` лениво оборачивает объекты и массивы в прокси с сигналом на каждое свойство/индекс/`length`.
- Мутирующие методы массивов уведомляют только затронутые индексы и `length`.
- Экземпляры классов с `@reactive`-полями не оборачиваются в прокси повторно.
- `readField`/`writeField` используются декоратором `@reactive`.
- `getComputed` создаёт мемо на экземпляр и привязывает его к store.

## `@silent/di`

```ts
export type ScopeName = "singleton" | "transient" | "scoped";
export type Token<T> = symbol & { readonly __type?: T };
export type Factory<T> = (container: Container) => T | Promise<T>;

export interface Binding<T> {
  factory: Factory<T>;
  scope: ScopeName;
}

export class CircularDependencyError extends Error {
  readonly path: unknown[];
}

export class Container {
  readonly name: string;
  constructor(name?: string, parent?: Container);
  bind<T>(token: unknown, factory?: unknown): BindingBuilder;
  resolve<T>(token: unknown): Promise<T>;
  peek<T>(token: unknown): T | undefined;
  has(token: unknown): boolean;
  createScope(name?: string): Container;
  clearCache(token?: unknown): void;
  onDispose(fn: () => void): void;
  dispose(): void;
}

export interface BindingBuilder {
  inSingletonScope(): BindingBuilder;
  inTransientScope(): BindingBuilder;
  inScopedScope(): BindingBuilder;
}

export const DI_CREATE: unique symbol;
export const container: Container;
export function createToken<T>(name: string): Token<T>;
```

Семантика: точно как `reference/silentwire/src/runtime/container.ts`, с добавлениями `peek`, `has`, `onDispose`, `dispose`.

- Singleton живёт в контейнере-владельце binding-а.
- Scoped живёт в контейнере, с которого начался resolve.
- Transient не кешируется после успешного resolve; параллельные resolve до завершения делят один Promise.
- Ошибка factory очищает кеш.
- Циклы обнаруживаются и выбрасывают `CircularDependencyError`.
- `bind` очищает кеш токена в текущем контейнере и потомках.
- `peek` возвращает уже разрешённое значение без запуска factory.
- `dispose` вызывает `onDispose`-хуки и очищает кеш/биндинги/детей.

## Индекс интерфейсов

Rust-сканер возвращает JSON:

```json
{
  "interfaces": {
    "/abs/path/types.ts#Store": ["/abs/path/memory-store.ts#MemoryStore"]
  },
  "values": {
    "/abs/path/types.ts": ["Store", "createStore"]
  }
}
```

- `interfaces` — interface token → реализации.
- `values` — экспортируемые значения модуля; нужны, чтобы отличить value-token от интерфейса при `import type`.

## Компоненты

### View-компонент

```tsx
export function Counter(
  this: { vm: CounterVM; preloader: typeof CounterPreloader },
  props: { count: number },
) {
  return <span class="count">{this.vm.count}</span>;
}
```

Или через тип-хелпер:

```tsx
export function Counter(
  this: ViewContext<CounterVM, typeof CounterPreloader>,
  props: { count: number },
) {}
```

- `vm` — класс или интерфейс. Интерфейс разрешается через индекс: ровно одна реализация.
- `preloader` — синхронный компонент без `this.vm`.
- `vm` и `preloader` могут быть импортированы через `import type`; компилятор добавит value-import.
- Синхронный компонент — функция без `this.vm`: `function Loader(props) { ... }`.

### Метаданные

Компилятор добавляет:

```js
Counter[Symbol.for("silent.view")] = {
  vm: CounterVM,
  preloader: CounterPreloader,
  name: "Counter",
  moduleId: "<vite module id>",
};
```

### Runtime-контекст

При вызове view:

```js
Counter.call({ vm, preloader: CounterPreloader }, props);
```

### Lifecycle

Порядок для view:

1. Создаётся дочерний scope контейнера.
2. Резолвится VM (асинхронно).
3. `vm.props = props`.
4. `vm.created?.()`.
5. Вызывается view, создаётся DOM.
6. Вставка в DOM, `vm.view = rootNode`.
7. `vm.beforeMount?.()` перед вставкой, `vm.mounted?.()` после.
8. При удалении: `vm.beforeUnmount?.()`, dispose store/эффектов/scope, `vm.unmounted?.()`.

### Наследование DI-скоупа

При рендере view устанавливаются runtime-опции `{ container: scope }`, поэтому компоненты, вызванные из view (в том числе синхронные), создают дочерние scope от скоупа родителя. Наследование сохраняется и при асинхронном резолве VM: вложенные компоненты получают тот же контейнер.

```tsx
mount(target, App, { container: appScope });
```

Внутри `App` любой `<Child />` видит биндинги `appScope`.

### Прелоадер

Приоритет:

```text
this.preloader из метаданных
  → CounterVM.preloader (static)
  → Component.preloader, заданный setPreloader
  → глобальный defaultPreloader
  → пустой якорь
```

## JSX runtime

Компилятор импортирует из `@silent/core/jsx-runtime`:

```ts
export function template(html: string): () => Node;
export function templateHoles(html: string): () => { node: Node; holes: Comment[]; attrs: Element[] };
export function insert(parent: Node, accessor: () => unknown, marker?: Node): void;
export function text(node: Text, accessor: () => unknown): void;
export function attr(el: Element, name: string, accessor: () => unknown): void;
export function prop(el: Element, name: string, accessor: () => unknown): void;
export function style(el: Element, accessor: () => unknown): void;
export function spread(el: Element, accessor: () => unknown): void;
export function on(el: Element, name: string, accessor: () => EventListener): void;
export function ref(el: Element, accessor: () => unknown): void;
export function effect(fn: () => void): void;
export function component(fn: Function, props: Record<string, unknown>): Node;
export function dynamic(tag: () => string, props: Record<string, unknown>): Node;
export function fragment(accessor: () => unknown): Node;
export function Suspense(props: SuspenseProps): Node;
export function lazy<P extends Record<string, unknown>>(
  loader: () => Promise<AnyComponent | { default: AnyComponent }>,
  options?: LazyOptions,
): (props: P) => Node;
```

Управляющие компоненты: `For`, `Show`, `Suspense`. Асинхронность одиночного view покрывается `preloader` в `this`-типе. 

#### Suspense и lazy

```tsx
import { lazy, Suspense } from "@silent/core";

const Profile = lazy<{ id: number }>(() => import("./profile"));

export function App() {
  return (
    <Suspense fallback={<span>Загрузка...</span>}>
      <Profile id={1} />
    </Suspense>
  );
}
```

- `Suspense` переключает fallback на детей, когда все зарегистрированные промисы завершились.
- Внутри `Suspense` прелоадеры вложенных view не показываются: граница берёт ожидание на себя.
- `lazy(loader, options)` грузит модуль один раз на обёртку и рендерит `default`-экспорт.
- Без `Suspense` `lazy` показывает `options.preloader`, иначе глобальный прелоадер, иначе пустой якорь.
- `options.onError` вызывается при ошибке загрузки; без него используется `setErrorHandler`.
- Готовность `lazy` доступна через `getReady` и учитывается `mount().ready`.

#### Производительность `For`

- Один якорный комментарий на элемент вместо двух; содержимое вставляется после якоря.
- Индексный сигнал создаётся лениво, только когда `children` читает `index()`.
- Пул элементов хранит одиночное значение в `Map`, массив создаётся только при дубликатах.
- Если порядок не изменился, проход перемещений пропускается и DOM не трогается.
- При перестановке двигаются только элементы вне LIS.

- `template` кеширует клонирование по HTML-строке.
- `insert` принимает Node, строку, число, массив, функцию, `null`/`undefined`/boolean.
- `text` обновляет `Text.data` только при изменении значения.
- `attr`/`prop`/`style` сравнивают с предыдущим значением.
- `on` навешивает обработчик один раз и читает актуальную функцию.
- `component` читает `Symbol.for("silent.view")` и вызывает view/sync-компонент.

## Rust-компилятор

Порядок:

1. Парсинг TS/TSX.
2. Компонентные метаданные, DI, JSX.
3. Штатные проходы SWC: TS strip, decorators, target, minify.
4. Codegen + source map.

Публичное API нативного addon:

```ts
transform(source: string, filename: string, optionsJson: string, indexJson: string): string;
scan(root: string): string;
version(): string;
```

`transform` возвращает JSON `{ code: string, map: string | null, diagnostics: string[] }`.

## HMR

- Компилятор внедряет `import.meta.hot.accept`.
- Реестр инстансов хранится на `globalThis`.
- При обновлении view-модуля сохраняется VM и контекст.
- При обновлении VM-модуля VM пересоздаётся с переносом значений `@reactive`-полей.
- Несовместимые изменения приводят к `import.meta.hot.invalidate()`.

## SSR и гидрация

### `@silent/server`

Пакет не зависит от jsdom/linkedom. Внутри — собственный мини-DOM:

```text
packages/server/src/dom/
  types.ts       # контракты DomNode/DomElement/DomDocument
  node.ts        # NodeImpl, TextImpl, CommentImpl, ElementImpl, SvgElementImpl
  attributes.ts  # AttributesImpl
  style.ts       # StyleImpl, отражает cssText в атрибут style
  parser.ts      # парсер подмножества HTML компилятора, TemplateElementImpl
  document.ts    # DocumentImpl, TreeWalkerImpl, installDomGlobals
  serializer.ts  # сериализация с экранированием и void-тегами
```

`renderToString(app, options)`:

1. Ставит мини-DOM в глобалы и включает серверный режим (`setServerMode`).
2. Создаёт корень и ждёт `ready`, `whenIdle`, `flushSync` — включая `Suspense` и `lazy` (`trackAsyncWork`).
3. Сериализует дерево со всеми якорями; `data-silent-a-N` сохраняются для клиента.
4. В `finally` восстанавливает глобалы и демонтирует корень.

Вызовы сериализуются очередью, потому что DOM-глобалы общие на процесс.

### Гидрация

`hydrate(target, app, options)` — отложенный клиентский рендер: приложение рендерится в отсоединённый фрагмент, серверная разметка остаётся видимой до готовности всех асинхронных view, затем содержимое заменяется один раз. Поузловая адоптация требует стабильных идентификаторов в разметке и запланирована отдельно; текущая реализация гарантирует отсутствие прелоадера и двойного рендера в видимой области.

### Внешний рантайм в SSR

Vite не должен встраивать копию `@silent/core` в SSR-граф, иначе приложение и `renderToString` получат разные модульные экземпляры (разные `whenIdle`/`setServerMode`). В `vite.config.ts` задавайте `ssr.external` для всех `@silent/*`.
