# Роутер: практический гайд

`@ivlev-dev/silent-router` — отдельный пакет: класс `Router`, route-классы, два публичных компонента (`Link` и `RouterView`) и интерфейс `IRouter` для DI. Публичных hooks (`useRouter`, `useRoute`, `useParams`) нет: роутер приходит через props или DI.

Справочник сигнатур — [`docs/api/router.md`](../api/router.md). Полный пример — [`examples/router`](../../examples/router).

## Установка

```bash
pnpm add @ivlev-dev/silent-router
```

Пакет ESM-only и совместим с браузером, SSR и тестами (`MemoryHistory`).

## Быстрый старт

### 1. Маршруты

```tsx
import { Route, type RouteInput, type RouteViewProps } from "@ivlev-dev/silent-router";

type UserTab = "info" | "posts";

export class HomeRoute extends Route {
  readonly path = "/";
  readonly name = "home";
  readonly component = HomeView;
}

export class UserRoute extends Route<"/users/{id}", { tab?: UserTab }> {
  readonly path = "/users/{id}";
  readonly name = "user";
  readonly component = UserView;
  readonly query = {
    tab: (raw: string | string[] | undefined): UserTab | undefined =>
      raw === "info" || raw === "posts" ? raw : undefined,
  };
}

export class NotFoundRoute extends Route<"*"> {
  readonly path = "*";
  readonly name = "not-found";
  readonly component = NotFoundView;
}

export const routes: readonly RouteInput[] = [
  HomeRoute,
  UserRoute,
  NotFoundRoute,
];
```

`PathParams<"/users/{id}">` даёт `{ id: string }`. Поддерживаются `:id`, `{id}`, mixed-сегменты (`edit-{id}-{tab}`), wildcard `*` и вложенные `children`. Wildcard имеет самый низкий приоритет: корень `/` всегда достаётся статическому маршруту.

### 2. Приложение

```tsx
import { Link, RouterView } from "@ivlev-dev/silent-router";

export function App() {
  return (
    <div class="app">
      <nav>
        <Link to="/" activeClass="active" exactActiveClass="active-exact">
          Главная
        </Link>
        <Link to="/users/1" activeClass="active">
          Пользователь
        </Link>
      </nav>
      <main>
        <RouterView fallback={<p>Маршрут не найден</p>} />
      </main>
    </div>
  );
}
```

### 3. Точка входа

```tsx
import { mount } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";
import { Router } from "@ivlev-dev/silent-router";
import { App } from "./app";
import { routes } from "./routes";

const container = new Container("app");
const router = new Router({ routes, container });
await router.start();

void mount(document.querySelector("#app")!, App, { container });
```

`container` в опциях роутера сразу регистрирует экземпляр (`router.provide(container)`), поэтому `Link`, `RouterView` и ViewModel находят `IRouter` без ручной привязки.

## Link

`LinkProps`: `to`, `replace`, `activeClass`, `exactActiveClass`, `class`, `children`, `router`, `prefetch`.

- рендерит настоящий `<a href>` и перехватывает только левый клик без модификаторов;
- `activeClass` — префиксное совпадение, `exactActiveClass` — точное;
- на точный активный маршрут ставит `aria-current="page"`;
- внешние URL (`http(s)://`, `mailto:`, `tel:`, `//`) и hash-ссылки не перехватываются;
- `prefetch` заранее загружает lazy-маршрут на `pointerenter`, `pointerdown` и `focus`.

```tsx
<Link to={{ name: "user", params: { id: 42 }, query: { tab: "posts" } }}>
  Профиль
</Link>
<Link to="/lazy" prefetch>Ленивый маршрут</Link>
```

Повторный переход на текущий `fullPath` (с учётом query и hash) не создаёт запись в истории и не перезапускает guards/loaders — клик по активной ссылке безопасен.

## Программная навигация

```ts
await router.push({ name: "user", params: { id: 7 } });
await router.replace("/login");
router.back();
router.forward();

router.resolve("/users/7"); // RouteLocation без навигации
router.href("/users/7");    // строка с учётом base
```

`RouterState` содержит `route`, `params`, `query`, `hash`, `matched`, `pending`, `error`. Пока идёт навигация, `pending === true`; ошибка сохраняется в `error`, а промис `push`/`replace` отклоняется `RouterNavigationError` с `code`: `abort`, `guard`, `load`, `no-match`, `redirect`, `resolve`.

## Guards, redirect и loaders

```ts
class AdminRoute extends Route {
  readonly path = "/admin";
  readonly component = AdminView;
  readonly meta = { requiresAuth: true };

  readonly beforeEnter = (to: RouteLocation, from: RouteLocation | null) =>
    isAuthorized() ? true : "/login";

  readonly redirect = "/dashboard";
}

class UserRoute extends Route<"/users/{id}"> {
  readonly path = "/users/{id}";

  async load(context: RouteLoadContext<"/users/{id}">) {
    const module = await import("./user-view");
    return module.default;
  }
}
```

- `beforeEnter` может вернуть `true`, `false`, путь/объект маршрута или `Promise`;
- `redirect` — строка, объект или функция `(to) => target`;
- `load(context)` получает `route`, `params`, `query`, `hash`, `router` и `signal`, возвращает компонент или модуль с `default`; результат кешируется по route-record;
- guard получает `AbortSignal` и должен учитывать отмену навигации.

## ViewModel и DI

```ts
import { ViewModel } from "@ivlev-dev/silent-core";
import type { IRouter } from "@ivlev-dev/silent-router";

export class UserVM extends ViewModel<{ params: { id: string } }> {
  constructor(private readonly router: IRouter) {
    super();
  }

  next(): void {
    void this.router.push({
      name: "user",
      params: { id: Number(this.props.params.id) + 1 },
    });
  }
}
```

Порядок поиска роутера в `Link`/`RouterView`: явный `router` prop → `getRuntimeOptions().container.peek(Router)` → `Router.current()`.

`RouterView` монтирует matched-компонент по `depth` и передаёт `RouteViewProps`: `route`, `params`, `query`, `hash`, `router`. При смене `params`/`query`/`hash` в рамках того же компонента view **не пересоздаётся**: props остаются живыми, DOM, введённый текст и focus сохраняются. У ViewModel вызывается `updated()`, light-компоненты обновляются через `update()`. Пересоздание — только при смене route-компонента.

```tsx
<RouterView depth={1} fallback={<p>Загрузка…</p>} />
```

## SSR и гидрация

На сервере используйте `MemoryHistory` с URL запроса и отдельный DI-контейнер на запрос:

```ts
const container = new Container("request");
const router = new Router({
  routes,
  history: createMemoryHistory(url),
  container,
});
await router.start();

const { html, head } = await renderToString(App, { container });
```

На клиенте — `BrowserHistory` и `hydrate`:

```ts
const container = new Container("app");
const router = new Router({
  routes,
  history: createBrowserHistory(),
  container,
});
await router.start();

void hydrate(document.querySelector("#app")!, App, { container });
```

`RouterView` гидрируется через собственный серверный маркер `silent-router-view`: устаревшая разметка маршрута удаляется, matched-компонент рендерится заново в это место. Разметка маршрута при этом не адоптируется — это осознанный компромисс; остальное дерево приложения гидрируется обычно.

## Прокрутка

Без `scrollBehavior` роутер восстанавливает сохранённую позицию при back/forward, а при непустом `hash` прокручивает элемент с соответствующим `id` (или `name`):

```ts
await router.push("/docs#install");
```

Своё поведение задаётся функцией; она полностью управляет прокруткой, включая hash:

```ts
const router = new Router({
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition !== null) return savedPosition;
    if (to.hash !== "") return null; // свою логику hash обрабатывайте здесь
    return { left: 0, top: 0 };
  },
});
```

Возврат `false` или `null` отменяет прокрутку.

## Тесты

Для тестов используйте `MemoryHistory` и `Router` без браузера:

```ts
const router = new Router({ routes, history: createMemoryHistory("/users/1") });
await router.start();
await router.push("/users/2?tab=posts");
expect(router.params).toEqual({ id: "2" });
expect(router.query).toEqual({ tab: "posts" });
```

`Router.dispose()` снимает подписку на историю и убирает экземпляр из `Router.current()`; переданную извне историю роутер не освобождает.
