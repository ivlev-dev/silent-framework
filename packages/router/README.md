# @ivlev-dev/silent-router

Роутер Silent Framework: вложенные маршруты, параметры и wildcard-сегменты, guards, ленивые компоненты, восстановление скролла и SSR через `MemoryHistory`.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-router)](https://www.npmjs.com/package/@ivlev-dev/silent-router) [![license](https://img.shields.io/npm/l/@ivlev-dev/silent-router)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE) [![node](https://img.shields.io/node/v/@ivlev-dev/silent-router)](https://www.npmjs.com/package/@ivlev-dev/silent-router)

## Возможности

- `Router` с реактивным состоянием: `route`, `params`, `query`, `hash`, `matched`.
- Вложенные маршруты, приоритет по специфичности, `:param`, `*` и index-маршруты.
- `redirect`, синхронные и асинхронные `beforeEnter`, ленивая загрузка через `load`.
- Отмена навигации через `AbortSignal`: новая навигация прерывает предыдущую.
- `Link` без JS: настоящий `<a href>`, перехват только левого клика без модификаторов.
- `RouterView` с параметром `depth` для layout-композиции, реактивным обновлением и освобождением DOM.
- `BrowserHistory` (`pushState`, `popstate`, `hashchange`) и `MemoryHistory` для тестов и SSR.
- Восстановление скролла: `scrollBehavior(to, from, savedPosition)`.
- Несколько приложений на странице: `Router.current()` и явный проп `router` у компонентов.

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

`@ivlev-dev/silent-core` и `@ivlev-dev/silent-reactivity` устанавливаются как зависимости пакета. Пакет поставляется только как ESM. Требуется Node.js 22 или новее.

## Быстрый старт

```tsx
import { Router, RouterView, Link } from "@ivlev-dev/silent-router";
import { Home } from "./home";
import { Users } from "./users";
import { User } from "./user";

export const router = new Router({
  base: "/app",
  routes: [
    { path: "/", name: "home", component: Home },
    {
      path: "/users",
      name: "users",
      component: Users,
      children: [
        { path: "", name: "users-index", component: UsersIndex },
        { path: ":id", name: "user", component: User },
        { path: ":id/posts/:postId", name: "post", component: Post },
      ],
    },
    { path: "/files/*", name: "files", component: Files },
    { path: "/old", redirect: "/" },
  ],
});

await router.start();

export function App() {
  return (
    <nav>
      <Link to="/" activeClass="active" exactActiveClass="exact">Главная</Link>
      <Link to={{ name: "users" }} activeClass="active">Пользователи</Link>
      <Link to="/files/docs/readme.md">Файлы</Link>
    </nav>
    <main>
      <RouterView fallback={<p>Загрузка…</p>} />
    </main>
  );
}
```

`Link` и `RouterView` синхронные. Если на странице несколько приложений, передавайте экземпляр явно:

```tsx
<RouterView router={router} />
<Link router={router} to="/about">О нас</Link>
```

Без явного пропа используется последний созданный `Router` — `Router.current()`.

## Маршруты

```ts
import type { RouteRecord } from "@ivlev-dev/silent-router";

const routes: RouteRecord[] = [
  {
    path: "/admin",
    name: "admin",
    component: AdminLayout,
    meta: { requiresAuth: true },
    beforeEnter: async (to, from, signal) => {
      const allowed = await checkSession(signal);
      return allowed ? true : "/login";
    },
    children: [
      { path: "", name: "admin-index", component: AdminIndex },
      {
        path: "users/:id",
        name: "admin-user",
        load: async () => {
          const module = await import("./admin-user");
          return module.AdminUser;
        },
      },
    ],
  },
];
```

- `path` поддерживает `:param`, `*` (хвост попадает в `params["*"]`) и `""` для index-маршрута.
- При совпадении нескольких записей побеждает более специфичная: статический сегмент важнее `:param`, `:param` важнее `*`, вложенная цепочка важнее одиночного маршрута.
- `load` возвращает компонент или модуль с `default`; загруженный компонент кешируется.
- `beforeEnter` может вернуть `true`, `false`, путь/объект маршрута или `Promise` с этим значением.
- `redirect` может быть строкой, объектом маршрута или функцией `(to) => target`.
- `meta` не интерпретируется роутером и доступен через `matched[i].record.meta`.

## Навигация и состояние

```ts
await router.push("/users/42?tab=info#details");
await router.replace({ name: "users" });
router.back();
router.forward();

router.route;   // RouteLocation | null
router.params;  // { id: "42" }
router.query;   // { tab: "info" }
router.hash;    // "#details"
router.matched; // цепочка RouteRecord от корня до листа

router.state(); // Accessor<RouterState> — читайте в JSX/эффекте для реактивности
```

`RouterState` содержит `route`, `params`, `query`, `hash`, `matched`, `pending` и `error`. Во время навигации `pending` равен `true`; ошибка сохраняется в `error`, а промис `push`/`replace` отклоняется.

`resolve(to)` возвращает `RouteLocation` без навигации:

```ts
const location = router.resolve({ name: "post", params: { id: 42, postId: 7 } });
location.fullPath; // "/users/42/posts/7"
location.matched;  // записи с уже подставленными параметрами
```

`href(to)` возвращает ссылку с учётом `base`:

```ts
router.href("/users/42"); // "/app/users/42"
```

## Guards, загрузчики и отмена

```ts
const router = new Router({
  routes: [
    {
      path: "/private",
      component: Private,
      beforeEnter: async (to, from, signal) => {
        if (signal.aborted) return false;
        return (await isAuthorized()) ? true : { name: "login" };
      },
    },
    {
      path: "/report",
      load: async (_to, signal) => {
        const module = await import("./report");
        if (signal.aborted) throw new Error("aborted");
        return module.Report;
      },
    },
  ],
});
```

Новая навигация вызывает `AbortController.abort()` у предыдущей. Устаревшая навигация завершается без обновления состояния и без отклонения промиса. Если guard вернул `false`, навигация отменяется, а текущий маршрут остаётся прежним.

Ошибки guard и загрузчика оборачиваются в `RouterNavigationError` с `code: "guard" | "load"`. Отсутствие текущего роутера у компонента даёт `RouterMissingError`. Прерванная навигация использует `RouterAbortError` (наследник `RouterNavigationError`).

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
// routes: /admin -> AdminLayout -> /admin/users/:id -> AdminUser
export function AdminLayout(props: RouterViewComponentProps) {
  return (
    <section>
      <h1>Админка</h1>
      <RouterView depth={1} router={props.router} />
    </section>
  );
}
```

Компонент получает пропсы `route`, `params`, `query`, `hash`, `router`. При смене маршрута `RouterView` освобождает старые узлы и создаёт новые; смена `pending` без смены маршрута не вызывает перерисовку.

## История и SSR

По умолчанию в браузере создаётся `BrowserHistory`, а вне браузера — `MemoryHistory`. Историю можно передать явно:

```ts
import { Router, createMemoryHistory } from "@ivlev-dev/silent-router";

export function createServerRouter() {
  return new Router({
    routes,
    history: createMemoryHistory("/users/42?tab=info"),
  });
}

const router = createServerRouter();
await router.start(); // выполняет guards и загрузчики для начального URL
const html = await renderToString(() => <App router={router} />);
```

На клиенте используйте `BrowserHistory` и тот же набор маршрутов:

```ts
import { Router, createBrowserHistory } from "@ivlev-dev/silent-router";

const router = new Router({ routes, history: createBrowserHistory(window) });
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
router.start();  // подписка на историю и навигация на текущий URL
router.stop();   // снять подписку и прервать активную навигацию
router.dispose(); // stop + dispose собственной истории + снять Router.current()
```

`stop()` можно вызывать и вызывать `start()` повторно. `dispose()` не освобождает историю, переданную пользователем: её нужно закрыть самостоятельно.

## Публичный API

- Классы: `Router`, `BrowserHistory`, `MemoryHistory`, `RouterMissingError`, `RouterNavigationError`, `RouterAbortError`.
- Компоненты: `Link`, `RouterView`.
- Функции создания истории: `createBrowserHistory`, `createMemoryHistory`.
- Типы: `RouterOptions`, `RouterState`, `RouteRecord`, `RouteLocation`, `MatchedRoute`, `RouteParams`, `RouteQuery`, `RouteTarget`, `RouteGuard`, `RouteLoader`, `RouteRedirect`, `ScrollBehavior`, `ScrollPosition`, `RouterHistory`, `HistoryLocation`, `LinkProps`, `RouterViewProps`, `RouterViewComponentProps` и связанные результаты guard/loader.

Публичных hooks (`useRouter`, `useRoute`, `useParams`) нет: состояние доступно через экземпляр `Router` и проп `router`.
