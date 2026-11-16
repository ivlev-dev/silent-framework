# Router API

Пакет `@ivlev-dev/silent-router`: класс `Router` и два публичных компонента — `Link` и `RouterView`. Публичных hooks (`useRouter`, `useRoute`, `useParams`) нет.

Экспорты: `Router`, `RouterOptions`, `RouterState`, `BrowserHistory`, `MemoryHistory`, `createBrowserHistory`, `createMemoryHistory`, `HistoryListener`, `HistoryLocation`, `RouterHistory`, `RouterAbortError`, `RouterMissingError`, `RouterNavigationError`, `MatchedRoute`, `QueryInput`, `RouteGuard`, `RouteGuardResult`, `RouteLoader`, `RouteLoaderResult`, `RouteLocation`, `RouteLocationTargetObject`, `RouteMeta`, `RouteParams`, `RouteQuery`, `RouteQueryValue`, `RouteRecord`, `RouteRedirect`, `RouteTarget`, `RouterErrorCode`, `ScrollBehavior`, `ScrollBehaviorResult`, `ScrollPosition`, `Link`, `LinkProps`, `RouterView`, `RouterViewComponentProps`, `RouterViewProps`.

## `Router`

```ts
const router = new Router({
  base: "/app",
  routes: [
    { path: "/", name: "home", component: Home },
    {
      path: "/users",
      component: UsersLayout,
      children: [
        { path: "", name: "users-index", component: UsersIndex },
        { path: ":id", name: "user", component: User },
      ],
    },
  ],
  history: createBrowserHistory(),
  scrollBehavior: (to, from, saved) => saved ?? { top: 0 },
});

await router.start();
```

- `RouterOptions` — `routes`, `base`, `history`, `scrollBehavior`.
- `RouterState` — `route`, `pending`, `error`, `matched`.
- `route`, `params`, `query`, `hash`, `matched`, `state()` — реактивные accessor'ы.
- `push`, `replace`, `back`, `forward` — навигация; `resolve`/`href` — построение URL; `start`/`stop`/`dispose` — жизненный цикл.
- `Router.current()` возвращает последний активный роутер; компоненты принимают явный `router` prop для нескольких приложений.
- `RouteRecord`: `path`, `name`, `component`, `children`, `redirect`, `beforeEnter`, `load`, `meta`.
- `beforeEnter` (`RouteGuard`) возвращает `RouteGuardResult`; `load` (`RouteLoader`) возвращает `RouteLoaderResult` (компонент или модуль с `default`).
- Поддержаны `:param`, `*`, index-маршруты, приоритет по специфичности, вложенные layouts.
- `RouterNavigationError`/`RouterAbortError`/`RouterMissingError`; `RouterErrorCode` уточняет причину.

## `Link`

```tsx
<Link to="/users" activeClass="active" exactActiveClass="exact">Пользователи</Link>
```

`LinkProps`: `to`, `replace`, `activeClass`, `exactActiveClass`, `class`, `children`, `router`. Рендерит настоящий `<a href>`, перехватывает только левый клик без модификаторов, active-классы реактивны.

## `RouterView`

```tsx
<RouterView fallback={<p>Загрузка…</p>} />
<RouterView depth={1} />
```

`RouterViewProps`: `router`, `depth`, `fallback`; `RouterViewComponentProps` описывает props, передаваемые route-компоненту. `RouterView` реактивно переключает matched-компонент и освобождает старый DOM.

## History

```ts
const browser = createBrowserHistory();
const memory = createMemoryHistory("/users/1");
```

`RouterHistory`/`HistoryLocation`/`HistoryListener` — контракт истории; `BrowserHistory` использует `pushState`/`popstate`/`hashchange`, `MemoryHistory` — SSR и тесты.

## SSR

```ts
const router = new Router({
  routes,
  history: createMemoryHistory("/users/1"),
});
await router.start();
const { html, head } = await renderToString(App, {
  container: appScope,
});
```

`Router` с `MemoryHistory` детерминирован на сервере; `Link` отдаёт обычные `href`, `RouterView` рендерит matched-компонент. На клиенте создайте `BrowserHistory` и тот же набор routes.
