# Router API

Пакет `@ivlev-dev/silent-router` строится вокруг интерфейса `IRouter`, класса `Router`, route-классов `Route` и двух публичных компонентов — `Link` и `RouterView`. Публичных hooks (`useRouter`, `useRoute`, `useParams`) нет.

Экспорты: `Router`, `IRouter`, `RouterOptions`, `RouterState`, `RouterTransitionOptions`, `Route`, `RouteClass`, `RouteDefinition`, `RouteInput`, `RouteViewProps`, `RouteLoadContext`, `RouteClassGuard`, `RouteClassLoad`, `RouteComponent`, `PathParams`, `TypedRouteLocation`, `RouteQueryShape`, `QueryParser`, `QuerySchema`, `AnyRouteGuard`, `AnyRouteLoader`, `BrowserHistory`, `MemoryHistory`, `createBrowserHistory`, `createMemoryHistory`, `HistoryListener`, `HistoryLocation`, `RouterHistory`, `RouterAbortError`, `RouterMissingError`, `RouterNavigationError`, `MatchedRoute`, `QueryInput`, `RouteGuard`, `RouteGuardContext`, `RouteGuardResult`, `RouteLoader`, `RouteLoaderResult`, `RouteLocation`, `RouteLocationTargetObject`, `RouteMeta`, `RouteParams`, `RouteQuery`, `RouteQueryValue`, `RouteRecord`, `RouteRedirect`, `RouteTarget`, `RouterErrorCode`, `ScrollBehavior`, `ScrollBehaviorResult`, `ScrollPosition`, `Link`, `LinkProps`, `RouterView`, `RouterViewComponentProps`, `RouterViewProps`, `createGuard`, `createTestRouter`, `TestRouterOptions`, `RouterComponentLoadContext`, `RouterComponentLoader`.

## `IRouter`

```ts
import type { IRouter } from "@ivlev-dev/silent-router";

export class PageVM {
  constructor(private readonly router: IRouter) {}

  open(): Promise<void> {
    return this.router.push({ name: "user", params: { id: 42 } });
  }
}
```

```ts
interface IRouter {
  readonly base: string;
  readonly state: Accessor<RouterState>;
  readonly route: RouteLocation | null;
  readonly params: RouteParams;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly meta: RouteMeta;
  readonly matched: readonly MatchedRoute[];
  resolve(to: RouteTarget): RouteLocation;
  href(to: RouteTarget): string;
  hasRoute(to: RouteTarget): boolean;
  isLoaded(to: RouteTarget): boolean;
  prefetch(to: RouteTarget): Promise<void>;
  navigate(to: RouteTarget, options?: { readonly replace?: boolean }): Promise<boolean>;
  push(to: RouteTarget, options?: RouterTransitionOptions): Promise<void>;
  replace(to: RouteTarget, options?: RouterTransitionOptions): Promise<void>;
  back(): void;
  forward(): void;
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
}
```

`IRouter` содержит `base`, `state()`, `route`, `params`, `query`, `hash`, `meta`, `matched`, `resolve`, `href`, `hasRoute`, `isLoaded`, `prefetch`, `navigate`, `push`, `replace`, `back`, `forward`, `start`, `stop`, `dispose`. `Router implements IRouter`. В рантайме `IRouter` — это value-токен, совпадающий с `Router`, поэтому компилятор DI может подставить его напрямую.

- `meta` — объединённый `RouteMeta` текущего маршрута (или пустой объект).
- `hasRoute(to)` — проверяет, разрешается ли цель в известный маршрут, без навигации.
- `isLoaded(to)` — `true`, если все записи matched-цепочки имеют компонент: статический, закешированный или без загрузчика.
- `navigate(to, options?)` — навигация без исключений: `true` при успехе, `false` при отмене, `false` от guard, no-match и ошибках; ошибка записывается в `state.error`, вызывается `onError` (кроме отмены и `false`).
- `push`/`replace` — прежнее поведение с отклонением промиса при ошибках. По умолчанию отменённая (abort) навигация завершается успешно, чтобы не ломать `navigate`/`Link`; передайте `{ rejectOnAbort: true }`, чтобы получить `RouterAbortError`:

```ts
await router.push("/slow", { rejectOnAbort: true });
```

```ts
interface RouterTransitionOptions {
  readonly rejectOnAbort?: boolean;
}
```

## `Router`

```ts
const router = new Router({
  base: "/app",
  routes: [HomeRoute, UsersRoute, UserRoute],
  history: createBrowserHistory(),
  container,
  load: (context) => import("./page").then((m) => m.default),
  onError: (error, to) => console.error(error.code, to),
});

await router.start();
```

```ts
interface RouterOptions {
  readonly routes: readonly RouteInput[];
  readonly base?: string;
  readonly history?: RouterHistory;
  readonly scrollBehavior?: ScrollBehavior;
  readonly container?: Container;
  readonly load?: RouterComponentLoader;
  readonly resolveComponent?: RouterComponentLoader;
  readonly onError?: (error: RouterNavigationError, to: RouteTarget) => void;
}
```

- `RouterState` — `route`, `params`, `query`, `hash`, `matched`, `pending`, `error`.
- `route`, `params`, `query`, `hash`, `meta`, `matched`, `state()` — реактивные accessor'ы.
- `push`, `replace`, `back`, `forward` — навигация; `resolve`/`href` — построение URL; `start`/`stop`/`dispose` — жизненный цикл. Повторный `push`/`replace` на текущий `fullPath` (с учётом query и hash) не создаёт запись в истории и не перезапускает guards/loaders.
- Объектная цель `resolve({ name, params, query, hash })` без `query`/`hash` наследует их у текущего маршрута; явные поля объекта имеют приоритет. Query и hash внутри `path` (`{ path: "/search?q=a#top" }`) разбираются так же, как в строковой цели, но уступают явным `query`/`hash`.
- `Router.current()` возвращает последний запущенный роутер (`start()`); `stop()` и `dispose()` снимают его из реестра. Это fallback для компонентов без DI и `router` prop.
- При отменённой popstate-навигации (guard вернул `false`) URL восстанавливается через `history.replace` на текущий маршрут, чтобы адресная строка не расходилась с `RouterView`.
- `load` и `resolveComponent` — алиасы глобального загрузчика страниц; `record.load` имеет приоритет.

```ts
interface RouterComponentLoadContext extends RouteLoadContext {
  readonly record: RouteRecord;
}

type RouterComponentLoader = (
  context: RouterComponentLoadContext,
) => RouteLoaderResult | Promise<RouteLoaderResult>;
```

Контекст загрузчика содержит `route`, `params`, `query`, `hash`, `meta`, `router`, `signal`, `record` (наследуется из `RouteLoadContext` и `RouteViewProps`).

### Регистрация в DI

```ts
import { container } from "@ivlev-dev/silent-di";

const router = new Router({ routes, container });
```

`container` в опциях вызывает `router.provide(container)`. Эквивалентно:

```ts
const router = new Router({ routes });
router.provide(container);
```

`provide` использует `container.bindValue(Router, router)`, поэтому роутер доступен синхронно через `container.peek(Router)` сразу после регистрации. Явная привязка `container.bind(Router, router)` с готовым экземпляром также сразу видна через `peek`/`peekValue` и `resolveSync`; `resolve` возвращает тот же экземпляр. Function-factory в `bind` остаётся ленивым и резолвится асинхронно, а transient/scoped-семантика не меняется.

`Link` и `RouterView` ищут роутер в таком порядке:

1. явный `router` prop;
2. `getRuntimeOptions().container.peek(Router)` из DI-контекста; если `container.hasExplicit(Router)`, но значения ещё нет — `RouterMissingError`; если контейнера нет биндинга — `RouterMissingError`;
3. `Router.current()` только когда контейнера нет вообще.

Асинхронный `resolve` для `Link` не используется.

Для синхронного `peek` используйте `bindValue` (или `bind(token, instance)`). Scoped/transient не подходят для `Router` и `Session`.

## Route-классы

Новый основной API — классы, унаследованные от `Route`:

```tsx
import { Route, RouterView } from "@ivlev-dev/silent-router";

class UsersRoute extends Route<"/users/{id}", { tab?: "info" | "profile" }> {
  readonly path = "/users/{id}";
  readonly name = "user";
  readonly component = UserView;
}

function UserView(props: RouteViewProps<"/users/{id}", { tab?: "info" | "profile" }>) {
  return (
    <section>
      <h1>{props.params.id}</h1>
      <p>{props.query.tab ?? "info"}</p>
      <p>{props.meta.title as string}</p>
    </section>
  );
}
```

`PathParams<"/users/{id}">` даёт `{ readonly id: string }`; старый синтаксис `:id` поддерживается и типизируется так же. Параметры можно смешивать с литералами внутри одного сегмента: `prefix-{id}`, `edit-{id}-{tab}`, `v{version}.{ext}`. `PathParams` выводит все имена, включая mixed-сегменты. Query-параметр `Query` описывает форму `props.query`.

```tsx
import {
  Route,
  type QuerySchema,
  type RouteViewProps,
} from "@ivlev-dev/silent-router";

type EditQuery = { page: number; active: boolean; tags: string[] };

const editQuery: QuerySchema<EditQuery> = {
  page: "number",
  active: "boolean",
  tags: "string[]",
};

class EditRoute extends Route<"/edit-{id}", EditQuery> {
  readonly path = "/edit-{id}";
  readonly name = "edit";
  readonly component = EditView;
  readonly query = editQuery;
  readonly key = (to) => to.params.id;
}

function EditView(props: RouteViewProps<"/edit-{id}", EditQuery>) {
  return (
    <section>
      <h1>{props.params.id}</h1>
      <p>{props.query.page}</p>
      <p>{String(props.query.active)}</p>
      <p>{props.query.tags.join(", ")}</p>
    </section>
  );
}
```

`query` — runtime-схема, а не только типы. Для `/edit-7?page=2&active=true&tags=a&tags=b` `props.query`, `router.query` и `router.state().query` содержат `{ page: 2, active: true, tags: ["a", "b"] }`. Поддерживаются `"string"`, `"number"`, `"boolean"`, `"string[]"`, `"number[]"`, `"boolean[]"` и функция `(raw: string | string[] | undefined) => value | undefined`. Невалидные `number`/`boolean` и отсутствующие ключи дают `undefined` (ключ не попадает в объект). Схемы вложенных маршрутов объединяются от корня к листу, лист имеет приоритет. Сериализация query поддерживает числа, boolean и массивы; `fullPath` сохраняет исходное представление query.

`Route` поддерживает `path`, `name`, `component`, `children`, `redirect`, `meta`, `beforeEnter`, `load`, `query`, `key`. `RouterOptions.routes` принимает route-классы, их экземпляры и старые object-routes; классы инстанцируются роутером. Экземпляры `Route` распознаются и по маркеру `Symbol.for("silent.route")`, поэтому контракт `load(context)` сохраняется для копии пакета, отличной от той, что использует роутер.

```ts
class AdminRoute extends Route {
  readonly path = "/admin";
  readonly name = "admin";
  readonly component = AdminLayout;
  readonly children = [AdminIndexRoute, AdminUserRoute];
  readonly beforeEnter = (to: RouteLocation, from: RouteLocation | null) =>
    isAuthorized() ? true : "/login";
  readonly meta = { requiresAuth: true };
}

class AdminUserRoute extends Route<"users/{id}"> {
  readonly path = "users/{id}";
  readonly name = "admin-user";
  async load(context: RouteLoadContext<"users/{id}">) {
    const module = await import("./admin-user");
    return module.AdminUser;
  }
}
```

`load(context)` получает `route`, `params`, `query`, `hash`, `router`, `signal` и `meta`. Загрузчик может вернуть компонент или модуль с `default`; результат кешируется по route-record. `beforeEnter` может вернуть `true`, `false`, путь/объект маршрута или `Promise` с этим значением. `redirect` может быть строкой, объектом маршрута или функцией `(to) => target`.

`RouteViewProps`:

```ts
interface RouteViewProps<Path extends string = string, Query = RouteQuery> {
  readonly route: TypedRouteLocation<Path, Query>;
  readonly params: PathParams<Path>;
  readonly query: Query;
  readonly hash: string;
  readonly meta: RouteMeta;
  readonly router: IRouter;
}
```

`RouteLoadContext` расширяет `RouteViewProps` полем `signal`. Глобальный загрузчик получает `RouterComponentLoadContext = RouteLoadContext & { record }`.

Сопоставление путей:

- `{id}` и `:id` — параметрический сегмент;
- mixed-сегменты `prefix-{id}`, `edit-{id}-{tab}`, `v{version}.{ext}` сочетают литералы и параметры; параметры корректно декодируются и кодируются, duplicate-имена дают last wins;
- `*` — wildcard-хвост, попадает в `params["*"]`; wildcard не смешивается с литералами и параметрами в одном сегменте;
- `""` — index-маршрут;
- специфичность: чистый статический сегмент важнее mixed, mixed важнее чистого параметра, параметр важнее wildcard; при равной специфичности учитывается длина литералов и порядок объявления;
- вложенная цепочка важнее одиночного маршрута.

Object-routes (`RouteRecord`) остаются как совместимый устаревший формат:

```ts
const routes: RouteRecord[] = [
  { path: "/", name: "home", component: Home },
  { path: "/about", name: "about", component: About },
];
```

`RouteRecord`:

```ts
interface RouteRecord<Q = Readonly<Record<string, unknown>>> {
  readonly path: string;
  readonly name?: string;
  readonly component?: AnyComponent;
  readonly children?: readonly RouteRecord[];
  readonly redirect?: RouteRedirect;
  readonly beforeEnter?: RouteGuard;
  readonly load?: RouteLoader;
  readonly meta?: RouteMeta;
  readonly query?: QuerySchema<Q>;
  readonly key?: (to: RouteLocation) => string | number;
}
```

## Guards

`RouteGuardContext`:

```ts
interface RouteGuardContext<Path extends string = string, Query = RouteQuery> {
  readonly router: IRouter;
  readonly container: Container | undefined;
  readonly to: TypedRouteLocation<Path, Query>;
  readonly from: TypedRouteLocation<Path, Query> | null;
  readonly signal: AbortSignal;
}
```

`RouteGuard`:

```ts
type RouteGuard = (
  to: RouteLocation,
  from: RouteLocation | null,
  signal: AbortSignal,
  context: RouteGuardContext,
) => RouteGuardResult | Promise<RouteGuardResult>;
```

`createGuard`:

```ts
function createGuard<Path extends string = string, Query = RouteQuery>(
  handler: (context: RouteGuardContext<Path, Query>) => RouteGuardResult | Promise<RouteGuardResult>,
): RouteGuard;
```

`beforeEnter` route-класса может принимать 4-й аргумент `context?: RouteGuardContext`.

## `Link`

```tsx
<Link to="/users" activeClass="active" exactActiveClass="exact">Пользователи</Link>
<Link to={{ name: "user", params: { id: 42 }, query: { tab: "info" } }}>Профиль</Link>
```

`LinkProps`: `to`, `replace`, `activeClass`, `exactActiveClass`, `class`, `children`, `router?: IRouter`, `prefetch?: boolean | "hover" | "visible"`, `exactQuery?: boolean`. `prefetch: true` и `"hover"` вызывают `router.prefetch` на `pointerenter`, `pointerdown` и `focus`; `"visible"` — когда ссылка появляется во viewport (`IntersectionObserver`), а без него сразу после монтирования (на сервере не срабатывает). Рендерит настоящий `<a href>`, перехватывает только левый клик без модификаторов, active-классы реактивны, а на точный активный маршрут ставит `aria-current="page"`. Внешние `http(s)://`, `mailto:`, `tel:`, `//` и hash-ссылки не перехватываются и не prefetch-ятся.

«Точный» активный маршрут сравнивает не только `path`/`name` и `params`, но и `query` (по составу и значениям) и `hash`. Поэтому из нескольких ссылок на один путь с разными query-табами `aria-current` и `exactActiveClass` получает только совпадающая. Для обратной совместимости query-сравнение можно отключить: `exactQuery: false` (по умолчанию `true`); `hash` сравнивается всегда.

Схемы обрабатываются по allow-list: `http`, `https`, `mailto`, `tel`, а также протокол-относительные `//` и hash-ссылки `#`. Любая другая схема (`javascript:`, `data:`, `vbscript:` и неизвестные) считается небезопасной: атрибут `href` не выставляется, клик не перехватывается и не навигирует, active-классы и `aria-current` не применяются.

Если для внутренней цели не нашлось маршрута, `Link` не выбрасывает исключение (это важно для SSR): `href` берётся из сырой строки `to`, а для объектной цели не выставляется; `aria-current` и active-классы не применяются. Клик по строковой цели при этом передаётся в `router.push`/`replace`, а ошибка `no-match` не всплывает из рендера. Публичный `router.resolve` по-прежнему сообщает об отсутствии маршрута через `RouterNavigationError`.

## `RouterView`

```tsx
<RouterView fallback={<p>Загрузка…</p>} />
<RouterView depth={1} />
<RouterView router={router} />
<RouterView container={container} />
<RouterView
  error={(error) => <p>{String(error)}</p>}
  notFound={<p>Не найдено</p>}
/>
```

```ts
interface RouterViewProps {
  readonly router?: IRouter;
  readonly depth?: number;
  readonly fallback?: unknown;
  readonly container?: Container;
  readonly error?: unknown | ((error: unknown) => unknown);
  readonly notFound?: unknown | ((error: unknown) => unknown);
}
```

`RouterView` берёт matched-компонент по глубине и монтирует его через core `component(...)`, поэтому route-компоненты с ViewModel и DI работают штатно. Компонент получает `RouteViewProps`: `route`, `params`, `query`, `hash`, `meta`, `router`. Старый `RouterViewComponentProps` — alias на `RouteViewProps`.

Разрешение роутера: явный `router` prop → `container.peek(Router)` (container из props или runtime options; ошибка, если binding явный, но значения ещё нет; ошибка, если контейнер есть, а биндинга нет) → `Router.current()` только без контейнера.

При смене `params`/`query`/`hash` в рамках того же route-компонента view не пересоздаётся: props остаются живыми, DOM, введённый текст и focus сохраняются. При этом у ViewModel вызывается `updated()`, а light-компоненты без ViewModel обновляются через `update()` с восстановлением focus. Пересоздание происходит только при смене компонента маршрута или при смене `key`.

Ошибки навигации: `error` и `notFound` могут быть значениями или функциями `(error) => ...`. Для `code === "no-match"` используется `notFound`, если задан, иначе `error`. Без слотов — `Error: ...` (для no-match — `Error: Маршрут не найден`).

## History

```ts
const browser = createBrowserHistory();
const memory = createMemoryHistory("/users/1");
```

`RouterHistory`/`HistoryLocation`/`HistoryListener` — контракт истории; `BrowserHistory` использует `pushState`/`popstate`/`hashchange`, `MemoryHistory` — SSR и тесты. `BrowserHistory` и `MemoryHistory` доступны как классы, плюс фабрики `createBrowserHistory`/`createMemoryHistory`.

## SSR

```ts
const router = new Router({
  routes: [HomeRoute, UsersRoute, UserRoute],
  history: createMemoryHistory("/users/42?tab=info"),
  container: appScope,
});

await router.start();
try {
  const { html, head } = await renderToString(App, {
    container: appScope,
  });
} finally {
  router.dispose();
}
```

`MemoryHistory` детерминирован на сервере; `Link` отдаёт обычные `href`, `RouterView` рендерит matched-компонент, включая view-компоненты с ViewModel, получающие `IRouter` из DI. На клиенте создайте `BrowserHistory` и тот же набор route-классов. Роутер попадает в глобальный реестр `Router.current()` только после `start()`, поэтому в SSR его нужно освобождать в `finally` через `router.dispose()` — иначе реестр будет расти от запроса к запросу.

`RouterView` можно гидрировать: на клиенте он находит свой серверный маркер `silent-router-view`, удаляет прежнюю серверную разметку маршрута и рендерит matched-компонент заново в это место. Это сохраняет корректность DOM, но не адоптирует узлы маршрута; для SSR-приложений это компромисс между простотой и точным сохранением узлов.

## Скролл и ошибки

```ts
const router = new Router({
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition !== null) return savedPosition;
    if (to.hash !== "") return { left: 0, top: 0 };
    return null;
  },
});
```

Позиция сохраняется при уходе с маршрута и передаётся в `savedPosition` при возврате. Без `scrollBehavior` сохранённая позиция восстанавливается автоматически, а при непустом `hash` после обновления DOM прокручивается элемент с соответствующим `id` (или `name`). Возврат `false` или `null` отменяет прокрутку. Если `scrollBehavior` задан, он полностью управляет прокруткой, включая hash. Устаревший результат `scrollBehavior` от предыдущей навигации игнорируется; исключение из `scrollBehavior` не делает навигацию ошибочной — оно приходит в `onError` с кодом `"scroll"`, `state.error` остаётся `null`.

`RouterNavigationError` содержит `code` (`abort`, `guard`, `load`, `no-match`, `redirect`, `resolve`, `scroll`) и `to`; `RouterAbortError` — прерванная навигация; `RouterMissingError` — отсутствие роутера у `Link`/`RouterView`.

## `createTestRouter`

```ts
import { createTestRouter, type TestRouterOptions } from "@ivlev-dev/silent-router";

const router = createTestRouter({
  routes,
  initial: "/users/1",
  history, // опционально
  base: "/app",
  load, // и другие RouterOptions
});
```

```ts
interface TestRouterOptions extends Omit<RouterOptions, "history"> {
  readonly initial?: string;
  readonly history?: RouterHistory;
}
```

По умолчанию создаёт `MemoryHistory(initial ?? "/")`.

## Жизненный цикл

```ts
router.start();
router.stop();
router.dispose();
```

`stop()` снимает подписку на историю, прерывает активную навигацию и убирает роутер из `Router.current()`; `start()` можно вызывать повторно и он снова регистрирует роутер. `dispose()` дополнительно освобождает собственную историю. История, переданная пользователем, не освобождается.