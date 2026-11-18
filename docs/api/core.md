# @ivlev-dev/silent-core

Основной пакет рантайма Silent Framework: Stage-3 декораторы реактивности, ViewModel, view-компоненты с асинхронным DI, монтирование, JSX-рантайм, управляющие конструкции `For` / `Show` / `Suspense`, `lazy`, прелоадеры и обработка ошибок.

Серверные API в этот пакет не входят.

## Импорты

Прикладной код импортируется из `@ivlev-dev/silent-core`:

```ts
import {
  reactive,
  computed,
  watch,
  ViewModel,
  mount,
  For,
  Show,
  Suspense,
  lazy,
  setDefaultPreloader,
  setErrorHandler,
  whenIdle,
} from "@ivlev-dev/silent-core";
```

Компилятор (плагин `@ivlev-dev/silent-vite`, встроенный в сборку) генерирует импорты из сабпути `@ivlev-dev/silent-core/jsx-runtime`. Этот entry переэкспортирует зарезервированные имена:

- точки входа компиляции JSX: `jsx`, `jsxs`, `jsxDEV`, `Fragment`;
- DOM-примитивы скомпилированных шаблонов: `template`, `templateHoles`, `insert`, `text`, `attr`, `prop`, `style`, `spread`, `on`, `ref`, `effect`, `fragment`, `dynamic`, `attachDisposer`, `NODE_DISPOSER`;
- компоненты и помощники: `component`, `createComponent`, `For`, `Show`, `Suspense`, `lazy`;
- runtime-управление: `getReady`, `getOwnReady`, `whenSettled`, `getViewMeta`, `getComponentName`, `isViewComponent`, `setPreloader`, `setFallback`, `setDefaultPreloader`, `setErrorHandler`, `whenIdle`;
- символы метаданных: `VIEW_META`, `PRELOADER`, `COMPONENT_READY`, `COMPONENT_DISPOSE`;
- типы: `JSX`, `Child`, `Children`, `AnyComponent`, `Preloader`, `ViewMeta`, `ViewRuntimeContext`, `SuspenseProps`, `LazyOptions`.

Прикладному коду сабпуть `@ivlev-dev/silent-core/jsx-runtime` не нужен: всё перечисленное доступно и из `@ivlev-dev/silent-core`.

## Архитектура рантайма

### Метаданные view-компонента

Компилятор аннотирует компонент метаданными под символом `Symbol.for("silent.view")` (`VIEW_META`, см. раздел [Символы метаданных](#символы-метаданных)):

```ts
Counter[Symbol.for("silent.view")] = {
  vm: CounterVM,
  preloader: CounterPreloader,
  preloaderName: "CounterPreloader",
  name: "Counter",
  moduleId: "src/counter.tsx",
};
```

- `vm` — обязательный токен ViewModel (класс или интерфейс, разрешаемый через DI).
- `preloader` — синхронный компонент без ViewModel, показываемый до резолва VM.
- `name` — человекочитаемое имя (используется `getComponentName`).
- `moduleId` — идентификатор модуля для HMR-реестра; при его наличии view-инстанс регистрируется в рантайме.
- `preloaderName` — имя прелоадера в исходном модуле, используется обновлениями HMR.

Компонент без метаданных (или с метаданными без `vm`) считается синхронным: он вызывается напрямую с `props` и возвращает `Node`.

### Асинхронный резолв ViewModel и scope

`createComponent` для view-компонента:

1. Создаёт дочерний scope контейнера `options.container ?? container` с именем `view:<имя компонента>`.
2. Создаёт `ComponentContext` и биндит его в scope как DI-токен: экземпляр ViewModel может затребовать контекст через конструктор.
3. Создаёт `AbortController` и передаёт его `signal` в контекст; сигнал прерывается при dispose.
4. Показывает прелоадер между комментарий-маркерами `<!--silent-view-->` и `<!--silent-view-end-->`.
5. Асинхронно резолвит VM через `scope.resolve(meta.vm)`; в этот момент `ready` компонента ещё не завершён.
6. После резолва назначает `vm.props`, вызывает `created`, `beforeMount`, рендерит view (компонент вызывается как `this: { vm, preloader }`), вставляет узлы, назначает `vm.view` и `context.view`, вызывает `mounted`.

Scope наследуется вниз: компоненты, вызванные внутри view, получают те же runtime-опции с `container: scope`, поэтому их DI-биндинги видны детям.

### Жизненный цикл view

Порядок хуков ViewModel: `created` → `beforeMount` → (рендер и вставка) → `mounted`. При повторном рендере (HMR) вместо пары `created`/`beforeMount`/`mounted` вызывается `updated`. При dispose: `beforeUnmount` → очистка view → `unmounted` → `vm.dispose()`.

Хуки опциональны и распознаются по имени на объекте VM — наследование `ViewModel` полезно, но не обязательно.

### Прелоадеры

Приоритет выбора прелоадера view-компонента:

1. `meta.preloader` — прелоадер из метаданных (в `this` доступен как `preloader`).
2. Прелоадер, прикреплённый `setPreloader` / `setFallback` к самой функции компонента.
3. Свойство `preloader` (алиас `fallback`) у токена VM, например статическое поле класса.
4. Глобальный `defaultPreloader`, заданный `setDefaultPreloader` или опцией `mount`.
5. Пустой якорь — если прелоадера нет, пользователю показывается пустое место.

Правила:

- Прелоадер обязан быть синхронным компонентом без ViewModel; нарушение выявляется в рантайме и приводит к ошибке через обработчик ошибок.
- Внутри `Suspense` прелоадеры вложенных view не рендерятся: граница показывает собственный `fallback`.

### Обработка ошибок

- Обработчик задаётся `setErrorHandler` глобально или опцией `onError` у `mount` / `createComponent` / `withRuntimeOptions`; по умолчанию ошибки выводятся в `console.error`.
- Ошибка async-резолва VM: обработчик вызывается, между маркерами view вставляется текстовый узел `Error: <message>`. `ready` компонента при этом не отклоняется.
- Ошибка загрузки `lazy`: обработчик (`options.onError` или глобальный) вызывается, вместо контента вставляется текстовый узел.

## Декораторы и ViewModel

Декораторы реализуют связку с `@ivlev-dev/silent-reactivity`: каждое поле получает собственную цепочку сигналов, вычисления мемоизируются, watcher-ы привязаны к reactive store экземпляра.

### `reactive`

*Стабильность: public.*

Декоратор Stage-3 для спецификатора `accessor`. При инициализации экземпляра класс помечается как reactive-класс; чтение и запись поля идут через глубокий прокси:

- каждый примитив и каждое вложенное свойство/индекс/`length` — отдельный сигнал;
- мутации массивов (`push`, `splice` и т.д.) уведомляют только затронутые индексы;
- экземпляры классов с `@reactive`-полями повторно не оборачиваются в прокси.

```ts
import { reactive } from "@ivlev-dev/silent-core";

class Profile {
  @reactive accessor name = "Ann";
  @reactive accessor address = { city: "Moscow" };
}
```

Применяется только к полям с `accessor`; обычные поля этим декоратором не поддерживаются.

### `computed`

*Стабильность: public.*

Декоратор stage-3 для геттера. Значение вычисляется лениво, мемоизируется на экземпляр по имени свойства и не перезапускает зависимые эффекты, если результат не изменился.

```ts
import { computed, reactive } from "@ivlev-dev/silent-core";

class Basket {
  @reactive accessor items: number[] = [];

  @computed
  get total(): number {
    return this.items.reduce((sum, item) => sum + item, 0);
  }
}
```

### `WatchOptions`

*Стабильность: public.*

```ts
interface WatchOptions<R> {
  immediate?: boolean;
  equals?: (a: R, b: R) => boolean;
  defer?: boolean;
}
```

- `equals` — сравнение предыдущего и нового значения; по умолчанию `Object.is`.
- `immediate: true` — обработчик вызывается при первом прогоне с `next` и `prev === undefined`.
- `defer: true` — вместе с `immediate` отменяет этот немедленный первый вызов: обработчик сработает только при первом реальном изменении.

### `watch`

*Стабильность: public.*

Декоратор метода: `@watch(selector, options?)`. Селектор выполняется внутри эффекта и читает реактивные поля экземпляра. Обработчик вызывается вне отслеживания, через `untrack`, как `(next, prev)`:

```ts
import { reactive, watch } from "@ivlev-dev/silent-core";

class Tolerance {
  @reactive accessor value = 0;
  readonly calls: number[] = [];

  @watch((vm: Tolerance) => vm.value, {
    equals: (a, b) => Math.floor(a / 10) === Math.floor(b / 10),
  })
  onValue(next: number): void {
    this.calls.push(next);
  }
}
```

Правила:

- Метод обязан иметь сигнатуру `(next: R, prev?: R | undefined) => void`.
- Watcher создаётся в собственном root и регистрируется в cleanup reactive store экземпляра: `vm.dispose()` останавливает отслеживание.
- Сравнение: если `equals(previous, next)` истинно, обработчик не вызывается.
- Декоратор работает и на методах базового класса: в наследнике отслеживание продолжается на его экземплярах.

### `ViewModel`

*Стабильность: public.*

```ts
abstract class ViewModel<P = unknown> {
  props!: P;
  view!: Node;

  created?(): void;
  beforeMount?(): void;
  mounted?(): void;
  updated?(): void;
  beforeUnmount?(): void;
  unmounted?(): void;

  dispose(): void;
}
```

- `props` и `view` создаются рантаймом: `view` — после вставки корневого узла.
- `view` имеет тип `Node`, потому что view может вернуть несколько корней (`DocumentFragment`). Если view возвращает один элемент, для `querySelector`, `getBoundingClientRect` и других DOM-методов нужен явный cast: `const root = this.view as Element`.
- `dispose()` останавливает reactive store экземпляра — эффекты, `@watch`, вычисления (`@computed`); повторный вызов безопасен.
- Наследование не обязательно: хуки опознаются по именам на любом объекте VM.
- При `noImplicitOverride` переопределяемые хуки `ViewModel` (`mounted`, `unmounted`, `created`, `beforeMount`, `updated`, `beforeUnmount`) требуют модификатора `override`.
- Типовой параметр `P` описывает props компонента; в примерах используется как `extends ViewModel<{ step: number }>`.

Пример из README:

```tsx
import { computed, reactive, ViewModel, watch } from "@ivlev-dev/silent-core";

export class CounterVM extends ViewModel<{ step: number }> {
  @reactive accessor count = 0;

  @computed
  get double(): number {
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
```

## Компоненты и монтирование

### `ComponentResult`

*Стабильность: public.*

```ts
interface ComponentResult {
  readonly node: Node;
  readonly ready: Promise<void>;
  readonly settled: Promise<void>;
  update(props: Record<string, unknown>): void;
  dispose(): void;
}
```

- `node` — корневой узел (элемент, фрагмент или фрагмент с маркерами view).
- `ready` — готовность самого компонента: для view-компонента завершается после резолва VM и рендера; для синхронного — сразу (либо берётся `COMPONENT_READY` внутри результата).
- `settled` — готовность всего поддерева: дочерние async VM, `lazy`, `Suspense` и `whenIdle`.
- `update(props)` — аддитивное обновление props без пересоздания компонента: view сохраняет VM/scope и пересчитывает реактивные биндинги, вызывая `updated()`; light-компонент получает стабильный Proxy, а при отсутствии подписчиков перерисовывается с восстановлением focus.
- `dispose()` — останавливает компонент: прерывает `signal`, снимает узлы с DOM, останавливает эффекты и scope, снимает HMR-регистрацию.

### `RuntimeOptions`

*Стабильность: public.*

```ts
interface RuntimeOptions {
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | null | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly boundary?: AsyncBoundary | null | undefined;
  readonly hydrate?: boolean | undefined;
}
```

Опции исполнения для `createComponent`/`component`/`withRuntimeOptions` и текущего JSX-контекста:

- `container` — DI-контейнер, от которого строится дочерний scope view. У `component()` явный `container` имеет приоритет над амбиентным.
- `preloader` — локальный прелоадер, перекрывающий глобальный.
- `onError` — локальный обработчик ошибок, перекрывающий глобальный.
- `boundary` — граница `Suspense` (внутренний тип); создаётся `Suspense` и передаётся вниз автоматически.
- `hydrate: false` — отключает адоптацию серверной разметки для поддерева; используется `RouterView`, который рендерит маршрут заново.

Правило merge для `component()`: явные `runtimeOptions` дополняют `getRuntimeOptions()`, а не заменяют; `container` из явного аргумента перекрывает амбиентный.

Предупреждение: для Router/Session используйте `bindValue`/`singleton` в корневом контейнере. `inScopedScope` создаст новый экземпляр на каждый view, так как scope view отдельный.

### `getRuntimeOptions`

*Стабильность: internal.*

```ts
function getRuntimeOptions(): RuntimeOptions;
```

Возвращает текущие амбиентные runtime-опции. Используется компилированным кодом (`component`, `lazy`, `Suspense`) и интеграции (`@ivlev-dev/silent-vite`, `@ivlev-dev/silent-server`); в прикладном коде прямое применение не требуется.

### `withRuntimeOptions`

*Стабильность: internal.*

```ts
function withRuntimeOptions<T>(options: RuntimeOptions, fn: () => T): T;
```

Выполняет `fn` с временно установленными амбиентными опциями, не влияя на внешний код; прежние опции восстанавливаются после. Если `options.boundary` задан, `fn` оборачивается границей через `runWithBoundary`.

### `getDefaultPreloader`

*Стабильность: internal.*

```ts
function getDefaultPreloader(): Preloader | null;
```

Возвращает текущий глобальный прелоадер, заданный `setDefaultPreloader`; `null`, если он не установлен. Используется `lazy`, когда прелоадер явно не задан в опциях.

### `setDefaultPreloader`

*Стабильность: public.*

```ts
function setDefaultPreloader(preloader: Preloader | null): void;
```

Глобальный прелоадер по умолчанию для всех view и `lazy`. `null` сбрасывает на пустой якорь. `mount` с опцией `preloader` устанавливает то же значение глобально.

### `setErrorHandler`

*Стабильность: public.*

```ts
function setErrorHandler(handler: ((error: unknown, component: AnyComponent) => void) | null): void;
```

Устанавливает глобальный обработчик ошибок. `null` возвращает поведение по умолчанию (`console.error`).

### `getErrorHandler`

*Стабильность: internal.*

```ts
function getErrorHandler(): (error: unknown, component: AnyComponent) => void;
```

Возвращает текущий глобальный обработчик ошибок; `lazy` использует его, если `options.onError` не задан.

### `whenIdle`

*Стабильность: public.*

```ts
async function whenIdle(): Promise<void>;
```

Ждёт завершения всех промисов, отслеживаемых рантаймом (разрешения ViewModel всех созданных view). Если во время ожидания появятся новые pending-промисы (например, вложенные async view), ожидание продолжится. Полезно после вставки узлов вне `mount`:

```ts
const result = createComponent(Child, {});
document.body.appendChild(result.node);
await whenIdle();
```

### `hasPendingWork`

*Стабильность: internal.*

```ts
function hasPendingWork(): boolean;
```

Синхронная проверка: есть ли промисы, которые ждёт `whenIdle`. Используется SSR-рендером, чтобы не создавать лишние микротаски, когда асинхронной работы нет.

### `trackAsyncWork`

*Стабильность: internal.*

```ts
function trackAsyncWork<T>(promise: Promise<T>): Promise<T>;
```

Регистрирует произвольный промис в наборе отслеживаемых (`whenIdle` будет ждать его завершения) и возвращает тот же промис. Рантайм применяет это ко всем разрешениям ViewModel; интеграции (серверный рендер) используют функцию, чтобы увеличить окно ожидания на сторонние промисы.

### `AnyComponent`

*Стабильность: public.*

```ts
type AnyComponent = (...args: never[]) => unknown;
```

Тип-приёмник для любой компоненты — синхронной или view. В прикладном коде предпочтительно строго типизировать через `ViewComponent` / `SyncComponent` и применять `AnyComponent` только на границах с нетипизированной средой (тесты, динамические метаданные).

### `Preloader`

*Стабильность: public.*

```ts
type Preloader = (...args: never[]) => unknown;
```

Синхронный компонент без ViewModel, который может отображаться как заглушка. Используется в `RuntimeOptions`, `MountOptions`, `LazyOptions`, `ViewMeta` и `setPreloader`.

### `ViewMeta`

*Стабильность: internal.*

```ts
interface ViewMeta {
  readonly vm: unknown;
  readonly preloader?: Preloader | undefined;
  readonly preloaderName?: string | undefined;
  readonly name?: string | undefined;
  readonly moduleId?: string | undefined;
}
```

Форма метаданных silent.view, формируемых компилятором. `getViewMeta` возвращает её или `null`, если метаданные отсутствуют или не содержат `vm`.

### `ViewRuntimeContext`

*Стабильность: public.*

```ts
interface ViewRuntimeContext {
  readonly vm: object;
  readonly preloader: Preloader | null;
}
```

Тип `this` при вызове view-компонента: доступ к VM через `this.vm` и прелоадер через `this.preloader`.

### `ComponentContextValue`

*Стабильность: public.*

```ts
interface ComponentContextValue<P = unknown> {
  readonly props: P;
  readonly container: Container;
  readonly signal: AbortSignal;
  view: Node | null;
}
```

- `props` — props компонента, переданные `createComponent`/`mount`.
- `container` — дочерний scope контейнера этого view.
- `signal` — `AbortSignal`, прерываемый при dispose view; создаётся лениво, при первом чтении.
- `view` — корневой узел view после вставки; до рендера — `null`.

### `SignalSource`

*Стабильность: internal.*

```ts
type SignalSource = AbortSignal | (() => AbortSignal);
```

Источник сигнала для `ComponentContext`: готовый `AbortSignal` или ленивая фабрика. Рантайм передаёт фабрику, чтобы не создавать `AbortController`, если VM не читает `signal`.

### `ComponentContext`

*Стабильность: public.*

```ts
class ComponentContext<P = unknown> implements ComponentContextValue<P> {
  constructor(props: P, container: Container, signal: SignalSource);
  // ... поля ComponentContextValue
}
```

Класс одновременно является DI-токеном: рантайм биндит экземпляр в scope каждого view, поэтому VM получает его через конструктор или `container.resolve(ComponentContext)`:

```ts
import type { Container } from "@ivlev-dev/silent-di";
import { DI_CREATE } from "@ivlev-dev/silent-di";
import { ComponentContext } from "@ivlev-dev/silent-core";

interface Props {
  count: number;
}

class ContextVM {
  readonly context: ComponentContext<Props>;

  constructor(context: ComponentContext<Props>) {
    this.context = context;
  }

  static [DI_CREATE] = async (di: Container): Promise<ContextVM> => {
    return new ContextVM(await di.resolve<ComponentContext<Props>>(ComponentContext));
  };
}
```

### `getViewMeta`

*Стабильность: internal.*

```ts
function getViewMeta(component: AnyComponent): ViewMeta | null;
```

Читает метаданные silent.view у функции компонента. Возвращает `null`, если метаданные отсутствуют или не содержат `vm`. Используется при HMR-обновлении модуля.

### `getComponentName`

*Стабильность: internal.*

```ts
function getComponentName(component: AnyComponent): string;
```

Возвращает `meta.name`, иначе имя функции, иначе `"Anonymous"`. Используется в названии scope (`view:<name>`) и в сообщениях об ошибках.

### `setPreloader`

*Стабильность: public.*

```ts
function setPreloader<C extends AnyComponent>(component: C, preloader: Preloader): C;
```

Прикрепляет прелоадер к функции компонента (символ `PRELOADER`) и возвращает компонент. Задействуется, если прелоадер не удалось задать декларативно в метаданных. Приоритет прелоадера: метаданные → `setPreloader` → static-поле VM → `setDefaultPreloader` → пустой якорь.

```ts
setPreloader(Counter, () => document.createTextNode("loading"));
```

### `setFallback`

*Стабильность: public.*

Алиас `setPreloader`: доступен для обратной совместимости именования с `{ fallback }`-опциями. Работает идентично: расширяет компонент прелоадером.

### `setReady`

*Стабильность: internal.*

```ts
function setReady(node: Node, ready: Promise<void>): void;
```

Прикрепляет промис готовности к узлу под символом `COMPONENT_READY`. Рантайм и `lazy` делают это автоматически; вручную требуется только при создании собственных асинхронных обёрток.

### `getReady`

*Стабильность: public.*

```ts
function getReady(node: Node): Promise<void>;
```

Возвращает агрегированный промис готовности узла и всего его поддерева: собирает все `COMPONENT_READY`, включая диапазоны `<!--silent-view-->…<!--silent-view-end-->`, и ждёт их через `Promise.all`. Если готовых промисов нет — возвращает уже разрешённый промис.

`getOwnReady(node)` возвращает только собственный `COMPONENT_READY` узла. `whenSettled(node)` ждёт `getReady(node)` и `whenIdle()`.

`mount().ready`/`ComponentResult.ready` — только корневой компонент; `mount().settled`/`ComponentResult.settled` — всё поддерево.

### `createComponent`

*Стабильность: public.*

```ts
function createComponent(
  component: AnyComponent,
  props?: Record<string, unknown>,
  options?: RuntimeOptions,
): ComponentResult;
```

Два сценария:

- **Синхронный компонент** (нет метаданных с `vm`): функция вызывается с `props`, результат нормализуется в один узел или фрагмент; `ready` разрешается сразу (или берётся из `COMPONENT_READY` внутри результата — так учитывается вложенный `lazy`); `dispose` удаляет узлы и запускает их dispose-обработчики.
- **View-компонент** (есть метаданные): создаёт scope, `ComponentContext`, показывает прелоадер, асинхронно резолвит VM, рендерит view; остальные шаги — как в разделе [«Архитектура рантайма»](#архитектура-рантайма).

```ts
const target = document.createElement("div");
document.body.appendChild(target);

const handle = await mount(target, Counter, { props: { count: 7 } });
handle.dispose();
```

При ошибке резолва VM обработчик ошибок вызывается, `ready` не отклоняется, а между маркерами вставляется текст `Error: <message>`.

### `component`

*Стабильность: public.*

```ts
function component(
  componentFn: AnyComponent,
  props: Record<string, unknown>,
  runtimeOptions?: RuntimeOptions,
): Node;
```

Вызывает `createComponent(componentFn, props, mergedOptions)` и возвращает только узел — без `ready` и `dispose`. При отсутствии аргумента используются текущие runtime-опции. Явные `runtimeOptions` дополняют `getRuntimeOptions()`, а не заменяют его; `container` из явного аргумента имеет приоритет над амбиентным. Формат вызова, который компилятор генерирует для `<Comp {...props} />`; удобен и для ручного создания компонентов внутри родителя:

```ts
const child = component(View, {}, { container });
```

```ts
function App(): Node {
  const container = document.createElement("div");
  const child = component(Child, { count: 1 });
  container.appendChild(child);
  return container;
}
```

### `isViewComponent`

*Стабильность: public.*

```ts
function isViewComponent(componentFn: AnyComponent): boolean;
```

`true`, если у компонента есть метаданные silent.view с `vm` — то есть его вызов приведёт к асинхронному резолву ViewModel.

### `getComponentDispose`

*Стабильность: internal.*

```ts
function getComponentDispose(node: Node): (() => void) | null;
```

Читает символ `COMPONENT_DISPOSE` у узла. View-компонент прикрепляет функцию dispose к стартовому маркеру `<!--silent-view-->`; у синхронного компонента функции нет. Возвращает `null`, если её нет.

### `mount`

*Стабильность: public.*

```ts
async function mount(
  target: Element | string,
  app: AnyComponent,
  options?: MountOptions,
): Promise<MountHandle>;
```

Монтирует корневой компонент в элемент:

1. `target` — строка передаётся в `document.querySelector`; если элемент не найден, бросается ошибка «Не найден корневой элемент `<target>`».
2. `options.preloader` / `options.onError`, если заданы, устанавливаются глобально (`setDefaultPreloader` / `setErrorHandler`).
3. Создаётся reactive-владелец и `createComponent(app, options.props ?? {}, runtimeOptions)`.
4. Целевой элемент очищается (если `options.clear !== false`), узел добавляется внутрь.
5. Ожидается `ready` компонента; возвращается `MountHandle`.

```ts
import { mount } from "@ivlev-dev/silent-core";

const handle = await mount("#root", App, {
  container: appScope,
  props: { userId: 1 },
  onError: (error) => console.error(error),
});

handle.dispose();
```

### `MountOptions`

*Стабильность: public.*

```ts
interface MountOptions {
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly props?: Record<string, unknown> | undefined;
  readonly clear?: boolean | undefined;
}
```

- `container` — DI-контейнер корневого view.
- `preloader` — глобальный прелоадер, действует как `setDefaultPreloader`.
- `onError` — глобальный обработчик ошибок, действует как `setErrorHandler`.
- `props` — props корневого компонента.
- `clear` — очищать ли целевой элемент перед вставкой (по умолчанию да, отключается `clear: false`).
- `onMismatch` — обработчик несовпадения серверной разметки при `hydrate`; получает `HydrationMismatchError`. По умолчанию выводится предупреждение в консоль.

### `MountHandle`

*Стабильность: public.*

```ts
interface MountHandle {
  readonly ready: Promise<void>;
  readonly settled: Promise<void>;
  updateProps(props: Record<string, unknown>): void;
  dispose(): void;
}
```

- `ready` — готовность корневого компонента.
- `settled` — готовность всего дерева: дочерние async VM, `lazy`, `Suspense` и `whenIdle`. Для ожидания полного UI используйте `settled`.
- `updateProps(props)` — обновляет props корневого компонента тем же способом, что `ComponentResult.update`: без пересоздания VM и с сохранением DOM/focus.
- `dispose()` — демонтирует приложение (идемпотентно): dispose корневого компонента и владельца, снятие узлов; ViewModel проходит `beforeUnmount`/`unmounted`/`dispose`.

### `updateProps`

*Стабильность: public.*

```ts
type PropsUpdater = (props: Record<string, unknown>) => void;

function updateProps(node: Node, props: Record<string, unknown>): boolean;
function registerPropsUpdater(node: Node, updater: PropsUpdater): void;
function getPropsUpdater(node: Node): PropsUpdater | null;
```

Реестр обновляторов props, привязанный к узлам результата. `updateProps(node, props)` находит updater по корневому узлу или отрендеренному элементу и возвращает `true`; для неизвестного узла возвращает `false`. `registerPropsUpdater`/`getPropsUpdater` позволяют встроить компонент в собственный рендерер. Публичный тип updater — `PropsUpdater`.

### `hydrateIslands`

*Стабильность: public.*

```ts
interface IslandMount {
  readonly target: Element | string;
  readonly app: AnyComponent;
  readonly options?: MountOptions;
}

async function hydrateIslands(islands: readonly IslandMount[]): Promise<MountHandle[]>;
```

`IslandMount` описывает target/app/options одного острова. Частичная гидрация на уровне независимых SSR-островов: каждый `target` содержит отдельно отрендеренную серверную разметку, гидратируется своим `app`, остальная статическая оболочка не трогается. Острова обрабатываются последовательно; возвращённые handles освобождают только свои узлы. Для одного общего дерева с выборочной гидрацией используйте отдельные SSR-корни/острова.

### `hydrate`

*Стабильность: public.*

```ts
async function hydrate(
  target: Element | string,
  app: AnyComponent,
  options?: MountOptions,
): Promise<MountHandle>;
```

Гидрация с сохранением серверных узлов: рантайм не клонирует разметку заново, а **забирает** существующие узлы и привязывает к ним эффекты.

Алгоритм:

1. Вокруг содержимого `target` ставятся границы гидрации, включается режим адоптации.
2. Корневой view находит свои маркеры `<!--silent-view-->` / `<!--silent-view-end-->` и рендерит view в режиме «претензии»: каждый `template`/`templateHoles` сверяет форму следующего серверного узла и возвращает его же, а не клон.
3. Динамические вставки: примитив в позиции без статического текста сервер выводит текстом без региона, клиент привязывает эффект к существующему текстовому узлу. Для компонентов/узлов и вставок после статического текста используются регионы `<!--silent-insert-->…<!--silent-insert-end-->`; первый проход в регионе ничего не вставляет: примитивы обновляют существующий текстовый узел, компоненты/шаблоны адоптируют свои узлы.
4. `For`, `Show`, `Suspense`, `lazy` и `fragment` находят свои якоря/регионы (`silent-item`, `silent-end`, `silent-show`, `silent-suspense`, `silent-fragment`, `silent-lazy`) и продолжают обычную реконсиляцию на последующих обновлениях.
5. Маркеры `data-silent-a-*` снимаются с адоптированных элементов, значения применяются заново.
6. Пока идут асинхронные ViewModel, серверная разметка остаётся видимой; прелоадеры не показываются.
7. Заголовок страницы (`<title>`) в серверной разметке отсутствует: он вынесен в `head` результата SSR, а на клиенте создаётся заново и занимает `document.head`.

При несовпадении формы узла (другая разметка или структура) бросается `HydrationMismatchError`; ближайший view отказывается от адоптации и рендерится клиентски, сохраняя корректность. Ошибка передаётся в `options.onMismatch`.

```ts
import { hydrate } from "@ivlev-dev/silent-core";

const handle = await hydrate("#root", App, {
  container: appScope,
  onMismatch: (error) => console.warn(error.message),
});
```

Ограничения адоптации:

- значения должны создаваться через `template()`/`templateHoles()`; произвольный DOM, собранный вручную внутри синхронного компонента, не адоптируется;
- `<title>` должен быть прямым потомком корневого элемента шаблона view (вложенные глубже заголовки вызывают откат к клиентскому рендеру);
- `lazy` адоптирует содержимое после загрузки модуля, до этого остаётся серверная разметка.

### `setMetadataCollector`

*Стабильность: internal.*

```ts
function setMetadataCollector(
  collector: ((node: Element) => void) | null,
): void;
```

Внутренний хук SSR: `@ivlev-dev/silent-server` устанавливает коллектор на время `renderToString`, чтобы вынесенные `<title>` попали в `head` результата, а не в `body`. Приложение этот API не использует.

### `setServerBackend`

*Стабильность: internal.*

```ts
function setServerBackend(backend: ServerBackend | null): void;
```

Регистрирует строковый SSR-бэкенд, который `templateHoles` и `insert` используют в серверном режиме. Вызывается из `renderToString`; прикладной код не использует.

### `ServerBackend`

*Стабильность: internal.*

```ts
interface ServerBackend {
  createTemplate(html: string): ServerTemplate | null;
  serialize(value: unknown): string;
}
```

`createTemplate` возвращает `null`, если шаблон содержит динамические атрибуты (`data-silent-a-*`) или метаданные — тогда используется мини-DOM. `serialize` превращает значения вставок в HTML.

### `ServerHole`

*Стабильность: internal.*

```ts
interface ServerHole {
  readonly parentNode: unknown;
  set(value: string): void;
}
```

Слот шаблона в строковом SSR: `insert` записывает в него готовую строку.

### `ServerTemplate`

*Стабильность: internal.*

```ts
interface ServerTemplate {
  readonly node: unknown;
  readonly holes: readonly ServerHole[];
  readonly attrs: readonly unknown[];
}
```

Результат `createTemplate`: строковый узел и его слоты. Совместим с `TemplateClone` по форме, но не является DOM-узлом.

## Метаданные и `<head>`

`<title>`, `<meta>` и `<link>` можно рендерить из любого компонента — рантайм вынесет их в `document.head`, как React 19.

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

Правила:

- заголовок выносится из разметки view и вставляется в `head`; текст обновляется реактивно;
- `<meta>` и `<link>` тоже выносятся в `head`: добавляются при монтировании и удаляются при размонтировании; существующие элементы `head` из `index.html` не трогаются;
- при размонтировании view заголовок удаляется, и восстанавливается предыдущий (например, статический `<title>` из `index.html`);
- несколько одновременных заголовков не дедуплицируются — все попадают в `head`, поведение браузера в этом случае не определено (как в React 19); рендерите один `<title>`;
- `<title>` внутри `<svg>`, а также `<title>`, `<meta>` и `<link>` с `itemprop` не выносятся;
- содержимое должно быть текстом: компилятор сворачивает статические и динамические части в один `textContent`-бондинг, поэтому комментарии-хуки не попадают в RCDATA и значение не ломается;
- в SSR заголовок и остальные метаданные возвращаются в `RenderResult.head`, в `html` их нет.

### `HydrationMismatchError`

*Стабильность: public.*

```ts
class HydrationMismatchError extends Error {
  readonly name: "HydrationMismatchError";
}
```

Ошибка несовпадения серверной и клиентской разметки. Возникает при адоптации шаблона, якоря или региона вставки; ловится рантаймом, который откатывается на клиентский рендер текущего view, и передаётся в `onMismatch` (если задан).

### `withoutHydration`

*Стабильность: public.*

```ts
function withoutHydration<T>(fn: () => T): T;
```

Выполняет `fn` без адоптации серверной разметки: компоненты, созданные внутри, строят DOM клиентски. Нужно обёрткам, которые заменяют серверный участок целиком.

### `adoptHydrationRegion`

*Стабильность: public.*

```ts
function adoptHydrationRegion(markerData: string): Comment | null;
```

Во время гидрации ищет в текущем окне комментарий-маркер с указанными данными, удаляет серверные узлы перед ним и возвращает маркер как якорь, сдвигая курсор гидрации за него. Возвращает `null` вне гидрации или если маркер не найден. Нужен компонентам, которые выполняют собственный монтаж поддерева, например `RouterView` из `@ivlev-dev/silent-router`.

## SSR

Пакет `@ivlev-dev/silent-server` рендерит приложение в HTML без браузера и без внешних DOM-зависимостей: внутри пакета собственный мини-DOM (`Document`, парсер шаблонов компилятора, сериализатор).

### `renderToString`

*Стабильность: public.*

```ts
function renderToString(
  app: AnyComponent,
  options?: RenderOptions,
): Promise<RenderResult>;
```

Алгоритм:

1. Вызовы сериализуются внутренней очередью: DOM-глобалы (`document`, `Node`, `Element`, `SVGElement`, `DocumentFragment`, `Text`, `Comment`, `HTMLTemplateElement`, `NodeFilter`) общие на процесс.
2. Создаётся документ мини-DOM, глобалы устанавливаются на время рендера и восстанавливаются в `finally`.
3. Включается серверный режим: `templateHoles` сохраняет атрибуты `data-silent-a-N`, нужные клиенту.
4. `createComponent` + `ready` + `whenIdle` + `flushSync` дожидаются асинхронных ViewModel, `Suspense` и `lazy`.
5. Корневой узел сериализуется вместе с якорями (`silent-view`, `silent-item`, `silent-end`, `silent-hole-N`).
6. Метаданные страницы (`<title>`, `<meta>`, `<link>`) выносятся из дерева и возвращаются в `head`; в `html` их нет.
7. Пакетный компонент демонтируется: ViewModel проходит `unmounted` и `dispose`.

```ts
import { renderToString } from "@ivlev-dev/silent-server";

const { html } = await renderToString(App, { props: { title: "Hi" } });
```

### `RenderOptions`

*Стабильность: public.*

```ts
interface RenderOptions {
  readonly props?: Record<string, unknown> | undefined;
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly markers?: boolean | undefined;
}
```

- `props` — props корневого компонента.
- `container` — корневой DI-контейнер; дочерние view наследуют scope.
- `preloader` — глобальный прелоадер (используется, если у компонента нет своего).
- `onError` — если не задан, первая ошибка резолва/загрузки пробрасывается из `renderToString`; если задан — вызывается обработчик, а рендер завершается.
- `markers` — по умолчанию `true`. При `false` из `html` и `head` удаляются комментарии `silent-*` и атрибуты `data-silent-*`; разметка не предназначена для `hydrate`. HTML уменьшается (1 230 → 369 B, gzip 187 → 134 B), но рендер замедляется на ~20–25% из-за финальной очистки. Для `renderToStream` опция не применяется.

### `RenderResult`

*Стабильность: public.*

```ts
interface RenderResult {
  readonly html: string;
  readonly head: string;
}
```

- `html` — разметка приложения без метаданных: `<title>`, `<meta>` и `<link>` вынесены в `head`.
- `head` — сериализованные метаданные (`<title>`, `<meta>`, `<link>` в порядке регистрации); вставьте их в `<head>` документа.

```ts
const { html, head } = await renderToString(App);

const page = `<!doctype html><html><head>${head}</head><body><div id="app">${html}</div></body></html>`;
```

Ограничения SSR:

- серверный мини-DOM не реализует события и `replaceChildren` — интерактивные эффекты выполняются, но ничего не делают;
- произвольный HTML в `template()` не поддерживается: парсер рассчитан на подмножество, которое генерирует компилятор.

### `renderToStream`

*Стабильность: public.*

```ts
function renderToStream(
  app: AnyComponent,
  options?: StreamOptions,
): ReadableStream<string>;
```

Отдаёт прогрессивное тело документа. Первый чанк — синхронный shell с fallback-содержимым незавершённых границ; готовые `Suspense`, `lazy` и асинхронные ViewModel дописываются чанками-патчами. `head` передаётся в `onHead` до первого чанка тела.

```ts
import { renderToStream } from "@ivlev-dev/silent-server";

const stream = renderToStream(App, {
  chunkSize: 16 * 1024,
  onHead: (head) =>
    res.write(`<!doctype html><html><head>${head}</head><body><div id="app">`),
});

for await (const chunk of stream) {
  res.write(chunk);
}
res.end("</div></body></html>");
```

Незавершённая граница в shell обёрнута комментариями `<!--silent-stream:ID-->…<!--silent-stream-end:ID-->`. По готовности сервер пишет патч:

```html
<template data-silent-stream="ID">…итоговая разметка…</template>
<script>window.__silentStream.patch(ID)</script>
```

Минимальный inline-runtime приходит один раз перед первым патчем, заменяет fallback на содержимое и удаляет служебные узлы. Итоговый DOM совпадает с разметкой `renderToString`, поэтому `hydrate` принимает его без изменений. Вложенные границы патчатся независимо.

`head` синхронной части доступен сразу. Если асинхронная граница добавила метаданные, `onHead` вызывается повторно с `info.final === true`; замените ранее отданный head.

### `HeadStreamInfo`

*Стабильность: public.*

```ts
interface HeadStreamInfo {
  readonly final: boolean;
}
```

- `final: false` — head собран из синхронного shell и может быть неполным.
- `final: true` — head изменился после завершения асинхронных границ; значение заменяет предыдущее.

### `StreamOptions`

*Стабильность: public.*

```ts
interface StreamOptions extends RenderOptions {
  readonly chunkSize?: number;
  readonly onHead?: (head: string, info: HeadStreamInfo) => void;
  readonly onShell?: (html: string) => void;
  readonly onChunk?: (chunk: string) => void;
  readonly nonce?: string;
  readonly signal?: AbortSignal;
}
```

- `chunkSize` — максимальный размер чанка, по умолчанию 16 KiB; неположительные значения заменяются умолчанием. Патчи также режутся по лимиту.
- `onHead` — head синхронного shell до первого чанка тела; повторный вызов только при изменении (`info.final === true`).
- `onShell` — синхронный shell до асинхронных патчей.
- `onChunk` — каждый фактически записанный чанк.
- `nonce` — nonce для inline-runtime и скриптов патчей.
- `signal` — отмена доставки; рендер завершается и освобождает ресурсы, новые чанки не пишутся.
- Остальные поля совпадают с `RenderOptions`.

Ограничения стриминга:

- head, добавленный асинхронной границей, нельзя отправить в HTTP-заголовки: обработайте `info.final` на клиенте;
- патч вставляется через `<template>` и парсится в контексте body: фрагменты, допустимые только внутри таблицы или `select`, требуют собственного контейнера;
- inline-runtime требует разрешённых inline-скриптов или `nonce`; без JS остаётся shell с fallback;
- ошибка после отправки shell закрывает поток ошибкой (соединение обрывается, fallback остаётся видимым);
- backpressure не учитывается: чанки буферизуются, пока читатель их не заберёт;
- поток удерживает внутреннюю очередь SSR до завершения рендера.


## JSX

Типы JSX описывают контракт между компилятором и рантаймом. Ключевое правило: **компонент принимает props обычным параметром, ViewModel приходит через `this`** — тип параметра `this` сообщает компилятору, что перед ним view-компонент, и какая VM с прелоадером ему нужны:

```tsx
import type { ViewContext } from "@ivlev-dev/silent-core";

interface CounterVM {
  count: number;
}

function CounterPreloader() {
  return <span>Загрузка…</span>;
}

export const Counter = (
  this: ViewContext<CounterVM, typeof CounterPreloader>,
  props: { count: number },
) => <span class="count">{this.vm.count}</span>;
```

Компилятор извлекает `vm` и `preloader` из `this`-типа, добавляет метаданные silent.view и value-import нужных значений; в месте использования `<Counter count={3} />` параметр VM не нужен и недоступен. Несоответствия props ловятся типами: отсутствующий или неверно типизированный prop даёт ошибку компиляции.

Props можно деструктурировать без потери реактивности:

```tsx
function Greeting(props: { name: string; suffix?: string }) {
  const { name, suffix = "!" } = props;
  return <b>{name}{suffix}</b>;
}
```

Компилятор заменяет чтения таких переменных на обращения к `props.name`/`props.suffix`, а объявление деструктуризации удаляет. Поддерживаются переименование, значения по умолчанию, вложенная деструктуризация и деструктуризация параметра `({ name }: P)`. Ограничения: работает для `const`-деструктуризации с инициализатором `props`; при переприсваивании имени или `...rest` объявление остаётся обычным снапшотом. Объявления через `let`/`var` компилятор не трансформирует.

Динамические SVG-дети (`For`, `.map()`, компоненты) создаются в SVG-пространстве имён, в том числе при вставке внутрь `<svg>`; компилятор передаёт namespace-хинт, а рантайм дополнительно определяет SVG по корневому тегу. `<style>` и `<script>` поддерживают текстовую интерполяцию через `textContent`: CSS/JS не должен содержать JSX-детей. Клиентский `<script>`, созданный шаблоном, браузер не исполняет; используйте его для данных/JSON-LD или выносите исполняемый JS в модули.

### `JSX`

*Стабильность: public.*

Пространство типов для TSX:

- `JSX.Element = Node` — результат любого JSX-выражения.
- `JSX.ElementType = keyof JSX.IntrinsicElements | ((...args: never[]) => JSX.Element)`.
- `JSX.ElementChildrenAttribute` — показывает TS, где искать `children` в props компонента.
- `JSX.IntrinsicAttributes` — содержит `key?: string | number`; ключ удаляется рантаймом `jsx` перед вызовом компонента.
- `JSX.IntrinsicElements` — таблица встроенных тегов с типизированными props: общие (`class`/`className`, `id`, `style` как строка или объект, `ref`, `children`, `dangerouslySetInnerHTML`, обработчики `onClick`, `onInput`, `onChange`, `onKeyDown`, `onKeyUp`, `onSubmit`, `onFocus`, `onBlur`, `onScroll`, `onPointerDown`, `onPointerMove`, `onPointerUp` и capture-варианты) и специфичные для `a`, `button`, `img`, `input`, `textarea`, `select`, `form`; SVG-теги (`svg`, `path`, `circle`, `rect`, `line`, `g`, `defs`, `linearGradient`, `radialGradient`, `stop`, `use`, `text`, `tspan`, `textPath`, `pattern`, `mask`, `clipPath`, `filter`, `fe*`, `symbol`, `marker`, `foreignObject`) типизированы так же, создаются в SVG-пространстве имён; произвольные теги `[tag: string]` принимают общие props.

Пользовательский код расширяет таблицу (или опирается на fallback) через расширение `JSX.IntrinsicElements`, компилятор при этом не меняется.

### `Child`

*Стабильность: public.*

```ts
type Child =
  | Node
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Iterable<Child>;
```

Допустимый дочерний элемент. `null`, `undefined` и `boolean` при рендере отбрасываются. Массивы, `Set`, генераторы и другие `Iterable<Child>` разворачиваются рекурсивно, поэтому `.map()` в JSX типизируется и рендерится без `For`.

### `Children`

*Стабильность: public.*

```ts
type Children = Child | Child[] | (() => Children);
```

Вложенные массивы, итераторы и функции (реактивные «толкатели») поддерживаются рекурсивно; функции разворачиваются при каждом прогоне эффекта.

### `Component`

*Стабильность: public.*

```ts
type Component<P = Record<string, never>> = (props: P) => JSX.Element;
```

Базовый тип любого компонента. Для синхронных компонентов без VM фактически соответствует `SyncComponent`.

### `ViewContext`

*Стабильность: public.*

```ts
type ViewContext<VM extends object, PreloaderB extends Component<never> = Component<never>> = {
  vm: VM;
  preloader: PreloaderB;
};
```

Хелпер для аннотации `this` view-компонента. Эквивалентен литералу `this: { vm: CounterVM; preloader: typeof CounterPreloader }`. Второй параметр по умолчанию — любой компонент без props.

### `ViewComponent`

*Стабильность: public.*

```ts
type ViewComponent<P, VM extends object, PreloaderB extends Component<never>> = (
  this: ViewContext<VM, PreloaderB>,
  props: P,
) => JSX.Element;
```

Аннотирует уже готовую функцию, если удобно описать её как значение:

```tsx
import type { ViewComponent, ViewContext } from "@ivlev-dev/silent-core";

interface BadgeVM {
  label: string;
}

function BadgeLoader() {
  return <span>Загрузка…</span>;
}

const Badge: ViewComponent<{ suffix: string }, BadgeVM, typeof BadgeLoader> = function (
  this: ViewContext<BadgeVM, typeof BadgeLoader>,
  props: { suffix: string },
) {
  return <b>{this.vm.label}{props.suffix}</b>;
};
```

Во всех записях (литерал `this` или `ViewComponent`) правило то же: props через обычный параметр, VM через `this`.

### `SyncComponent`

*Стабильность: public.*

```ts
type SyncComponent<P> = (props: P) => JSX.Element;
```

Синхронный компонент без ViewModel: прелоадеры, ловушки UI, мелкие листья. Компилятор распознаёт её по отсутствию `this.vm` и не добавляет метаданных.

## Управляющие конструкции

### `For`

*Стабильность: public.*

Keyed-список. Props задаётся объектом; `children` — функция отрисовки одного элемента:

```ts
interface ForProps<T> {
  each: ListSource<T> | (() => ListSource<T>);
  children: (item: T, index: () => number) => Node;
  fallback?: unknown;
  parent?: Node;
  marker?: Node | null;
  index?: boolean;
  staticRows?: boolean;
}

type ListSource<T> = readonly T[] | Iterable<T> | null | undefined;
```

- `each` — массив, `Iterable` (`Set`, генератор, `NodeList`), `null`/`undefined` или реактивный толкатель. Ключом выступает сам элемент (пул держится на `Map`, сравнение — SameValueZero), поэтому для повторных элементов подходят примитивы и стабильные ссылки. `undefined`-элементы отбрасываются одинаково на сервере и клиенте.
- `children` — функция, отрисовывающая один элемент; `index()` ленивый: сигнал номера создаётся только если он читается.
- Реконсиляция: существующие узлы сохраняются, перестановки двигают только элементы вне наибольшей возрастающей подпоследовательности; при неизменном порядке DOM не трогается; повторяющиеся элементы получают отдельные независимые состояния и якоря.
- `fallback` — значение или функция; показывается, когда список пуст; поддерживает реактивное обновление.
- `parent` и `marker` — низкоуровневый режим: строки вставляются прямо в `parent` перед `marker` (или в конец), без промежуточного fragment. Компонент возвращает пустой fragment, его не нужно добавлять в DOM вручную. Это быстрее обычного `For` + `appendChild` (create 1000: ~205 против ~152 ops/s в бенчмарке) и удобно для интеграции со скомпилированными списками.
- `index: false` отключает создание per-row accessor’а индекса. Компилятор ставит его автоматически, если `children` не объявляет второй параметр.
- `staticRows` — внутренний флаг компилятора: строка зависит только от item, поэтому при гидрации не создаются пробы и эффекты, а текст и атрибуты сверяются с серверной разметкой (расхождение даёт обычный mismatch). Для реактивных элементов (`deepReactive`, классы, объекты с accessor-свойствами), строк с `on*` и `Index` режим не включается. Вручную задавать не нужно.
- Dispose: удаление элемента снимает его узлы и запускает зарегистрированные в них `onCleanup`.

```tsx
<ul class="items">
  <For each={this.vm.items}>
    {(item: { name: string }) => <li>{item.name}</li>}
  </For>
</ul>
```

### `Show`

*Стабильность: public.*

```tsx
<Show when={this.vm.ready} fallback={<b>no</b>}>yes</Show>
```

Props: `when` (значение или функция), `fallback`, `children`. «Правда» — всё, кроме `null`, `undefined`, `false`, `0` и `""`. Активная ветка рендерится как children, иначе как fallback; функции разворачиваются. Пока `when` остаётся истинным, DOM-узлы ветки сохраняются: изменение значения внутри истинного условия, а также несвязанных сигналов не пересоздаёт формы и не сбрасывает фокус. Пересоздание происходит при смене истинности или выбранной ветки.

### `Index`

*Стабильность: public.*

Неключевой список: узлы закреплены за позициями, а не за значениями.

```ts
interface IndexProps<T> {
  each: ListSource<T> | (() => ListSource<T>);
  children: (item: () => T, index: () => number) => Node;
  fallback?: unknown;
  parent?: Node;
  marker?: Node | null;
}
```

- `children` получает accessor элемента: при изменении массива сигнал обновляется, а реактивные биндинги внутри узла меняются точечно; сам узел не пересоздаётся.
- Позиции не переставляются: при смене порядка значений обновляются значения на местах.
- Добавление и удаление затрагивает только хвост списка.
- `fallback` — значение или функция; показывается при пустом массиве.
- `parent` и `marker` — low-level режим прямой вставки строк без wrapper-fragment; `Index` возвращает пустой fragment, добавлять его в DOM не нужно.
- `index: false` не создаёт per-row accessor индекса; компилятор включает это автоматически, если `children` не использует второй аргумент.

```tsx
<ul class="items">
  <Index each={this.vm.items}>
    {(item) => <li>{item()}</li>}
  </Index>
</ul>
```

### `IndexProps`

См. сигнатуру выше: `each`, `children` (accessor элемента и accessor индекса), необязательные `fallback`, `parent`/`marker`.

### `Switch`

*Стабильность: public.*

Выбирает первую правдивую ветку `Match`; если такой нет — `fallback`.

```tsx
<Switch fallback={<span>нет данных</span>}>
  <Match when={this.vm.status === "error"}><ErrorView /></Match>
  <Match when={this.vm.status === "loading"}><Spinner /></Match>
  <Match when={this.vm.data}><Content /></Match>
</Switch>
```

Ветка пересчитывается реактивно: при изменении условий содержимое заменяется. `fallback` необязателен.

### `Match`

*Стабильность: public.*

Ветка `Switch`: `when` — значение или функция, `children` — содержимое ветки. `Match` не создаёт DOM-содержимого: он возвращает служебный узел с условием и детьми, который `Switch` снимает при выборе. Использовать `Match` вне `Switch` нельзя.

### `SwitchProps`

`{ fallback?: unknown; children: unknown | (() => unknown) }` — дети описывают ветки `Match`.

### `MatchProps`

`{ when: unknown | (() => unknown); children?: unknown }`.

### `ErrorBoundary`

*Стабильность: public.*

Ловит синхронные ошибки рендера детей и асинхронные ошибки дочерних view, приходящие через `onError`.

```tsx
<ErrorBoundary
  fallback={(error, reset) => (
    <div>
      <p>{String(error)}</p>
      <button onClick={reset}>Повторить</button>
    </div>
  )}
>
  <Profile />
</ErrorBoundary>
```

- `fallback(error, reset)` — ветка ошибки; `reset()` снова рендерит `children`.
- После ошибки `children` не перерисовываются, пока не вызван `reset`.
- Ошибки в обработчиках событий и в эффектах, созданных вне границы, не перехватываются.

### `ErrorBoundaryProps`

`{ fallback: (error: unknown, reset: () => void) => unknown; children: unknown | (() => unknown) }`.

### `Suspense`

*Стабильность: public.*

```tsx
<Suspense fallback={<span>Загрузка…</span>}>
  <Profile id={1} />
</Suspense>
```

Props описывает `SuspenseProps` (см. ниже). Семантика:

1. Устанавливает границу асинхронности: показывается `fallback` (или пустой якорь, если он не задан).
2. Дочерние view регистрируют свои `ready`-промисы в границе — прелоадеры вложенных view внутри `Suspense` не рендерятся.
3. Когда все зарегистрированные промисы завершены, переключается на детей за один рендер.
4. Вложенный `Suspense` регистрируется в родителе: родитель ждёт и его вложенные промисы (fallback виден, пока дети внутреннего не готовы).
5. В момент dispose граница снимается, содержимое очищается; `onCleanup` зарегистрирован автоматически.

Граница асинхронности внутри `Suspense` действует и на `createComponent`, вызванный напрямую, — всё, что внутри, обязано зарегистрировать промисы готовности, иначе переключение произойдёт раньше. В прикладном коде используйте для этого `Suspense`, а не ручное управление границей.

### `SuspenseProps`

*Стабильность: public.*

```ts
interface SuspenseProps {
  readonly fallback?: unknown;
  readonly children: unknown;
}
```

`fallback` — значение или толкатель; тип поля — `unknown`; `children` — содержимое (значение или функция).

### `lazy`

*Стабильность: public.*

```ts
function lazy<P extends Record<string, unknown>>(
  loader: () => Promise<AnyComponent | { default: AnyComponent }>,
  options?: LazyOptions,
): (props: P) => Node;
```

Отложенная загрузка модуля компонента:

- Модуль грузится один раз на обёртку; принимается и функция-компонент, и `{ default }`-экспорт.
- До загрузки: пока охватывающая `Suspense`-граница ещё показывает fallback, собственный прелоадер не рендерится; если граница уже показывает содержимое (повторный переход), рендерятся `options.preloader`, затем `fallback`-функция границы; без границы — `options.preloader`, глобальный `setDefaultPreloader` или пустой якорь.
- Готовность: промис загрузки прикрепляется к якорю через `setReady`, поэтому `getReady(anchor)` и, соответственно, `mount().ready` учитывают ожидание; промис также регистрируется в `Suspense`-границе.
- После загрузки компонент рендерится со своими `props` через `component`.
- Ошибка загрузки: `options.onError` или глобальный `getErrorHandler`; в DOM вместо контента вставляется текст `Error: <message>`. Ошибка сбрасывает состояние загрузки, поэтому при следующем монтировании `lazy` снова вызывает loader (retry).

```tsx
import { lazy, Suspense } from "@ivlev-dev/silent-core";

const Profile = lazy<{ id: number }>(() => import("./profile"));

export function App() {
  return (
    <Suspense fallback={<span>Загрузка…</span>}>
      <Profile id={1} />
    </Suspense>
  );
}
```

### `LazyOptions`

*Стабильность: public.*

```ts
interface LazyOptions {
  readonly preloader?: Preloader | null | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
}
```

- `preloader` — прелоадер, показываемый вне `Suspense` до загрузки модуля; `null` явно отключает глобальный.
- `onError` — локальный обработчик ошибки загрузки; без него используется глобальный обработчик.

## Прикладные примитивы

Экспортируемые примитивы: `Context`, `createContext`, `captureContextValues`, `adoptContextValues`, `ContextMissingError`, `ContextOptions`, `BoundContext`, `Provider`, `ProviderProps`, `ProviderChildren`, `createId`, `useId`, `resetIds`, `currentIdCount`, `withIdScope`, `IdGenerator`, `IdSequence`, `createIdGenerator`, `Portal`, `Teleport`, `PORTAL_MARKER`, `PortalProps`, `PortalTarget`, `Transition`, `Presence`, `TRANSITION_MARKER`, `TransitionProps`, `Resource`, `createResource`, `ResourceCache`, `createResourceCache`, `clearResourceCache`, `sharedResourceCache`, `ResourceStatus`, `ResourceFetchContext`, `ResourceFetcher`, `ResourceOptions`, `Head`, `HeadProps`, `HeadMetaProps`, `HeadLinkProps`, `HeadStyleProps`, `HeadValue`, `ForProps`, `Keyed`, `mapKeyed`, `KeyedProps`, `KeyedRender`, `KeySelector`, `bindValue`, `bindChecked`, `bindSource`, `BindAccessor`, `BindSetter`.

### Context и Provider

```ts
class Context<T> {
  constructor(options?: ContextOptions<T>);
  readonly name: string;
  get(): T;
  tryGet(): T | undefined;
  has(): boolean;
  provide<R>(value: T, fn: () => R): R;
  bind(): BoundContext<T>;
}

function createContext<T>(options?: ContextOptions<T>): Context<T>;
function Provider<T>(props: ProviderProps<T>): Node;
function captureContextValues(): Map<object, unknown> | null;
function adoptContextValues(owner: Owner, values: Map<object, unknown>): void;
```

`ContextOptions` содержит `defaultValue` и `name`; при отсутствии провайдера и default `get()` бросает `ContextMissingError`. `Provider` — обычный компонент без VM; для вычисляемых детей используйте `children`-функцию. `BoundContext` — снимок значения для кода после `await`. `ProviderProps`/`ProviderChildren` описывают props/детей провайдера.

### Идентификаторы

```ts
function createId(prefix?: string): string;
function useId(prefix?: string): string;
function resetIds(): void;
function currentIdCount(): number;
function withIdScope<T>(fn: () => T): T;
class IdSequence implements IdGenerator {
  readonly count: number;
  next(prefix?: string): string;
  reset(): void;
}
function createIdGenerator(prefix?: string): IdSequence;
```

`useId` — плоская функция, не React-hook. `resetIds` вызывается серверным рендером и гидрацией; для детерминированных SSR/CSR id храните id в VM, если view перерисовывается.

### Portal и Teleport

```ts
function Portal(props: PortalProps): Node;
const Teleport = Portal;
type PortalTarget = Element | string | (() => Element | null);
const PORTAL_MARKER = "silent-portal";
```

`PortalProps`: `target`, `children`. `Portal` переносит DOM в target, поддерживает reactive target и вложенные порталы. SSR отдаёт только маркер `PORTAL_MARKER` (client-only контент); при гидрации маркер адоптируется, при отсутствии — `HydrationMismatchError`.

### Transition и Presence

```ts
function Transition(props: TransitionProps): Node;
const Presence = Transition;
const TRANSITION_MARKER = "silent-transition";
```

`TransitionProps`: `show`/`when`, `children`, `enterClass`, `leaveClass`, `duration`, `fallback`, `unmount`. Для leave-анимации DOM сохраняется до окончания `duration`; `unmount: false` оставляет узел после анимации. SSR рендерит актуальную ветку и `TRANSITION_MARKER`.

### Resource

```ts
function createResource<T, K = unknown>(
  fetcher: ResourceFetcher<T>,
  options?: ResourceOptions<T, K>,
): Resource<T>;
class ResourceCache { /* get/set/has/delete/clear, in-flight dedupe */ }
function createResourceCache(): ResourceCache;
function clearResourceCache(cache?: ResourceCache): void;
const sharedResourceCache: ResourceCache;
type ResourceStatus = "idle" | "pending" | "success" | "error";
```

`Resource` даёт accessors `data`, `error`, `pending`, `status`, `key`, промис `ready`, методы `read`, `refetch`, `set`, `mutate`, `abort`, `dispose`. `ResourceFetchContext` содержит `signal` и `key`. `ResourceFetcher` возвращает значение или Promise. `ResourceOptions` включает key/cache/cacheTime/dedupe/immediate/throwOnError/onError/boundary/signal/disposeOnCleanup.

### Head

```ts
function Head(props: HeadProps): Node;
```

`HeadProps` принимает `title`, `meta`, `link`, `style` и `children`; `HeadMetaProps`, `HeadLinkProps`, `HeadStyleProps`, `HeadValue` описывают значения (значение или accessor). Head дедуплицирует теги, поддерживает стек title при unmount, SSR-head и гидрацию без дублей.

### Keyed-списки

```ts
interface ForProps<T> {
  each: ListSource<T> | (() => ListSource<T>);
  keyOf?: KeySelector<T>;
  children: (item: T, index: () => number) => Node;
  fallback?: unknown;
  parent?: Node;
  marker?: Node | null;
}

function Keyed<T>(props: KeyedProps<T>): Node;
function mapKeyed<T>(each, keyOf: KeySelector<T>, children: KeyedRender<T>): Node;
```

`KeySelector<T>` возвращает ключ, `KeyedRender<T>` — render-функцию, `KeyedProps<T>` — props компонентной формы. При `keyOf` `For` матчит строки по ключу, сохраняя DOM и фокус при новых объектах с тем же id.

### Controlled bindings

```ts
function bindValue(el: Element, accessor: BindAccessor, setter?: BindSetter): void;
function bindChecked(el: Element, accessor: BindAccessor, setter?: BindSetter): void;
function bindSource(value: unknown): { get: BindAccessor; set?: BindSetter };
```

`BindAccessor` — accessor значения, `BindSetter` — setter. Компилятор поддерживает `bindValue={...}`/`bindChecked={...}` на `input`/`textarea`/`select`; поддерживаются IME/composition, каретка, deferred options, checkbox/radio/indeterminate, `defaultValue`, `form.reset`, multiple select.

### Классы и стили

```ts
type ClassNameValue = string | number | bigint | boolean | null | undefined
  | readonly ClassNameValue[] | ClassDictionary | (() => ClassNameValue);
type ClassDictionary = { readonly [name: string]: ClassNameValue };
type StyleInput = string | StyleObject | readonly StyleInput[] | null | undefined | false;
type StyleObject = { readonly [property: string]: StylePrimitive };
type StylePrimitive = string | number | boolean | null | undefined;

function classNames(...values: readonly ClassNameValue[]): string;
function normalizeClass(value: ClassNameValue): string;
function styleDeclarations(value: StyleInput): Map<string, string>;
function normalizeStyle(...values: readonly StyleInput[]): string;
const styleValue = normalizeStyle;
```

Типы: `ClassDictionary`, `ClassNameValue`, `StylePrimitive`, `StyleObject`, `StyleInput`; функции: `classNames`, `normalizeClass`, `styleDeclarations`, `normalizeStyle`, `styleValue`. `class`/`className` принимают строку, массив, объект условий и вложенные функции. `normalizeStyle` объединяет объекты/строки, добавляет `px` для размерных числовых свойств, сохраняет CSS custom properties и unitless-свойства.

### Обновление props

```ts
type PropsUpdater = (props: Record<string, unknown>) => void;
function registerPropsUpdater(node: Node | null | undefined, updater: PropsUpdater): void;
function getPropsUpdater(node: Node): PropsUpdater | null;
function updateProps(node: Node, props: Record<string, unknown>): boolean;
```

`PropsUpdater`, `registerPropsUpdater` и `getPropsUpdater` обслуживают реестр обновлений; `updateProps` обновляет props существующего view/light-компонента без пересоздания DOM; `MountHandle`/`ComponentResult` также предоставляют `updateProps`. Возвращает `false`, если для узла нет зарегистрированного updater-а.

## DOM-примитивы JSX-рантайма

Перечисленные функции — контракт, на который опирается вывод компилятора (`template`-клоны, холы, вставки). В прикладном коде они, как правило, напрямую не используются; все помечены как `Стабильность: internal`.

Всюду, где аргумент описан как `accessor: () => unknown`, принимается реактивный толкатель: значение пересчитывается через render-эффект, и при изменении представление обновляется.

### `template`

*Стабильность: internal.*

```ts
function template(html: string): () => Node;
```

Строит `HTMLTemplateElement` из HTML-строки, кеширует его по строке и возвращает функцию клонирования: один корень — клон элемента; несколько — фрагмент из клонов; пустой шаблон — пустой фрагмент. Клоны изолированы: изменения в одном экземпляре не затрагивают другие.

### `templateHoles`

*Стабильность: internal.*

```ts
function templateHoles(
  html: string,
  plan?: TemplatePlan | false,
  namespace?: "svg",
): () => TemplateClone;
```

Как `template`, но дополнительно находит точки вставки «холов»: комментарии вида `silent-hole-<N>` (порядковый индекс до первого пропуска) и элементы с атрибутами `data-silent-a-<N>` (атрибуты после чтения удаляются — в серверном режиме, включённом `setServerMode`, они сохраняются).

`plan` — план адоптации компилятора; `false` означает, что у шаблона гарантированно нет дыр и атрибутов-маркеров (компилятор эмитит его при `hydrate: false`), поэтому дерево не обходится. `namespace: "svg"` парсит HTML внутри `<svg>`, чтобы корневые `path`/`circle`/`g` получили SVG-пространство имён. Без явного значения SVG определяется по первому корневому тегу; это покрывает динамических детей `For`, `.map()` и компонентов.

### `setServerMode`

*Стабильность: internal.*

```ts
function setServerMode(enabled: boolean): void;
```

Глобальный переключатель серверного режима DOM-примитивов (по умолчанию выключен). Сегодня влияет на `templateHoles`: при включённом режиме служебные атрибуты-маркеры не удаляются с клонов, что сохраняет разметку в целостности для строкового рендера.

### `isServerMode`

*Стабильность: internal.*

```ts
function isServerMode(): boolean;
```

Возвращает текущее значение серверного режима, заданное `setServerMode`.

### `TemplateClone`

*Стабильность: internal.*

```ts
interface TemplateClone {
  readonly node: Node;
  readonly holes: readonly Comment[];
  readonly attrs: readonly Element[];
}
```

`node` — корень (единственный узел или фрагмент контента), `holes` — комментарии-заполнители для динамического контента, `attrs` — элементы с динамическими атрибутами.

### `insert`

*Стабильность: internal.*

```ts
function insert(parent: Node, accessor: () => unknown, marker?: Node): void;
```

Создаёт mount-point внутри `parent` (перед `marker`, если задан) и рендерит в него результат `accessor`. Значения: `Node`, строка, число, `bigint`, массив, вложенные функции, `null`/`undefined`/`boolean`. Строковые и численные значения переиспользуют один текстовый узел (обновляется только `data`); узлы, массивы и функции меняются заменой набора, старые узлы освобождаются.

### `text`

*Стабильность: internal.*

```ts
function text(node: Text, accessor: () => unknown): void;
```

Обновляет `Text.data` значением `accessor` (строковое представление: `null`/`undefined`/`boolean` → пустая строка), только если оно изменилось.

### `classNames`

*Стабильность: public.*

```ts
function classNames(...values: readonly ClassNameValue[]): string;
function normalizeClass(value: ClassNameValue): string;

type ClassNameValue =
  | string | number | bigint | boolean | null | undefined
  | readonly ClassNameValue[]
  | ClassDictionary
  | (() => ClassNameValue);

interface ClassDictionary {
  readonly [name: string]: ClassNameValue;
}
```

Рекурсивно собирает имена классов из строк, массивов и объектов `{ name: boolean }`, удаляет пустые значения и дубликаты. `classNames` объединяет несколько значений; `normalizeClass` нормализует одно. Публичные типы: `ClassDictionary`, `ClassNameValue`. Те же правила применяются к `class`/`className` в `attr`, `spread` и `applyProps`: обновление и удаление значений не затирает независимые class-привязки на одном элементе.

### `attr`

*Стабильность: internal.*

```ts
function attr(el: Element, name: string, accessor: () => unknown): void;
```

Реактивная установка атрибута. Особые значения:

- `class`/`className` — строка, массив или объект (`classNames`/`normalizeClass`); `null`/`undefined`/`false`/`""` удаляют вклад этой привязки.
- `style` — строка, объект, массив или `null` (см. `style`).
- `value`, `checked`, `selected`, `disabled` — записываются как свойства DOM-элемента (не как атрибуты), кроме SVG-элементов, где остаётся атрибут.
- `null`, `undefined`, `false` — атрибут удаляется; `true` — ставится пустым значением для булевых атрибутов (`hidden`, `required`, `novalidate` и т.д.) и `"true"` иначе; прочие — `String(value)`.

SVG-элементы определяются автоматически по конструированию в SVG-пространстве имён.

### `prop`

*Стабильность: internal.*

```ts
function prop(el: Element, name: string, accessor: () => unknown): void;
```

Реактивная запись свойства напрямую: `(el as unknown as Record<string, unknown>)[name] = value`; сравнение с предыдущим значением, чтобы не трогать без изменений.

### `innerHtml`

*Стабильность: internal.*

```ts
function innerHtml(el: Element, accessor: () => unknown): void;
```

Реактивно записывает HTML-содержимое элемента: на клиенте освобождает прежних детей и устанавливает `el.innerHTML`, на сервере пишет raw HTML в контентную дыру шаблона. На сервере шаблон должен быть создан компилятором с `dangerouslySetInnerHTML` или содержать контентную дыру `data-silent-text`.

### `style`

*Стабильность: public (хелпер) / internal (привязка).*

```ts
function style(el: Element, accessor: () => unknown): void;
function style(...values: readonly StyleInput[]): string;

function normalizeStyle(...values: readonly StyleInput[]): string;
const styleValue: typeof normalizeStyle;

type StyleInput = string | StyleObject | readonly StyleInput[] | null | undefined | false;

interface StyleObject {
  readonly [property: string]: StylePrimitive;
}

type StylePrimitive = string | number | boolean | null | undefined;
```

Реактивная установка стиля с диффом небольших правок. Снимок принадлежит конкретной привязке, поэтому несколько независимых `style`/`spread` на одном элементе не затирают друг друга:

- `null`/`undefined` — сброс свойств этой привязки.
- Строка — CSS-декларации; при обновлении сверяются ключи со снепшотом привязки.
- Объект — свойства в kebab-case (`hyphen`); `null`/`undefined`/`false`/`""` удаляют свойство; ушедшие из объекта — тоже.
- Числа получают `px` для размерных свойств; `opacity`, `z-index`, `line-height`, `flex`, `font-weight`, `order` и другие unitless-свойства пишутся как есть. Значения CSS custom properties (`--name`) не получают `px`.
- Массивы нескольких объектов/строк сливаются слева направо; `normalizeStyle`/`styleValue`/вызов `style(...values)` без элемента возвращают итоговую CSS-строку. Публичные типы: `StyleInput`, `StyleObject`, `StylePrimitive`.

### `spread`

*Стабильность: internal.*

```ts
function spread(el: Element, accessor: () => unknown): void;
```

Реактивный спред объекта props на элемент: классы, стили, атрибуты, `ref` (функция ref освобождается вызовом с `null` при смене ключа и cleanup-ветвлениях), события (`on:`-имена, `onXxx`, `onXxxCapture`), свойства, булевы атрибуты. Ключи `children` и `key` игнорируются. Атрибуты, пропавшие из нового объекта, удаляются; `null`/`undefined` снимает ранее установленные значения. На SSR события и `innerHTML` фильтруются, динамические `class`/`style` заменяют статические, а не дублируют их.

### `on`

*Стабильность: internal.*

```ts
function on(el: Element, name: string, accessor: () => unknown): void;
```

Регистрирует обработчик события: имя разбирается из `on:<event>`, `on<event>` или `on<event>Capture` (capture-фаза). Слушатель навешивается один раз; меняется только текущая функция-обработчик (оберточная функция читает актуальное значение). Значение, не являющееся функцией (в том числе `null`), отключает реакцию.

### `ref`

*Стабильность: internal.*

```ts
function ref(el: Element, accessor: () => unknown): void;
```

Реактивный ref: колбэк `(node: Element | null) => void` вызывается с элементом при установке и с `null` при смене/удалении (cleanup). Значения, не являющиеся функцией, игнорируются.

### `effect`

*Стабильность: internal.*

```ts
function effect(fn: () => void): void;
```

Обертка над `createRenderEffect`: первый запуск синхронный, последующие — в общем flush. Для прикладного кода предпочтительно использовать `createEffect` / `createRenderEffect` напрямую из `@ivlev-dev/silent-reactivity`.

### `fragment`

*Стабильность: internal.*

```ts
function fragment(accessor: () => unknown): Node;
```

Реактивный динамический фрагмент с якорным комментарием `<!--silent-fragment-->`; содержимое меняется через mount-point.

### `dynamic`

*Стабильность: internal.*

```ts
function dynamic(tag: () => string, props: Record<string, unknown>): Node;
```

Создаёт элемент по вычисленному имени тега и применяет `props` через `applyProps`. Реактивность здесь не поддерживается: тег фиксируется один раз при конструкции.

### `createElement`

*Стабильность: internal.*

```ts
function createElement(tag: string): Element;
```

Создаёт элемент в SVG-пространстве имён для списка известных SVG-тегов (`svg`, `path`, `circle`, `rect`, `line`, `g`, `defs`, `linearGradient`, `stop`, `use`, `tspan`), иначе — в HTML.

### `applyProps`

*Стабильность: internal.*

```ts
function applyProps(el: Element, props: Record<string, unknown> | undefined): void;
```

Статичное применение props при построении jsx-элемента: значения-функции трактуются как реактивные толкатели (`attr`/`style`), события регистрируются через `on`, `ref` вызывается немедленно (и автоматически на cleanup), `children`-функция — через `insert`, массив детей добавляется напрямую. Ключи `children` и `key` выделяются особо: `key` отбрасывается.

### `createMountPoint`

*Стабильность: internal.*

```ts
function createMountPoint(parent: Node, marker: Node | null): MountPoint;
```

Создает mount-point, отслеживающий содержимое до `marker` (или в конец `parent`). Управление:

```ts
const mount = createMountPoint(parent, anchor);
mount.render(value);
mount.clear();
mount.nodes();
```

- `render(value)` — меняет содержимое; строковые/численные значения переиспользуют один текстовый узел; изменение лишь при фактической смене значения.
- `clear()` — dispose и снятие текущих узлов.
- `nodes()` — текущий набор узлов.

Используется строителями `For`, `Show`, `Suspense`, `fragment`, `insert`.

### `collectNodes`

*Стабильность: internal.*

```ts
function collectNodes(value: Children | Iterable<Child>): Node[];
```

Нормализует `Children` в плоский список узлов: разворачивает функции, массивы и произвольные `Iterable` (`Set`, генераторы, `NodeList`), выбрасывает `null`/`undefined`/boolean, разбивает `DocumentFragment` на потомков, конвертирует строки и числа в текстовые узлы. DOM-узлы не трактуются как итераторы.

### `disposeNode`

*Стабильность: internal.*

```ts
function disposeNode(node: Node): void;
```

Запускает dispose узла:

- если узлу присоединён dispose-обработчик (`NODE_DISPOSER`), вызывается только он;
- иначе рекурсивно обходит потомков элемента и фрагмента;
- текст и прочие узлы без потомков не требуют действий.

### `attachDisposer`

*Стабильность: internal.*

```ts
function attachDisposer(node: Node, dispose: () => void): void;
```

Прикрепляет функцию dispose к узлу под символом `NODE_DISPOSER`. `disposeNode` и внутренние процессы рантайма вызовут её при снятии узла.

### `MountPoint`

*Стабильность: internal.*

```ts
interface MountPoint {
  render(value: unknown): void;
  clear(): void;
  nodes(): readonly Node[];
}
```

Тип mount-point (см. `createMountPoint`): дискретная вставка/смена содержимого с диффом и dispose.

### `NODE_DISPOSER`

*Стабильность: internal.*

```ts
const NODE_DISPOSER: unique symbol;
```

Символ `Symbol("silent.disposer")` — ключ dispose-обработчика на узле. В отличие от символов метаданных, создан без `Symbol.for`, то есть уникален для рантайма.

## Символы метаданных

Все символы создаются через `Symbol.for`, поэтому одинаковы между entry-точками и компилятором. Функции компонента и узлы уже несут эти ключи; напрямую их следует трогать только интеграциями (плагин, тесты).

### `VIEW_META`

*Стабильность: internal.*

```ts
const VIEW_META: unique symbol; // Symbol.for("silent.view")
```

Ключ метаданных view-компонента (`{ vm, preloader?, preloaderName?, name?, moduleId? }`). Компилятор присваивает его функции; рантайм читает через `getViewMeta`. Рендер вручную функции с этими метаданными без плагина бесполезен — jsx-рантайм бросает ошибку «Компонент использует метаданные silent.view…».

### `PRELOADER`

*Стабильность: internal.*

```ts
const PRELOADER: unique symbol; // Symbol.for("silent.preloader")
```

Ключ прелоадера, прикрепляемого `setPreloader` / `setFallback` к функции компонента. Приоритет: метаданные (`preloader` из `VIEW_META`) → этот ключ → static-поле `preloader`/`fallback` VM → глобальный.

### `COMPONENT_READY`

*Стабильность: internal.*

```ts
const COMPONENT_READY: unique symbol; // Symbol.for("silent.ready")
```

Ключ промиса готовности на узле. Рантайм устанавливает его для view-компонентов и `lazy`; `getReady` читает его, а `whenIdle` учитывает такие промисы в ожидании.

### `COMPONENT_DISPOSE`

*Стабильность: internal.*

```ts
const COMPONENT_DISPOSE: unique symbol; // Symbol.for("silent.dispose")
```

Ключ функции dispose на стартовом комментарий-маркере view-компонента (`<!--silent-view-->`). Позволяет интеграциям демонтировать компонент, не имея `ComponentResult`.

## Server streaming

Низкоуровневый интерфейс сбора прогрессивных регионов SSR. Серверный рендерер регистрирует коллектор через `setServerStreamCollector`; view и `Suspense` открывают регионы через `openServerStreamRegion` и закрывают их вызовом `resolve()`.

### `STREAM_REGION_START`

```ts
const STREAM_REGION_START = "silent-stream:";
```

Префикс комментария-маркера начала стримингового региона.

### `STREAM_REGION_END`

```ts
const STREAM_REGION_END = "silent-stream-end:";
```

Префикс комментария-маркера конца стримингового региона.

### `ServerStreamRegion`

```ts
interface ServerStreamRegion {
  readonly id: number;
  readonly start: Comment;
  readonly end: Comment;
  resolve(): void;
}
```

Открытый регион: маркеры границ и функция завершения.

### `ServerStreamCollector`

```ts
interface ServerStreamCollector {
  openRegion(): ServerStreamRegion | null;
}
```

Коллектор регионов, который предоставляет серверный рендерер.

### `setServerStreamCollector`

```ts
function setServerStreamCollector(next: ServerStreamCollector | null): void;
```

Устанавливает или сбрасывает (`null`) глобальный коллектор регионов.

### `getServerStreamCollector`

```ts
function getServerStreamCollector(): ServerStreamCollector | null;
```

Возвращает текущий коллектор или `null`.

### `openServerStreamRegion`

```ts
function openServerStreamRegion(): ServerStreamRegion | null;
```

Открывает регион через текущий коллектор. Возвращает `null`, если коллектор не установлен или рендер не потоковый.

## DevTools

Публичный снимок рантайма и поток событий для инструментов разработки. Модуль доступен из основного entry и как сабпуть `@ivlev-dev/silent-core/devtools`. В production установка не создаёт глобальных объектов и не буферизует события: проверяется `globalThis.__SILENT_DEV__`, `import.meta.env.PROD` и `process.env.NODE_ENV`.

### `getDevtoolsSnapshot`

```ts
function getDevtoolsSnapshot(): DevtoolsSnapshot;
```

Возвращает снимок текущего состояния: активные view-инстансы, количество незавершённых async-задач, дерево DI-контейнеров, состояние гидрации, счётчики реестра, подписчиков и реактивности. В снимок попадают только примитивы и имена — ссылки на компоненты, ViewModel, props и DOM-узлы не удерживаются.

```ts
import { getDevtoolsSnapshot } from "@ivlev-dev/silent-core/devtools";

const snapshot = getDevtoolsSnapshot();
console.log(snapshot.views, snapshot.pending.async, snapshot.di.scopes);
```

### `subscribeDevtools`

```ts
function subscribeDevtools(listener: DevtoolsSubscriber): () => void;
```

Подписывает слушатель на события `mount`, `unmount`, `error`, `hmr`, `navigate` и `resolve`. Возвращает идемпотентную функцию отписки. Исключение слушателя не прерывает рантайм и выводится через `console.error`. Подписка без установки DevTools разрешена; буфер очищается после отписки последнего слушателя. При `installDevtools()` подключается DI-инспектор, при `uninstallDevtools()` снимается.

```ts
const unsubscribe = subscribeDevtools((event) => {
  if (event.type === "resolve") console.log(event.token, event.container, event.cached);
});
unsubscribe();
```

### `installDevtools`

```ts
function installDevtools(options?: DevtoolsInstallOptions): DevtoolsHandle;
```

Устанавливает `globalThis.__SILENT_DEVTOOLS__` с методами `snapshot`, `subscribe`, `events`, `clear` и `uninstall`. При установке подключается DI-инспектор, публикующий события `resolve`; `uninstallDevtools()` снимает его. Повторный вызов возвращает handle уже установленного объекта. `enabled: false` или production-режим возвращают no-op handle без побочных эффектов. `eventLimit` ограничивает буфер (1–1000 событий, по умолчанию `DEVTOOLS_EVENT_LIMIT`).

```ts
import { installDevtools } from "@ivlev-dev/silent-core/devtools";

const devtools = installDevtools({ eventLimit: 50 });
globalThis.__SILENT_DEVTOOLS__?.snapshot();
```

### `uninstallDevtools`

```ts
function uninstallDevtools(): void;
```

Удаляет `globalThis.__SILENT_DEVTOOLS__`, отписывает всех слушателей, очищает буфер и сбрасывает счётчики. Вызов без установки безопасен.

```ts
uninstallDevtools();
```

### `getDevtoolsEvents`

```ts
function getDevtoolsEvents(): readonly DevtoolsEvent[];
```

Возвращает текущий буфер событий (не более лимита). Буфер пополняется только при установленном DevTools или наличии подписчиков.

### `devtoolsNavigate`

```ts
function devtoolsNavigate(to: string, from?: string | null): void;
```

Публикует событие `navigate`. Router не изменяется: интеграция может вызывать помощник самостоятельно.

```ts
devtoolsNavigate("/users/42", "/users");
```

### `isDevtoolsProduction`

```ts
function isDevtoolsProduction(): boolean;
```

Возвращает `true`, если рантайм считается production-средой. Явный `globalThis.__SILENT_DEV__` имеет приоритет над `import.meta.env` и `NODE_ENV`.

### `DEVTOOLS_EVENT_LIMIT`

```ts
const DEVTOOLS_EVENT_LIMIT = 100;
```

Лимит буфера событий по умолчанию.

### `DevtoolsSnapshot`

```ts
interface DevtoolsSnapshot {
  readonly installed: boolean;
  readonly production: boolean;
  readonly timestamp: number;
  readonly views: readonly DevtoolsViewInfo[];
  readonly pending: DevtoolsPendingSnapshot;
  readonly di: ContainerSnapshot;
  readonly hydration: DevtoolsHydrationSnapshot;
  readonly registry: DevtoolsRegistrySnapshot;
  readonly listeners: DevtoolsEventStats;
  readonly reactivity: ReactivityStats;
}
```

Корневой снимок. `di` описывает `Container.snapshot()` корневого контейнера; `reactivity` — счётчики из `getReactivityStats()`.

### `DevtoolsViewInfo`

```ts
interface DevtoolsViewInfo {
  readonly id: number | null;
  readonly moduleId: string;
  readonly name: string;
  readonly hydrated: boolean;
}
```

Краткое описание view-инстанса без ссылок на компонент, VM и props.

### `DevtoolsPendingSnapshot`

```ts
interface DevtoolsPendingSnapshot {
  readonly async: number;
}
```

Количество промисов, отслеживаемых `trackAsyncWork` / `trackPending`.

### `DevtoolsHydrationSnapshot`

```ts
interface DevtoolsHydrationSnapshot {
  readonly active: boolean;
  readonly depth: number;
  readonly windows: number;
  readonly sessions: number;
  readonly mismatches: number;
}
```

Состояние гидрации: активность, глубина вложенных контекстов, окна текущего контекста, число сессий и несовпадений.

### `DevtoolsRegistrySnapshot`

```ts
interface DevtoolsRegistrySnapshot {
  readonly modules: number;
  readonly views: number;
}
```

Количество модулей и активных view в HMR-реестре.

### `DevtoolsEventStats`

```ts
interface DevtoolsEventStats {
  readonly active: boolean;
  readonly installed: boolean;
  readonly subscribers: number;
  readonly buffered: number;
  readonly capacity: number;
  readonly emitted: number;
  readonly dropped: number;
  readonly mounts: number;
  readonly unmounts: number;
  readonly errors: number;
  readonly hmr: number;
  readonly navigations: number;
  readonly resolutions: number;
}
```

Счётчики шины событий. `dropped` увеличивается при вытеснении событий из ограниченного буфера. `resolutions` — число событий `resolve`.

### `DevtoolsEvent`

```ts
type DevtoolsEvent =
  | DevtoolsMountEvent
  | DevtoolsUnmountEvent
  | DevtoolsErrorEvent
  | DevtoolsHmrEvent
  | DevtoolsNavigateEvent
  | DevtoolsResolveEvent;
```

Объединение всех событий. Каждое событие содержит `type`, `sequence` и `timestamp`.

### `DevtoolsEventBase`

```ts
interface DevtoolsEventBase {
  readonly type: DevtoolsEventType;
  readonly sequence: number;
  readonly timestamp: number;
}
```

Общие поля события.

### `DevtoolsEventType`

```ts
type DevtoolsEventType = "mount" | "unmount" | "error" | "hmr" | "navigate" | "resolve";
```

Тип события.

### `DevtoolsMountEvent`

```ts
interface DevtoolsMountEvent extends DevtoolsEventBase {
  readonly type: "mount";
  readonly viewId: number;
  readonly name: string;
  readonly moduleId: string | null;
  readonly hydrated: boolean;
  readonly props: readonly string[];
}
```

Событие успешного монтирования view. `props` содержит только имена ключей (не более 32).

### `DevtoolsUnmountEvent`

```ts
interface DevtoolsUnmountEvent extends DevtoolsEventBase {
  readonly type: "unmount";
  readonly viewId: number;
  readonly name: string;
  readonly moduleId: string | null;
  readonly lifetimeMs: number;
}
```

Событие демонтажа view с временем жизни инстанса.

### `DevtoolsErrorEvent`

```ts
interface DevtoolsErrorEvent extends DevtoolsEventBase {
  readonly type: "error";
  readonly name: string | null;
  readonly moduleId: string | null;
  readonly phase: string;
  readonly message: string;
}
```

Ошибка резолва VM, прелоадера или гидрации. `message` обрезается до 512 символов.

### `DevtoolsHmrEvent`

```ts
interface DevtoolsHmrEvent extends DevtoolsEventBase {
  readonly type: "hmr";
  readonly moduleId: string;
  readonly kind: "update" | "invalidate";
  readonly views: number;
}
```

HMR-обновление (`hmrUpdate`) или инвалидация (`hmrInvalidate`).

### `DevtoolsNavigateEvent`

```ts
interface DevtoolsNavigateEvent extends DevtoolsEventBase {
  readonly type: "navigate";
  readonly to: string;
  readonly from: string | null;
}
```

Событие навигации, опубликованное через `devtoolsNavigate`.

### `DevtoolsResolveEvent`

```ts
interface DevtoolsResolveEvent extends DevtoolsEventBase {
  readonly type: "resolve";
  readonly token: string;
  readonly container: string;
  readonly owner: string;
  readonly scope: string;
  readonly implicit: boolean;
  readonly cached: boolean;
}
```

Событие DI-резолва: `token` — имя токена, `container` — контейнер-владелец, `owner` — запрашивающий контейнер, `scope` — режим scope, `implicit` — неявный биндинг, `cached` — взято из кеша.

### `DevtoolsSubscriber`

```ts
type DevtoolsSubscriber = (event: DevtoolsEvent) => void;
```

Функция-слушатель событий.

### `DevtoolsInstallOptions`

```ts
interface DevtoolsInstallOptions {
  readonly enabled?: boolean;
  readonly eventLimit?: number;
}
```

Опции установки. `enabled: true` принудительно включает DevTools даже при production-признаках.

### `DevtoolsHandle`

```ts
interface DevtoolsHandle {
  readonly installed: boolean;
  readonly global: DevtoolsGlobal | null;
  snapshot(): DevtoolsSnapshot;
  subscribe(listener: DevtoolsSubscriber): () => void;
  events(): readonly DevtoolsEvent[];
  clear(): void;
  uninstall(): void;
}
```

Handle установки. В production-режиме возвращается no-op handle с `installed: false` и `global: null`.

### `DevtoolsGlobal`

```ts
interface DevtoolsGlobal {
  readonly version: 1;
  snapshot(): DevtoolsSnapshot;
  subscribe(listener: DevtoolsSubscriber): () => void;
  events(): readonly DevtoolsEvent[];
  clear(): void;
  uninstall(): void;
}
```

Форма `globalThis.__SILENT_DEVTOOLS__`.

## Ограничения

- **Синхронные компоненты.** Функция без метаданных silent.view с `vm` считается синхронной: у неё нет `this.vm`, рантайм не создаёт для неё scope и не ждёт готовности. По соглашению синхронными остаются прелоадеры и простые UI-листья.
- **Обязательный `import type` для VM и прелоадера.** View-компонент ссылается на VM и прелоадер только из `this`-типа; без `import type` / value-import компилятор не сможет связать токены. Метаданные могут ссылаться на интерфейс или DI-токен: тогда реализация разрешается через индекс (ровно одна реализация) или явный `bind`.
- **Прелоадеры без ViewModel.** Прелоадер обязан быть синхронным компонентом: VM в него не передается, готовности без VM нет. Компонент с метаданными silent.view в роли прелоадера приводит к ошибке через обработчик ошибок (`assertSyncPreloader`).
- **Рендер без компилятора.** Метаданные silent.view формирует компилятор; «голый» jsx-рантайм при попытке отрендерить такой компонент бросает ошибку, так как асинхронный резолв VM вне рантайма не поддерживается.
- **Поведение при ошибках.** Ошибка резолва VM или загрузки `lazy` не приводит к неразрешимому `ready` (промисы готовности не отклоняются); пользователь видит текст `Error: <message>` и сообщение из обработчика ошибок. Обработчик по умолчанию — `console.error`.
- **`mount` ожидает элемент.** Строковый `target` без совпадения в DOM приводит к выброшенной ошибке синхронно в момент вызова.
- **DevTools и кастомный DI-корень.** `getDevtoolsSnapshot().di` описывает только корневой `container` из `@ivlev-dev/silent-di`; scope-ы, созданные от отдельного `new Container()`, в снимок не попадают.
- **DevTools и синхронные компоненты.** События `mount` / `unmount` публикуются для view-компонентов с метаданными `silent.view`; синхронные компоненты без ViewModel в реестр не попадают.
- **Буфер событий.** Размер буфера ограничен (`DEVTOOLS_EVENT_LIMIT`, максимум 1000); старые события вытесняются, счётчик `dropped` растёт. Буфер и подписчики очищаются при `uninstallDevtools()`.
