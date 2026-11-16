# Router API

Пакет `@ivlev-dev/silent-router` строится вокруг интерфейса `IRouter`, класса `Router`, route-классов `Route` и двух публичных компонентов — `Link` и `RouterView`. Публичных hooks (`useRouter`, `useRoute`, `useParams`) нет.

Экспорты: `Router`, `IRouter`, `RouterOptions`, `RouterState`, `Route`, `RouteClass`, `RouteDefinition`, `RouteInput`, `RouteViewProps`, `RouteLoadContext`, `RouteClassGuard`, `RouteClassLoad`, `RouteComponent`, `PathParams`, `TypedRouteLocation`, `RouteQueryShape`, `QueryParser`, `QuerySchema`, `AnyRouteGuard`, `AnyRouteLoader`, `BrowserHistory`, `MemoryHistory`, `createBrowserHistory`, `createMemoryHistory`, `HistoryListener`, `HistoryLocation`, `RouterHistory`, `RouterAbortError`, `RouterMissingError`, `RouterNavigationError`, `MatchedRoute`, `QueryInput`, `RouteGuard`, `RouteGuardResult`, `RouteLoader`, `RouteLoaderResult`, `RouteLocation`, `RouteLocationTargetObject`, `RouteMeta`, `RouteParams`, `RouteQuery`, `RouteQueryValue`, `RouteRecord`, `RouteRedirect`, `RouteTarget`, `RouterErrorCode`, `ScrollBehavior`, `ScrollBehaviorResult`, `ScrollPosition`, `Link`, `LinkProps`, `RouterView`, `RouterViewComponentProps`, `RouterViewProps`.

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

`IRouter` содержит `base`, `state()`, `route`, `params`, `query`, `hash`, `matched`, `resolve`, `href`, `prefetch`, `push`, `replace`, `back`, `forward`, `start`, `stop`, `dispose`. `Router implements IRouter`. В рантайме `IRouter` — это value-токен, совпадающий с `Router`, поэтому компилятор DI может подставить его напрямую.

## `Router`

```ts
const router = new Router({
  base: "/app",
  routes: [HomeRoute, UsersRoute, UserRoute],
  history: createBrowserHistory(),
});

await router.start();
```

- `RouterOptions` — `routes`, `base`, `history`, `scrollBehavior`, `container`.
- `RouterState` — `route`, `params`, `query`, `hash`, `matched`, `pending`, `error`.
- `route`, `params`, `query`, `hash`, `matched`, `state()` — реактивные accessor'ы.
- `push`, `replace`, `back`, `forward` — навигация; `resolve`/`href` — построение URL; `start`/`stop`/`dispose` — жизненный цикл.
- `Router.current()` возвращает последний активный роутер и остаётся fallback для компонентов без DI и `router` prop.

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
2. `getRuntimeOptions().container.peek(Router)` из DI-контекста;
3. `Router.current()`.

Асинхронный `resolve` для `Link` не используется.

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

`Route` поддерживает `path`, `name`, `component`, `children`, `redirect`, `meta`, `beforeEnter`, `load`. `RouterOptions.routes` принимает route-классы, их экземпляры и старые object-routes; классы инстанцируются роутером.

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

`load(context)` получает `route`, `params`, `query`, `hash`, `router` и `signal`. Загрузчик может вернуть компонент или модуль с `default`; результат кешируется по route-record. `beforeEnter` может вернуть `true`, `false`, путь/объект маршрута или `Promise` с этим значением. `redirect` может быть строкой, объектом маршрута или функцией `(to) => target`.

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

## `Link`

```tsx
<Link to="/users" activeClass="active" exactActiveClass="exact">Пользователи</Link>
<Link to={{ name: "user", params: { id: 42 }, query: { tab: "info" } }}>Профиль</Link>
```

`LinkProps`: `to`, `replace`, `activeClass`, `exactActiveClass`, `class`, `children`, `router?: IRouter`, `prefetch?: boolean`. `prefetch` вызывает `router.prefetch` на `pointerenter`/`focus` и загружает lazy-компонент заранее. Рендерит настоящий `<a href>`, перехватывает только левый клик без модификаторов, active-классы реактивны.

## `RouterView`

```tsx
<RouterView fallback={<p>Загрузка…</p>} />
<RouterView depth={1} />
<RouterView router={router} />
```

`RouterViewProps`: `router?: IRouter`, `depth`, `fallback`. `RouterView` берёт matched-компонент по глубине и монтирует его через core `component(...)`, поэтому route-компоненты с ViewModel и DI работают штатно. Компонент получает `RouteViewProps`: `route`, `params`, `query`, `hash`, `router`. Старый `RouterViewComponentProps` — alias на `RouteViewProps`.

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
const { html, head } = await renderToString(App, {
  container: appScope,
});
```

`MemoryHistory` детерминирован на сервере; `Link` отдаёт обычные `href`, `RouterView` рендерит matched-компонент, включая view-компоненты с ViewModel, получающие `IRouter` из DI. На клиенте создайте `BrowserHistory` и тот же набор route-классов.

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

Позиция сохраняется при уходе с маршрута и передаётся в `savedPosition` при возврате. Без `scrollBehavior` сохранённая позиция восстанавливается автоматически. Возврат `false` или `null` отменяет прокрутку.

`RouterNavigationError` содержит `code` (`abort`, `guard`, `load`, `no-match`, `redirect`, `resolve`) и `to`; `RouterAbortError` — прерванная навигация; `RouterMissingError` — отсутствие роутера у `Link`/`RouterView`.

## Жизненный цикл

```ts
router.start();
router.stop();
router.dispose();
```

`stop()` снимает подписку на историю и прерывает активную навигацию; `start()` можно вызывать повторно. `dispose()` дополнительно освобождает собственную историю и убирает роутер из `Router.current()`. История, переданная пользователем, не освобождается.
