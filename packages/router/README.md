# @ivlev-dev/silent-router

Роутер Silent Framework: интерфейс `IRouter`, route-классы с типизированными параметрами, вложенные маршруты, guards, ленивые компоненты, DI-доставка, восстановление скролла и SSR через `MemoryHistory`.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-router)](https://www.npmjs.com/package/@ivlev-dev/silent-router) [![license](https://img.shields.io/npm/l/@ivlev-dev/silent-router)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE) [![node](https://img.shields.io/node/v/@ivlev-dev/silent-router)](https://www.npmjs.com/package/@ivlev-dev/silent-router)

## Возможности

- `IRouter` и `Router implements IRouter`; ViewModel получает роутер через `constructor(private readonly router: IRouter)`.
- Route-классы с типизированными `PathParams<"/edit/{id}">` и generic-query, включая mixed-сегменты `edit-{id}-{tab}` и `v{version}.{ext}`.
- Синтаксис `/edit/{id}` и совместимый `:id`, вложенные маршруты, `*`, index-маршруты.
- Канонизация пути и `base` как в браузере (обратные слэши, пустые сегменты, `.`/`..`/`%2e%2e`); отсутствующие/`""`/`"."`/`".."` параметры отклоняются с `code: "resolve"`, lone surrogate заменяется на `U+FFFD`.
- Runtime-схема query (`QuerySchema`) приводит `number`, `boolean` и массивы; `RouteViewProps.query` и `router.query` содержат уже распарсенные значения.
- `redirect`, синхронные и асинхронные `beforeEnter`, ленивый `load(context)` с кешированием.
- `Link` и `RouterView` получают роутер из DI-контекста или явного `router` prop синхронно; на клиенте есть fallback на `Router.current()`, в серверном рендере без prop/контейнера бросается `RouterMissingError`.
- `RouterView` монтирует route-компоненты через core `component(...)`, поэтому ViewModel/DI работают; при смене `params`/`query` view переиспользуется и сохраняет DOM/focus.
- При гидрации `RouterView` адоптирует серверный маркер, удаляет старую разметку маршрута и рендерит matched-компонент заново.
- `BrowserHistory` (`pushState`, `popstate`, `hashchange`) и `MemoryHistory` для тестов и SSR.
- Повторный переход на текущий путь не дублирует историю и не перезапускает guards/loaders.
- Восстановление скролла: `scrollBehavior(to, from, savedPosition)`; без него позиция восстанавливается автоматически, а `#hash` прокручивает к элементу.
- `RouteLocation.meta` и `IRouter.meta` — объединение `meta` по matched-цепочке от корня к листу, лист перекрывает родителей.
- `RouteGuardContext`: `{ router, container, to, from, signal }`; guard получает его 4-м аргументом; `createGuard(handler)` оборачивает функциональный guard.
- Глобальные загрузчики `RouterOptions.load` и `RouterOptions.resolveComponent` с контекстом `{ route, params, query, hash, meta, router, signal, record }`; `record.load` имеет приоритет. `IRouter.isLoaded(to)`, `IRouter.hasRoute(to)`.
- `router.navigate(to, { replace? }): Promise<boolean>` — не бросает, пишет ошибку в `state.error`, возвращает `true`/`false`; `push`/`replace` по-прежнему бросают.
- `RouterOptions.onError?: (error, to) => void` вызывается при ошибке навигации (не при отмене).
- `RouteDefinition.key?: (to: RouteLocation) => string | number`; `RouterView` пересоздаёт компонент при смене ключа, иначе переиспользует и обновляет.
- `RouterView`: пропсы `container`, `error`, `notFound` — разрешение роутера из контейнера и слоты ошибки/404.
- `createTestRouter(options)` — тестовый роутер с `MemoryHistory` по умолчанию.

## Установка

```bash
pnpm add @ivlev-dev/silent-router
```

```bash
npm install @ivlev-dev/silent-router
```

```bash
yarn add @ivlev-dev/silent-router
```

`@ivlev-dev/silent-core`, `@ivlev-dev/silent-di` и `@ivlev-dev/silent-reactivity` объявлены как peer-зависимости с диапазоном `>=0.12.0 <0.13.0`: их устанавливает ваш менеджер пакетов, npm 7+ и pnpm делают это автоматически. Пакет поставляется только как ESM. Требуется Node.js 22 или новее.

## Быстрый старт

```tsx
import {
  Route,
  Router,
  RouterView,
  Link,
  type RouteViewProps,
} from "@ivlev-dev/silent-router";

class HomeRoute extends Route {
  readonly path = "/";
  readonly name = "home";
  readonly component = Home;
}

class UsersRoute extends Route {
  readonly path = "/users";
  readonly name = "users";
  readonly component = UsersLayout;
  readonly children = [UsersIndexRoute, UserRoute];
}

class UserRoute extends Route<"{id}", { tab?: "info" | "profile" }> {
  readonly path = "{id}";
  readonly name = "user";
  readonly component = UserView;
}

function UserView(props: RouteViewProps<"{id}", { tab?: "info" | "profile" }>) {
  return (
    <section>
      <h1>{props.params.id}</h1>
      <p>{props.query.tab ?? "info"}</p>
      <p>{props.meta.title as string}</p>
    </section>
  );
}

export const router = new Router({
  base: "/app",
  routes: [HomeRoute, UsersRoute],
});

await router.start();

export function App() {
  return (
    <>
      <nav>
        <Link to="/" activeClass="active" exactActiveClass="exact">Главная</Link>
        <Link to={{ name: "users" }} activeClass="active">Пользователи</Link>
      </nav>
      <main>
        <RouterView
          fallback={<p>Загрузка…</p>}
          notFound={<p>Маршрут не найден</p>}
          error={(error) => <p>Ошибка: {String(error)}</p>}
        />
      </main>
    </>
  );
}
```

## `IRouter` и DI

```ts
import type { IRouter } from "@ivlev-dev/silent-router";

export class PageVM {
  constructor(private readonly router: IRouter) {}

  open(): Promise<void> {
    return this.router.push({ name: "user", params: { id: 42 } });
  }
}
```

`IRouter` содержит `base`, `state()`, `route`, `params`, `query`, `hash`, `meta`, `matched`, `resolve`, `href`, `hasRoute`, `isLoaded`, `prefetch`, `navigate`, `push`, `replace`, `back`, `forward`, `start`, `stop`, `dispose`. В рантайме `IRouter` — value-токен, совпадающий с `Router`, поэтому компилятор DI подставляет его как единственную реализацию.

Корневой контейнер создавайте в строгом режиме:

```ts
import { Container } from "@ivlev-dev/silent-di";

const container = new Container("app", undefined, { implicitBindings: "error" });
```

Зарегистрируйте роутер и сервисы через `bindValue`:

```ts
import { Router } from "@ivlev-dev/silent-router";

const router = new Router({ routes });
container.bindValue(Session, session);
container.bindValue(Router, router);
```

`bindValue` кладёт экземпляр в resolved-кеш владельца, поэтому `container.peek(Router)` работает синхронно сразу после регистрации. `container.bind(Router, router)` с готовым экземпляром тоже виден синхронно через `peek`/`peekValue`. `container.bind(Router, factory)` с функцией остаётся ленивым и резолвится асинхронно.

`scoped`/`transient` не подходят для `Router` и `Session`: `Link` и `RouterView` ищут роутер через `peek` до асинхронного resolve, а scoped-экземпляр привязан к дочернему scope и не виден синхронно из родительского/соседнего контейнера.

`provide` вызывает `container.bindValue(Router, router)`:

```ts
const router = new Router({ routes });
router.provide(container);
```

Порядок поиска роутера в `Link` и `RouterView`:

1. явный `router` prop;
2. если передан или найден контейнер: `container.peek(Router)`; если `container.hasExplicit(Router)`, но значения ещё нет — `RouterMissingError`; если контейнер есть, а биндинга нет — `RouterMissingError`;
3. `Router.current()` — только на клиенте и только когда контейнера нет вообще; в серверном рендере в этом случае бросается `RouterMissingError`.

`Link` не использует асинхронный `resolve`.

`RouterView` принимает `container` prop и использует его для разрешения роутера и DI-контекста дочерних компонентов:

```tsx
<RouterView container={container} fallback={<p>Загрузка…</p>} />
```

## Route-классы

```ts
import { Route, type RouteLoadContext } from "@ivlev-dev/silent-router";

class AdminRoute extends Route {
  readonly path = "/admin";
  readonly name = "admin";
  readonly component = AdminLayout;
  readonly children = [AdminIndexRoute, AdminUserRoute];
  readonly meta = { requiresAuth: true };
  readonly beforeEnter = async (to, from, signal, context) => {
    if (signal.aborted) return false;
    return (await checkSession()) ? true : "/login";
  };
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

`RouterOptions.routes` принимает route-классы, их экземпляры и старые object-routes. Классы инстанцируются роутером.

`Route` поддерживает `path`, `name`, `component`, `children`, `redirect`, `meta`, `beforeEnter`, `load`, `query`, `key`.

- `{id}` и `:id` — параметрические сегменты. `PathParams<"/users/{id}">` даёт `{ readonly id: string }`.
- Параметры можно смешивать с литералами внутри одного сегмента: `prefix-{id}`, `edit-{id}-{tab}`, `v{version}.{ext}`. Mixed-сегмент специфичнее чистого параметра и уступает чистому статическому сегменту.
- `Query` — generic-форма query для `RouteViewProps` и `RouteLoadContext`. `query` задаёт runtime-схему (`QueryParser`/`QuerySchema`): `"string"`, `"number"`, `"boolean"`, `"string[]"`, `"number[]"`, `"boolean[]"` или функция `(raw) => value | undefined`.
- `load(context)` получает `route`, `params`, `query`, `hash`, `router`, `signal`, `meta`; можно вернуть компонент или модуль с `default`. Компонент кешируется.
- `beforeEnter` возвращает `true`, `false`, путь/объект маршрута или `Promise` с этим значением; получает `RouteGuardContext` 4-м аргументом.
- `redirect` — строка, объект маршрута или функция `(to) => target`.
- `meta` не интерпретируется роутером и доступен через `matched[i].record.meta` и `RouteLocation.meta`.
- `key` определяет идентификатор компонента для `RouterView`: при смене ключа компонент пересоздаётся.

```ts
import { Route, type QuerySchema, type RouteViewProps } from "@ivlev-dev/silent-router";

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
      <p>{props.meta.section as string}</p>
    </section>
  );
}
```

Для `/edit-7?page=2&active=true&tags=a&tags=b` в `props.query` и `router.query` будут `{ page: 2, active: true, tags: ["a", "b"] }`. Невалидные `number`/`boolean` и отсутствующие ключи дают `undefined` (ключ не попадает в объект). Function-parser получает сырое значение `string | string[] | undefined`. Схемы вложенных маршрутов объединяются от корня к листу.

Object-routes остаются для совместимости:

```ts
import type { RouteRecord } from "@ivlev-dev/silent-router";

const routes: RouteRecord[] = [
  { path: "/", name: "home", component: Home },
  { path: "/users/:id", name: "user", component: User },
];
```

## Guards, загрузчики и отмена

```ts
import { createGuard, type RouteGuardContext } from "@ivlev-dev/silent-router";

const requireAuth = createGuard((context: RouteGuardContext) => {
  if (context.container?.peek(Session)?.authenticated) {
    return true;
  }
  return { name: "login" };
});

class PrivateRoute extends Route {
  readonly path = "/private";
  readonly component = Private;
  readonly beforeEnter = requireAuth;
}

class ReportRoute extends Route {
  readonly path = "/report";
  async load(context: RouteLoadContext<"/report">) {
    if (context.signal.aborted) throw new Error("aborted");
    const module = await import("./report");
    return module.Report;
  }
}
```

Новая навигация вызывает `AbortController.abort()` у предыдущей. Устаревшая навигация завершается без обновления состояния и без отклонения промиса. Если guard вернул `false`, навигация отменяется, а текущий маршрут остаётся прежним.

Ошибки guard и загрузчика оборачиваются в `RouterNavigationError` с `code: "guard" | "load"`; ошибка записи URL в историю — `code: "history"`, некорректная цель/параметр — `code: "resolve"`. Отсутствие роутера у компонента даёт `RouterMissingError`. Прерванная навигация использует `RouterAbortError`. `RouterOptions.onError` вызывается для реальных ошибок, но не для отмены и не для `false` от guard.

```ts
import { RouterNavigationError } from "@ivlev-dev/silent-router";

try {
  await router.push("/private");
} catch (error) {
  if (error instanceof RouterNavigationError) {
    console.error(error.code, error.to, error.cause);
  }
}
```

Глобальные загрузчики:

```ts
const router = new Router({
  routes,
  load: (context) => import("./pages").then((m) => m.default),
});
```

`load` и `resolveComponent` — алиасы. Контекст содержит `record`, поэтому можно выбирать загрузчик по имени маршрута. `record.load` имеет приоритет.

## `navigate()` и обработка ошибок

```ts
const ok = await router.navigate("/private");
const replaced = await router.navigate({ name: "user", params: { id: 7 } }, { replace: true });

router.push("/private"); // бросает RouterNavigationError при ошибке
```

`navigate()` не бросает: при успехе возвращает `true`, при отмене, `false` от guard, no-match, ошибках guard/load/resolve/history — `false` и записывает ошибку в `state.error`. `onError` вызывается для реальных ошибок.

Почему `onClick={() => router.push(...)}` даёт unhandled rejection: `push` возвращает `Promise<void>`, который отклоняется при guard/load/no-match/resolve/history, а `onClick` не ждёт и не обрабатывает промис. В обработчиках используйте `navigate()`:

```tsx
<button onClick={() => void router.navigate("/private")}>Открыть</button>
```

или асинхронный обработчик с `try/catch`:

```tsx
<button onClick={async () => {
  try {
    await router.push("/private");
  } catch (error) {
    console.error(error);
  }
}}>Открыть</button>
```

## Meta

```ts
router.meta; // RouteMeta текущего маршрута
router.route?.meta; // то же через location

const title = router.meta["title"];
```

`RouteLocation.meta` и `IRouter.meta` — объединение `meta` по matched-цепочке от корня к листу. Значения листа перекрывают родительские. `RouteViewProps.meta` содержит итоговый `meta` текущего маршрута. `meta` доступен в guard-контексте через `context.to.meta` и в загрузчиках через `context.meta`.

## Навигация и состояние

```ts
await router.push("/users/42?tab=info#details");
await router.replace({ name: "users" });
router.back();
router.forward();

router.route;
router.params;
router.query;
router.hash;
router.meta;
router.matched;
router.state();
```

`RouterState` содержит `route`, `params`, `query`, `hash`, `matched`, `pending` и `error`. Во время навигации `pending` равен `true`; ошибка сохраняется в `error`, а промис `push`/`replace` отклоняется.

```ts
const location = router.resolve({
  name: "user",
  params: { id: 42 },
  query: { tab: "info" },
});

location.fullPath;
location.matched;
location.meta;

router.href("/users/42");
```

## Вложенные представления

`RouterView` рендерит компонент из `matched[depth]`:

```tsx
export function AdminLayout(props: RouteViewProps) {
  return (
    <section>
      <h1>Админка</h1>
      <RouterView depth={1} router={props.router} />
    </section>
  );
}
```

Route-компонент получает `RouteViewProps`: `route`, `params`, `query`, `hash`, `meta`, `router`. `RouterView` монтирует его через core `component(...)`, поэтому ViewModel с DI работает и на клиенте, и на сервере.

`RouterView` принимает:

- `router?` — явный роутер;
- `depth?` — глубина matched (по умолчанию 0);
- `fallback?` — что рендерить, если компонента нет;
- `container?` — DI-контейнер для разрешения роутера и дочерних компонентов;
- `error?` — слот ошибки: значение или функция `(error) => ...`;
- `notFound?` — слот для ошибки с `code === "no-match"`.

Для ошибки с `code === "no-match"` используется `notFound`, если он задан, иначе `error`. Без слотов показывается `Error: ...`.

```tsx
<RouterView
  container={container}
  fallback={<p>Загрузка…</p>}
  notFound={<NotFoundView />}
  error={(error) => <ErrorView error={error} />}
/>
```

При смене `params`/`query`/`hash` в рамках того же route-компонента view не пересоздаётся: props остаются живыми, DOM, введённый текст и focus сохраняются. При этом у ViewModel вызывается `updated()`, а light-компоненты без ViewModel обновляются через `update()` с восстановлением focus. Пересоздание происходит только при смене компонента маршрута или при смене `key`.

## История и SSR

По умолчанию в браузере создаётся `BrowserHistory`, а вне браузера — `MemoryHistory`. Историю можно передать явно:

```ts
import { Router, createMemoryHistory } from "@ivlev-dev/silent-router";

export function createServerRouter() {
  return new Router({
    routes: [HomeRoute, UsersRoute, UserRoute],
    history: createMemoryHistory("/users/42?tab=info"),
    container: appScope,
  });
}

const router = createServerRouter();
await router.start();
const { html } = await renderToString(App, { container: appScope });
```

На клиенте используйте `BrowserHistory` и тот же набор route-классов:

```ts
import { Router, createBrowserHistory } from "@ivlev-dev/silent-router";

const router = new Router({
  routes: [HomeRoute, UsersRoute, UserRoute],
  history: createBrowserHistory(window),
  container,
});

await router.start();
```

`MemoryHistory` не обращается к `window` и подходит для тестов и SSR. `BrowserHistory` слушает `popstate` и `hashchange`, а `push`/`replace` делегирует `history.pushState`/`replaceState`.

## Скролл

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

Позиция сохраняется при уходе с маршрута и передаётся в `savedPosition` при возврате. Без `scrollBehavior` сохранённая позиция восстанавливается автоматически. Возврат `false` или `null` отменяет прокрутку.

## Тесты

Для тестов используйте `createTestRouter` (по умолчанию `MemoryHistory`):

```ts
import { createTestRouter } from "@ivlev-dev/silent-router";

const router = createTestRouter({ routes, initial: "/users/1" });
await router.start();
await router.navigate("/users/2?tab=posts");

expect(router.params).toEqual({ id: "2" });
expect(router.query).toEqual({ tab: "posts" });
expect(router.hasRoute("/users/2")).toBe(true);
expect(router.isLoaded("/users/2")).toBe(true);
```

`Router.dispose()` снимает подписку на историю и убирает экземпляр из `Router.current()`; переданную извне историю роутер не освобождает.

## Жизненный цикл

```ts
const router = new Router({ routes });
router.start();
router.stop();
router.dispose();
```

`stop()` можно вызывать и вызывать `start()` повторно. `dispose()` не освобождает историю, переданную пользователем: её нужно закрыть самостоятельно.

## Публичный API

- Классы: `Router`, `Route`, `BrowserHistory`, `MemoryHistory`, `RouterMissingError`, `RouterNavigationError`, `RouterAbortError`.
- Интерфейсы и типы: `IRouter`, `RouterOptions`, `RouterState`, `RouteClass`, `RouteDefinition`, `RouteInput`, `RouteViewProps`, `RouteLoadContext`, `RouteClassGuard`, `RouteClassLoad`, `RouteComponent`, `PathParams`, `TypedRouteLocation`, `RouteQueryShape`, `QueryParser`, `QuerySchema`, `RouteRecord`, `RouteLocation`, `MatchedRoute`, `RouteParams`, `RouteQuery`, `RouteQueryValue`, `RouteTarget`, `RouteGuard`, `RouteGuardContext`, `RouteGuardResult`, `RouteLoader`, `RouteLoaderResult`, `RouteRedirect`, `ScrollBehavior`, `ScrollPosition`, `RouterHistory`, `HistoryLocation`, `LinkProps`, `RouterViewProps`, `RouterViewComponentProps`, `RouterComponentLoadContext`, `RouterComponentLoader`, `RouteMeta`, `TestRouterOptions`.
- Компоненты: `Link`, `RouterView`.
- Функции: `createBrowserHistory`, `createMemoryHistory`, `createGuard`, `createTestRouter`.

Публичных hooks (`useRouter`, `useRoute`, `useParams`) нет: состояние доступно через `IRouter` и `RouteViewProps`.