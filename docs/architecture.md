# Silent Framework — архитектурные контракты

Документ фиксирует публичные API и внутренние соглашения между пакетами и Rust-компилятором.

## Пакеты

- `@ivlev-dev/silent-reactivity` — граф сигналов, эффекты, мемо, батчинг, глубокие прокси.
- `@ivlev-dev/silent-di` — асинхронный контейнер зависимостей.
- `@ivlev-dev/silent-core` — декораторы, ViewModel, JSX runtime, компоненты, монтирование, HMR.
- `@ivlev-dev/silent-swc` — нативный Node-API addon.
- `@ivlev-dev/silent-vite` — Vite-плагин.
- `@ivlev-dev/silent-server` — SSR: мини-DOM, `renderToString`, сериализация без внешних DOM-зависимостей; subpath `/pool` — worker pool для параллельного рендера.
- `@ivlev-dev/silent-router` — опциональный router: `IRouter`, route-классы `Route`, `Link`, `RouterView`, browser/memory history, guards/loaders, DI-доставка и SSR.
- `@ivlev-dev/silent-validation` — опциональная валидация: stage-3 accessor-декораторы, правила, i18n и рантайм-проверка схем.
- `@ivlev-dev/silent-validation-vite` — Vite-плагин `validation()`: генерирует схемы из TS-типов для потомков `ValidationModel`.
- `@ivlev-dev/silent-protocol` — бинарный протокол: схема из класса, encode/decode без имён полей.
- `@ivlev-dev/silent-protocol-vite` — Vite-плагин `protocol()`: схема из TS-типов.
- `@ivlev-dev/silent-form` — опциональные реактивные формы: `Form` поверх `ValidationModel`, `@Field`/`@FormField`, вложенные формы, `FormArray`, wizard, dirty-guard и `uploadField`. Зависит от `core`, `reactivity` и `validation`; в метапакет не входит.
- `@ivlev-dev/silent` — метапакет: ставит `core`, `di`, `reactivity`, `router`, `swc` и `vite` одной зависимостью (`server`, `form`, `validation` и `validation-vite` — отдельно).

Все пакеты публикуются как ESM; относительные импорты в собранном коде содержат явное расширение `.js`, чтобы пакеты грузились в чистом Node без бандлера.

## `@ivlev-dev/silent-reactivity`

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

## `@ivlev-dev/silent-di`

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
  resolveSync<T>(token: unknown): T;
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

Семантика: асинхронный контейнер с кешем промисов и разрешением конструкторов на этапе компиляции, дополненный `peek`, `has`, `onDispose`, `dispose`.

- Singleton живёт в контейнере-владельце binding-а, фабрика получает запрашивающий контейнер.
- Scoped живёт в контейнере, с которого начался resolve.
- Transient не кешируется после успешного resolve; параллельные resolve до завершения делят один Promise.
- Singleton-фабрика не может захватить scoped-зависимость из контейнера короче своей жизни: `InvalidScopeError`.
- Ошибка factory очищает кеш.
- Циклы обнаруживаются, `resolve` отклоняется `CircularDependencyError`; `resolve` не бросает синхронно, `resolveSync` читает готовое значение и бросает.
- `bind` очищает кеш токена в текущем контейнере и потомках.
- `peek` возвращает уже разрешённое значение без запуска factory.
- `dispose` вызывает `onDispose`-хуки, освобождает инстансы через `[Symbol.dispose]` в порядке LIFO, очищает кеш/биндинги/детей даже при исключении.
- SSR создаёт request scope на каждый `renderToString` и освобождает его после рендера.

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

`component()` дополняет амбиентные runtime-опции явными: `container` из аргумента имеет приоритет над унаследованным. Для Router/Session используйте `bindValue`/`singleton` в корневом контейнере; `inScopedScope` даст новый экземпляр на каждом view, так как scope view отдельный.

```tsx
mount(target, App, { container: appScope });
const child = component(View, {}, { container: appScope });
```

Внутри `App` любой `<Child />` видит биндинги `appScope`.

### Прелоадер

Приоритет:

```text
meta.preloader (this.preloader из метаданных)
  → Component.preloader, заданный setPreloader
  → CounterVM.preloader (static)
  → глобальный defaultPreloader
  → пустой якорь
```

## JSX runtime

Компилятор импортирует из `@ivlev-dev/silent-core/jsx-runtime`:

```ts
export function template(html: string): () => Node;
export function templateHoles(
  html: string,
  plan?: TemplatePlan | false,
  namespace?: "svg",
): () => { node: Node; holes: readonly (Comment | ServerHole)[]; attrs: readonly Element[] };
export function insert(parent: Node, accessor: () => unknown, marker?: Node | ServerHole): void;
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

- `template` кеширует разобранный шаблон по паре `(Document, html)`: `WeakMap<Document, Map<string, TemplateParse>>`. Ключ по документу делает кеш realm-safe — SSR-документ мини-DOM и клиентский `document` в одном процессе не переиспользуют `DocumentFragment` друг друга.
- `insert` принимает Node, строку, число, массив, произвольный `Iterable` (`Set`, генератор, `NodeList`), функцию, `null`/`undefined`/boolean.
- `text` обновляет `Text.data` только при изменении значения.
- `attr`/`prop`/`style` сравнивают с предыдущим значением; нативные `value`/`checked`/`selected`/`disabled` повторно не записываются.
- `on` навешивает обработчик один раз и читает актуальную функцию; для делегированных событий `event.currentTarget` указывает на элемент-обработчик.
- `component` читает `Symbol.for("silent.view")` и вызывает view/sync-компонент.

## Rust-компилятор

Порядок:

1. Парсинг TS/TSX.
2. Компонентные метаданные, DI, JSX.
   - Деструктуризация `props` в компоненте переписывается в чтения исходного объекта (`const { value } = props` → `props.value`), поэтому переименование и defaults не теряют реактивность.
   - RCDATA/raw-text элементы (`textarea`, `title`, `style`, `script`) не получают комментарии-хуки: статический текст остаётся в разметке, динамическое содержимое сворачивается в один бондинг (`value` для `textarea`, `textContent` для остальных) с маркерами `data-silent-a-N` и `data-silent-text`.
   - Динамические SVG-шаблоны внутри `<svg>` получают namespace-хинт `"svg"`; `foreignObject` возвращает HTML-контекст для детей.
3. Штатные проходы SWC: TS strip, decorators, target, minify.
4. Codegen + source map.

Публичное API нативного addon:

```ts
transform(source: string, filename: string, optionsJson: string, indexJson: string): string;
scan(root: string, optionsJson: string): string;
scanFiles(root: string, filesJson: string, optionsJson: string): string;
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

### `@ivlev-dev/silent-server`

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
2. Ставит коллектор метаданных (`setMetadataCollector`): `<title>` выносится из дерева в `head`.
3. Создаёт корень и ждёт `ready`, `whenIdle`, `flushSync` — включая `Suspense` и `lazy` (`trackAsyncWork`).
4. Сериализует дерево со всеми якорями; `data-silent-a-N` сохраняются для клиента.
5. Возвращает `{ html, head }`: `head` содержит заголовок, `html` — разметку без него.
6. В `finally` сбрасывает коллектор, восстанавливает глобалы и демонтирует корень.

Вызовы сериализуются очередью, потому что DOM-глобалы общие на процесс.

#### Контекст рендера

`beginRenderSession` создаёт на каждый рендер `RuntimeContextStore` и выполняет создание дерева, settle и сериализацию через `RenderSession.run`, то есть в async-контексте `AsyncLocalStorage`. Store хранит runtime-опции (request scope, `preloader`, `onError`), флаг серверного режима, коллектор метаданных/`head`, stream-коллектор, счётчик id и набор pending. Runtime-опции core читает в порядке: owner-scoped опции → store текущей async-цепочки → legacy-переменные модуля. `whenIdle()`/`hasPendingWork()` внутри рендера работают с pending своего store, вне рендера — с общим набором.

Контракт провайдера вынесен во внутренний сабпуть `@ivlev-dev/silent-core/runtime-context-provider` (помечен `@internal`, из основного entry не экспортируется). Серверный пакет лениво инициализирует `node:async_hooks`; если ALS недоступен, один раз выводит предупреждение и переходит на прежний последовательный fallback через модульные переменные. Dispose и очистка ресурсов выполняются внутри store; store закрывается последним (`active = false`, поля обнуляются), поэтому поздние колбэки после таймаута или отмены не видят store-scoped состояния (опции, id, коллекторы metadata/stream, pending). Оговорка: `isServerMode()` опирается на процессный флаг активного сериализованного рендера, поэтому поздний колбэк может получить `true`, пока идёт другой рендер.

Границы изоляции: ALS разделяет опции, id, `head`, stream и pending, но не DOM-шимы (`document`, `Node`, `Element`, ...) и не планировщик реактивности (`flushSync`). Поэтому `enqueueRenderTask` по-прежнему выполняет один рендер за раз, а параллелизм достигается worker/process pool. Вложенный `renderToString`/`renderToStream` внутри активного рендера даёт `RenderReentrancyError` (класс не экспортируется, проверка по `name`).

Практическая модель остаётся прежней: **один рендер на экземпляр модуля/процесс**, ALS даёт изоляцию контекста, но не параллельность; очередь отпускается по завершении, таймауту или отмене (`reader.cancel()`/`options.signal`). Для параллельного SSR в одном процессе используйте `@ivlev-dev/silent-server/pool`, для масштабирования — несколько процессов/реплик. Request-scoped данные живут в request scope контейнера (`renderToString` создаёт его сам); глобальный `container` — process-wide.

#### Worker pool

Subpath `@ivlev-dev/silent-server/pool` (`createRenderPool`) запускает `worker_threads`-воркеры, каждый со своим экземпляром модулей и своими DOM-шимами. Инвариант планировщика — **один job на воркер**: задача занимает слот до `result`/`end`, остальные ждут в очереди; вложенный рендер внутри активного запрещён.

- Unary-задача передаётся через общий `parentPort` сообщением `render`; ответ коррелируется по `id`.
- Стрим получает отдельный `MessageChannel` на задание: чанки, `head`, `shell` и `end` идут по нему, а `pause`/`resume`/`cancel` — обратно. Общий канал не смешивает стримы разных задач.
- Успех стрима — только `end`; закрытие порта или выход воркера до `end` дают `worker-exited`. `head` обязателен (`stream-head-missing`).
- Таймаут/отмена unary завершают воркер; стрим сначала получает `cancel`, затем воркер выводится из работы и через `terminateGraceMs` завершается. `close()` отменяет активные стримы и дожидается unary-задач.
- Границы v1: честного backpressure нет (серверный `renderToStream` не умеет ждать читателя), вместо него — `highWaterMark`, `maxBufferedChars` и `stream-overflow`. Singletons DI и `process.env` — per-worker; entry должен быть собранным файлом. Финальный head после отправки `<head>` применить нельзя — только shell-head.

### Гидрация

`hydrate(target, app, options)` — адоптация серверной разметки: view находит свои маркеры, `templateHoles` занимает существующие узлы вместо клонирования, `insert` привязывает текстовые значения к серверным `Text`, а для компонентов/узлов и вставок после статического текста использует регионы `silent-insert`/`silent-insert-end`. `For`/`Show`/`Suspense`/`lazy`/`fragment` находят свои якоря. Эффекты привязываются к адоптированным узлам, поэтому последующие обновления работают как при обычном монтировании. Несовпадение формы узла бросает `HydrationMismatchError`, view откатывается на клиентский рендер, ошибка уходит в `onMismatch`. Заголовки страницы на сервере выносятся из body, поэтому при гидрации клиент создаёт `<title>` заново и вставляет в `head`; статический серверный заголовок временно удаляется менеджером метаданных и восстанавливается при размонтировании.

Многослойные шаблоны и `For` с `fallback` адоптируются: корни забираются по порядку, а отложенные узлы возвращаются на место через `settleNodes`. Ограничение: значения должны строиться через `template()`/`templateHoles()`.

### Внешний рантайм в SSR

Vite не должен встраивать копию `@ivlev-dev/silent-core` в SSR-граф, иначе приложение и `renderToString` получат разные модульные экземпляры (разные `whenIdle`/`setServerMode`). В `vite.config.ts` задавайте `ssr.external` для всех `@ivlev-dev/silent-*`.


## Релиз

- Версии всех публичных пакетов синхронны и совпадают с тегом `v<version>`.
- `pnpm pack:check` проверяет состав tarball'ов и отсутствие `workspace:` в зависимостях.
- `pnpm install:check` распаковывает tarball'ы в чистый `node_modules`, проверяет импорты, рантайм-экспорты и версию нативного addon.
- Workflow `Release` собирает пребилды addon только для Linux x64 (`x86_64-unknown-linux-gnu`) и Windows x64 (`x86_64-pc-windows-msvc`); для остальных платформ бинарник собирается локально. Workflow прогоняет тесты и публикует пакеты; нужен `NPM_TOKEN`.
