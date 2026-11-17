# @ivlev-dev/silent-router

Роутер Silent Framework: интерфейс `IRouter`, route-классы с типизированными параметрами, вложенные маршруты, guards, ленивые компоненты, DI-доставка, восстановление скролла и SSR через `MemoryHistory`.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-router)](https://www.npmjs.com/package/@ivlev-dev/silent-router) [![license](https://img.shields.io/npm/l/@ivlev-dev/silent-router)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE) [![node](https://img.shields.io/node/v/@ivlev-dev/silent-router)](https://www.npmjs.com/package/@ivlev-dev/silent-router)

## Возможности

- `IRouter` и `Router implements IRouter`; ViewModel получает роутер через `constructor(private readonly router: IRouter)`.
- Route-классы с типизированными `PathParams<"/edit/{id}">` и generic-query, включая mixed-сегменты `edit-{id}-{tab}` и `v{version}.{ext}`.
- Синтаксис `/edit/{id}` и совместимый `:id`, вложенные маршруты, `*`, index-маршруты.
- Runtime-схема query (`QuerySchema`) приводит `number`, `boolean` и массивы; `RouteViewProps.query` и `router.query` содержат уже распарсенные значения.
- `redirect`, синхронные и асинхронные `beforeEnter`, ленивый `load(context)` с кешированием.
- `Link` и `RouterView` получают роутер из DI-контекста синхронно, с fallback на prop и `Router.current()`.
- `RouterView` монтирует route-компоненты через core `component(...)`, поэтому ViewModel/DI работают; при смене `params`/`query` view переиспользуется и сохраняет DOM/focus.
- При гидрации `RouterView` адоптирует серверный маркер, удаляет старую разметку маршрута и рендерит matched-компонент заново.
- `BrowserHistory` (`pushState`, `popstate`, `hashchange`) и `MemoryHistory` для тестов и SSR.
- Повторный переход на текущий путь не дублирует историю и не перезапускает guards/loaders.
- Восстановление скролла: `scrollBehavior(to, from, savedPosition)`.

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

`@ivlev-dev/silent-core`, `@ivlev-dev/silent-di` и `@ivlev-dev/silent-reactivity` устанавливаются как зависимости пакета. Пакет поставляется только как ESM. Требуется Node.js 22 или новее.

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
    <nav>
      <Link to="/" activeClass="active" exactActiveClass="exact">Главная</Link>
      <Link to={{ name: "users" }} activeClass="active">Пользователи</Link>
    </nav>
    <main>
      <RouterView fallback={<p>Загрузка…</p>} />
    </main>
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

`IRouter` содержит `base`, `state()`, `route`, `params`, `query`, `hash`, `matched`, `resolve`, `href`, `prefetch`, `push`, `replace`, `back`, `forward`, `start`, `stop`, `dispose`. В рантайме `IRouter` — value-токен, совпадающий с `Router`, поэтому компилятор DI подставляет его как единственную реализацию.

Зарегистрируйте роутер в контейнере:

```ts
import { container } from "@ivlev-dev/silent-di";

const router = new Router({ routes, container });
```

Или явно:

```ts
const router = new Router({ routes });
router.provide(container);
```

`provide` вызывает `container.bindValue(Router, router)`, поэтому `container.peek(Router)` работает синхронно сразу после регистрации. `container.bind(Router, router)` с готовым экземпляром тоже виден синхронно через `peek`/`peekValue`: non-function значение сразу попадает в resolved-кеш, а function-factory сохраняет прежнее ленивое поведение.

Порядок поиска роутера в `Link` и `RouterView`:

1. явный `router` prop;
2. `getRuntimeOptions().container.peek(Router)`;
3. `Router.current()`.

`Link` не использует асинхронный `resolve`.

## Route-классы

```ts
import { Route, type RouteLoadContext } from "@ivlev-dev/silent-router";

class AdminRoute extends Route {
  readonly path = "/admin";
  readonly name = "admin";
  readonly component = AdminLayout;
  readonly children = [AdminIndexRoute, AdminUserRoute];
  readonly meta = { requiresAuth: true };
  readonly beforeEnter = async (to: RouteLocation, from: RouteLocation | null, signal: AbortSignal) => {
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

`Route` поддерживает `path`, `name`, `component`, `children`, `redirect`, `meta`, `beforeEnter`, `load`.

- `{id}` и `:id` — параметрические сегменты. `PathParams<"/users/{id}">` даёт `{ readonly id: string }`.
- Параметры можно смешивать с литералами внутри одного сегмента: `prefix-{id}`, `edit-{id}-{tab}`, `v{version}.{ext}`. Mixed-сегмент специфичнее чистого параметра и уступает чистому статическому сегменту.
- `Query` — generic-форма query для `RouteViewProps` и `RouteLoadContext`. `query` задаёт runtime-схему (`QueryParser`/`QuerySchema`): `"string"`, `"number"`, `"boolean"`, `"string[]"`, `"number[]"`, `"boolean[]"` или функция `(raw) => value | undefined`.
- `load(context)` получает `route`, `params`, `query`, `hash`, `router`, `signal`; можно вернуть компонент или модуль с `default`. Компонент кешируется.
- `beforeEnter` возвращает `true`, `false`, путь/объект маршрута или `Promise` с этим значением.
- `redirect` — строка, объект маршрута или функция `(to) => target`.
- `meta` не интерпретируется роутером и доступен через `matched[i].record.meta`.

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

Для `/edit-7?page=2&active=true&tags=a&tags=b` в `props.query` и `router.query` будут `{ page: 2, active: true, tags: ["a", "b"] }`. Невалидные `number`/`boolean` и отсутствующие ключи дают `undefined` (ключ не попадает в объект). Function-parser получает сырое значение `string | string[] | undefined`. Схемы вложенных маршрутов объединяются от корня к листу.

Object-routes остаются для совместимости:

```ts
import type { RouteRecord } from "@ivlev-dev/silent-router";

const routes: RouteRecord[] = [
  { path: "/", name: "home", component: Home },
  { path: "/users/:id", name: "user", component: User },
];
```

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

router.href("/users/42");
```

## Guards, загрузчики и отмена

```ts
class PrivateRoute extends Route {
  readonly path = "/private";
  readonly component = Private;
  readonly beforeEnter = async (to: RouteLocation, from: RouteLocation | null, signal: AbortSignal) => {
    if (signal.aborted) return false;
    return (await isAuthorized()) ? true : { name: "login" };
  };
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

Ошибки guard и загрузчика оборачиваются в `RouterNavigationError` с `code: "guard" | "load"`. Отсутствие роутера у компонента даёт `RouterMissingError`. Прерванная навигация использует `RouterAbortError`.

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

Route-компонент получает `RouteViewProps`: `route`, `params`, `query`, `hash`, `router`. `RouterView` монтирует его через core `component(...)`, поэтому ViewModel с DI работает и на клиенте, и на сервере.

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
- Интерфейсы и типы: `IRouter`, `RouterOptions`, `RouterState`, `RouteClass`, `RouteDefinition`, `RouteInput`, `RouteViewProps`, `RouteLoadContext`, `RouteClassGuard`, `RouteClassLoad`, `RouteComponent`, `PathParams`, `TypedRouteLocation`, `RouteQueryShape`, `QueryParser`, `QuerySchema`, `RouteRecord`, `RouteLocation`, `MatchedRoute`, `RouteParams`, `RouteQuery`, `RouteQueryValue`, `RouteTarget`, `RouteGuard`, `RouteLoader`, `RouteRedirect`, `ScrollBehavior`, `ScrollPosition`, `RouterHistory`, `HistoryLocation`, `LinkProps`, `RouterViewProps`, `RouterViewComponentProps`.
- Компоненты: `Link`, `RouterView`.
- Функции создания истории: `createBrowserHistory`, `createMemoryHistory`.

Публичных hooks (`useRouter`, `useRoute`, `useParams`) нет: состояние доступно через `IRouter` и `RouteViewProps`.
