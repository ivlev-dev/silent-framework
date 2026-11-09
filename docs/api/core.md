# @silent/core

Основной пакет рантайма Silent Framework: Stage-3 декораторы реактивности, ViewModel, view-компоненты с асинхронным DI, монтирование, JSX-рантайм, управляющие конструкции `For` / `Show` / `Suspense`, `lazy`, прелоадеры и обработка ошибок.

Серверные API в этот пакет не входят.

## Импорты

Прикладной код импортируется из `@silent/core`:

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
} from "@silent/core";
```

Компилятор (плагин `@silent/vite`, встроенный в сборку) генерирует импорты из сабпути `@silent/core/jsx-runtime`. Этот entry переэкспортирует зарезервированные имена:

- точки входа компиляции JSX: `jsx`, `jsxs`, `jsxDEV`, `Fragment`;
- DOM-примитивы скомпилированных шаблонов: `template`, `templateHoles`, `insert`, `text`, `attr`, `prop`, `style`, `spread`, `on`, `ref`, `effect`, `fragment`, `dynamic`, `attachDisposer`, `NODE_DISPOSER`;
- компоненты и помощники: `component`, `createComponent`, `For`, `Show`, `Suspense`, `lazy`;
- runtime-управление: `getReady`, `getViewMeta`, `getComponentName`, `isViewComponent`, `setPreloader`, `setFallback`, `setDefaultPreloader`, `setErrorHandler`, `whenIdle`;
- символы метаданных: `VIEW_META`, `PRELOADER`, `COMPONENT_READY`, `COMPONENT_DISPOSE`;
- типы: `JSX`, `Child`, `Children`, `AnyComponent`, `Preloader`, `ViewMeta`, `ViewRuntimeContext`, `SuspenseProps`, `LazyOptions`.

Прикладному коду сабпуть `@silent/core/jsx-runtime` не нужен: всё перечисленное доступно и из `@silent/core`.

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

Декораторы реализуют связку с `@silent/reactivity`: каждое поле получает собственную цепочку сигналов, вычисления мемоизируются, watcher-ы привязаны к reactive store экземпляра.

### `reactive`

*Стабильность: public.*

Декоратор Stage-3 для спецификатора `accessor`. При инициализации экземпляра класс помечается как reactive-класс; чтение и запись поля идут через глубокий прокси:

- каждый примитив и каждое вложенное свойство/индекс/`length` — отдельный сигнал;
- мутации массивов (`push`, `splice` и т.д.) уведомляют только затронутые индексы;
- экземпляры классов с `@reactive`-полями повторно не оборачиваются в прокси.

```ts
import { reactive } from "@silent/core";

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
import { computed, reactive } from "@silent/core";

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
import { reactive, watch } from "@silent/core";

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
- `dispose()` останавливает reactive store экземпляра — эффекты, `@watch`, вычисления (`@computed`); повторный вызов безопасен.
- Наследование не обязательно: хуки опознаются по именам на любом объекте VM.
- Типовой параметр `P` описывает props компонента; в примерах используется как `extends ViewModel<{ step: number }>`.

Пример из README:

```tsx
import { computed, reactive, ViewModel, watch } from "@silent/core";

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
  dispose(): void;
}
```

- `node` — корневой узел (элемент, фрагмент или фрагмент с маркерами view).
- `ready` — промис готовности: для view-компонента завершается после резолва VM и рендера; для синхронного — сразу (либо берётся `COMPONENT_READY` внутри результата, так что вложенные `lazy` учитываются).
- `dispose()` — останавливает компонент: прерывает `signal`, снимает узлы с DOM, останавливает эффекты и scope, снимает HMR-регистрацию.

### `RuntimeOptions`

*Стабильность: public.*

```ts
interface RuntimeOptions {
  readonly container?: Container | undefined;
  readonly preloader?: Preloader | null | undefined;
  readonly onError?: ((error: unknown, component: AnyComponent) => void) | undefined;
  readonly boundary?: AsyncBoundary | null | undefined;
}
```

Опции исполнения для `createComponent`/`component`/`withRuntimeOptions` и текущего JSX-контекста:

- `container` — DI-контейнер, от которого строится дочерний scope view.
- `preloader` — локальный прелоадер, перекрывающий глобальный.
- `onError` — локальный обработчик ошибок, перекрывающий глобальный.
- `boundary` — граница `Suspense` (внутренний тип); создаётся `Suspense` и передаётся вниз автоматически.

### `getRuntimeOptions`

*Стабильность: internal.*

```ts
function getRuntimeOptions(): RuntimeOptions;
```

Возвращает текущие амбиентные runtime-опции. Используется компилированным кодом (`component`, `lazy`, `Suspense`) и интеграции (`@silent/vite`, `@silent/server`); в прикладном коде прямое применение не требуется.

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
- `signal` — `AbortSignal`, прерываемый при dispose view.
- `view` — корневой узел view после вставки; до рендера — `null`.

### `ComponentContext`

*Стабильность: public.*

```ts
class ComponentContext<P = unknown> implements ComponentContextValue<P> {
  constructor(props: P, container: Container, signal: AbortSignal);
  // ... поля ComponentContextValue
}
```

Класс одновременно является DI-токеном: рантайм биндит экземпляр в scope каждого view, поэтому VM получает его через конструктор или `container.resolve(ComponentContext)`:

```ts
import type { Container } from "@silent/di";
import { DI_CREATE } from "@silent/di";
import { ComponentContext } from "@silent/core";

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

Возвращает промис готовности узла:

- если узел имеет `COMPONENT_READY` — его промис;
- если узел — `DocumentFragment` — промис первого дочернего узла, у которого он есть;
- иначе — сразу разрешённый промис.

`mount` и `createComponent` уже ждут этот промис; `getReady` полезен, когда узел вставляется вручную.

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
function component(componentFn: AnyComponent, props: Record<string, unknown>): Node;
```

Вызывает `createComponent(componentFn, props, getRuntimeOptions())` и возвращает только узел — без `ready` и `dispose`. Формат вызова, который компилятор генерирует для `<Comp {...props} />`; удобен и для ручного создания компонентов внутри родителя:

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
import { mount } from "@silent/core";

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

### `MountHandle`

*Стабильность: public.*

```ts
interface MountHandle {
  readonly ready: Promise<void>;
  dispose(): void;
}
```

- `ready` — тот же промис готовности, что и у корневого компонента: удобен для `Suspense`-подобного ожидания внешним кодом.
- `dispose()` — демонтирует приложение (идемпотентно): dispose корневого компонента и владельца, снятие узлов; ViewModel проходит `beforeUnmount`/`unmounted`/`dispose`.

### `hydrate`

*Стабильность: public.*

```ts
async function hydrate(
  target: Element | string,
  app: AnyComponent,
  options?: MountOptions,
): Promise<MountHandle>;
```

Гидрация серверной разметки: приложение рендерится в отсоединённый фрагмент, а целевой элемент **не трогается**, пока не завершатся асинхронные ViewModel и `lazy` (`ready` + `whenIdle` + `flushSync`). После готовности содержимое `target` заменяется готовым деревом одним `replaceChildren`.

Что это даёт:

- серверный HTML остаётся видимым всё время резолва VM — нет вспышки прелоадера и пустого экрана;
- прокрутка страницы и фокус вне приложения не сбрасываются;
- при несовпадении разметки ничего не «ломается»: клиентский рендер становится источником истины.

Ограничение текущей реализации: узлы серверной разметки не переиспользуются по идентичности — рантайм не привязывает эффекты к чужим узлам. Поузловая адоптация требует идентификаторов в разметке и вынесена в дорожную карту.

```ts
import { hydrate } from "@silent/core";

const handle = await hydrate("#root", App, { container: appScope });
```

## SSR

Пакет `@silent/server` рендерит приложение в HTML без браузера и без внешних DOM-зависимостей: внутри пакета собственный мини-DOM (`Document`, парсер шаблонов компилятора, сериализатор).

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
6. Пакетный компонент демонтируется: ViewModel проходит `unmounted` и `dispose`.

```ts
import { renderToString } from "@silent/server";

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
}
```

- `props` — props корневого компонента.
- `container` — корневой DI-контейнер; дочерние view наследуют scope.
- `preloader` — глобальный прелоадер (используется, если у компонента нет своего).
- `onError` — если не задан, первая ошибка резолва/загрузки пробрасывается из `renderToString`; если задан — вызывается обработчик, а рендер завершается.

### `RenderResult`

*Стабильность: public.*

```ts
interface RenderResult {
  readonly html: string;
}
```

Ограничения SSR:

- только строковый результат, без стриминга и `head`-менеджмента;
- серверный мини-DOM не реализует события и `replaceChildren` — интерактивные эффекты выполняются, но ничего не делают;
- произвольный HTML в `template()` не поддерживается: парсер рассчитан на подмножество, которое генерирует компилятор.

## JSX

Типы JSX описывают контракт между компилятором и рантаймом. Ключевое правило: **компонент принимает props обычным параметром, ViewModel приходит через `this`** — тип параметра `this` сообщает компилятору, что перед ним view-компонент, и какая VM с прелоадером ему нужны:

```tsx
import type { ViewContext } from "@silent/core";

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

### `JSX`

*Стабильность: public.*

Пространство типов для TSX:

- `JSX.Element = Node` — результат любого JSX-выражения.
- `JSX.ElementType = keyof JSX.IntrinsicElements | ((...args: never[]) => JSX.Element)`.
- `JSX.ElementChildrenAttribute` — показывает TS, где искать `children` в props компонента.
- `JSX.IntrinsicAttributes` — содержит `key?: string | number`; ключ удаляется рантаймом `jsx` перед вызовом компонента.
- `JSX.IntrinsicElements` — таблица встроенных тегов с типизированными props: общие (`class`/`className`, `id`, `style` как строка или объект, `ref`, `children`, `dangerouslySetInnerHTML`, обработчики `onClick`, `onInput`, `onChange`, `onKeyDown`, `onKeyUp`, `onSubmit`, `onFocus`, `onBlur`, `onScroll`, `onPointerDown`, `onPointerMove`, `onPointerUp` и capture-варианты) и специфичные для `a`, `button`, `img`, `input`, `textarea`, `select`, `form`; SVG-теги (`svg`, `path`, `circle`, `rect`, `line`, `g`, `defs`, `linearGradient`, `stop`, `use`, `tspan`) типизированы так же, создаются в SVG-пространстве имён; произвольные теги `[tag: string]` принимают общие props.

Пользовательский код расширяет таблицу (или опирается на fallback) через расширение `JSX.IntrinsicElements`, компилятор при этом не меняется.

### `Child`

*Стабильность: public.*

```ts
type Child = Node | string | number | bigint | boolean | null | undefined;
```

Допустимый дочерний элемент. `null`, `undefined` и `boolean` при рендере отбрасываются.

### `Children`

*Стабильность: public.*

```ts
type Children = Child | Child[] | (() => Children);
```

Вложенные массивы и функции (реактивные «толкатели») поддерживаются рекурсивно; функции разворачиваются при каждом прогоне эффекта.

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
import type { ViewComponent, ViewContext } from "@silent/core";

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
  each: readonly T[] | (() => readonly T[]);
  children: (item: T, index: () => number) => Node;
  fallback?: unknown;
}
```

- `each` — массив или реактивный толкатель. Ключом выступает сам элемент (пул держится на `Map`, сравнение — SameValueZero), поэтому для повторных элементов подходят примитивы и стабильные ссылки.
- `children` — функция, отрисовывающая один элемент; `index()` ленивый: сигнал номера создаётся только если он читается.
- Реконсиляция: существующие узлы сохраняются, перестановки двигают только элементы вне наибольшей возрастающей подпоследовательности; при неизменном порядке DOM не трогается; повторяющиеся элементы получают отдельные независимые состояния и якоря.
- `fallback` — значение или функция; показывается, когда список пуст; поддерживает реактивное обновление.
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

Props: `when` (значение или функция), `fallback`, `children`. «Правда» — всё, кроме `null`, `undefined`, `false`, `0` и `""`. Активная ветка рендерится как children, иначе как fallback; функции разворачиваются; содержимое заменяется при изменении условия.

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
- До загрузки: если есть охватывающая `Suspense`-граница, прелоадер не рендерится (граница показывает собственный `fallback`); если границы нет — показывается `options.preloader`, иначе глобальный `setDefaultPreloader`, иначе пустой якорь.
- Готовность: промис загрузки прикрепляется к якорю через `setReady`, поэтому `getReady(anchor)` и, соответственно, `mount().ready` учитывают ожидание; промис также регистрируется в `Suspense`-границе.
- После загрузки компонент рендерится со своими `props` через `component`.
- Ошибка загрузки: `options.onError` или глобальный `getErrorHandler`; в DOM вместо контента вставляется текст `Error: <message>`.

```tsx
import { lazy, Suspense } from "@silent/core";

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
function templateHoles(html: string): () => TemplateClone;
```

Как `template`, но дополнительно находит точки вставки «холов»: комментарии вида `silent-hole-<N>` (порядковый индекс до первого пропуска) и элементы с атрибутами `data-silent-a-<N>` (атрибуты после чтения удаляются — в серверном режиме, включённом `setServerMode`, они сохраняются).

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

### `attr`

*Стабильность: internal.*

```ts
function attr(el: Element, name: string, accessor: () => unknown): void;
```

Реактивная установка атрибута. Особые значения:

- `class`/`className` — `class`; `null`/`undefined`/`false`/`""` удаляют класс.
- `style` — уход в объект/строку (см. `style`).
- `value`, `checked`, `selected`, `disabled` — записываются как свойства DOM-элемента (не как атрибуты), кроме SVG-элементов, где остаётся атрибут.
- `null`, `undefined`, `false` — атрибут удаляется; `true` — ставится пустым значением для булевых атрибутов (`hidden`, `required`, `novalidate` и т.д.) и `"true"` иначе; прочие — `String(value)`.

SVG-элементы определяются автоматически по конструированию в SVG-пространстве имён.

### `prop`

*Стабильность: internal.*

```ts
function prop(el: Element, name: string, accessor: () => unknown): void;
```

Реактивная запись свойства напрямую: `(el as unknown as Record<string, unknown>)[name] = value`; сравнение с предыдущим значением, чтобы не трогать без изменений.

### `style`

*Стабильность: internal.*

```ts
function style(el: Element, accessor: () => unknown): void;
```

Реактивная установка стиля с диффом небольших правок:

- `null`/`undefined` — сброс свойств, отмеченных в снепшоте.
- Строка — обновление `cssText` и сверка ключей со снепшотом (свойства, ушедшие из строки, удаляются).
- Объект — свойства в kebab-case (`hyphen`); `null`/`undefined`/`""` удаляют свойство; ушедшие из объекта — тоже.

### `spread`

*Стабильность: internal.*

```ts
function spread(el: Element, accessor: () => unknown): void;
```

Реактивный спред объекта props на элемент: классы, стили, атрибуты, `ref` (функция ref освобождается вызовом с `null` при смене ключа и cleanup-ветвлениях), события (`on:`-имена, `onXxx`, `onXxxCapture`), свойства, булевы атрибуты. Ключи `children` и `key` игнорируются. Атрибуты, пропавшие из нового объекта, удаляются.

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

Обертка над `createRenderEffect`: первый запуск синхронный, последующие — в общем flush. Для прикладного кода предпочтительно использовать `createEffect` / `createRenderEffect` напрямую из `@silent/reactivity`.

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
function collectNodes(value: Children): Node[];
```

Нормализует `Children` в плоский список узлов: разворачивает функции и массивы, выбрасывает `null`/`undefined`/boolean, разбивает `DocumentFragment` на потомков, конвертирует строки и числа в текстовые узлы.

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

## Ограничения

- **Синхронные компоненты.** Функция без метаданных silent.view с `vm` считается синхронной: у неё нет `this.vm`, рантайм не создаёт для неё scope и не ждёт готовности. По соглашению синхронными остаются прелоадеры и простые UI-листья.
- **Обязательный `import type` для VM и прелоадера.** View-компонент ссылается на VM и прелоадер только из `this`-типа; без `import type` / value-import компилятор не сможет связать токены. Метаданные могут ссылаться на интерфейс или DI-токен: тогда реализация разрешается через индекс (ровно одна реализация) или явный `bind`.
- **Прелоадеры без ViewModel.** Прелоадер обязан быть синхронным компонентом: VM в него не передается, готовности без VM нет. Компонент с метаданными silent.view в роли прелоадера приводит к ошибке через обработчик ошибок (`assertSyncPreloader`).
- **Рендер без компилятора.** Метаданные silent.view формирует компилятор; «голый» jsx-рантайм при попытке отрендерить такой компонент бросает ошибку, так как асинхронный резолв VM вне рантайма не поддерживается.
- **Поведение при ошибках.** Ошибка резолва VM или загрузки `lazy` не приводит к неразрешимому `ready` (промисы готовности не отклоняются); пользователь видит текст `Error: <message>` и сообщение из обработчика ошибок. Обработчик по умолчанию — `console.error`.
- **`mount` ожидает элемент.** Строковый `target` без совпадения в DOM приводит к выброшенной ошибке синхронно в момент вызова.
