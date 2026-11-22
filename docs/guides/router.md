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

`LinkProps`: `to`, `replace`, `activeClass`, `exactActiveClass`, `class`, `children`, `router`, `prefetch`, `exactQuery`.

- рендерит настоящий `<a href>` и перехватывает только левый клик без модификаторов;
- `activeClass` — префиксное совпадение, `exactActiveClass` — точное;
- на точный активный маршрут ставит `aria-current="page"`;
- внешние URL (`http(s)://`, `mailto:`, `tel:`, `//`) и hash-ссылки не перехватываются;
- обратные слэши нормализуются в `/`; цель, которая после нормализации становится protocol-relative (`/\evil.com`), считается небезопасной и получает `href` без значения;
- если маршрут для внутренней строки не найден, `href` всё равно строится с `base` (`/app/nope`), но active-классы и `aria-current` не применяются; для объектной цели `href` не выставляется;
- `prefetch: true | "hover"` заранее загружает lazy-маршрут на `pointerenter`, `pointerdown` и `focus`, `prefetch: "visible"` — при появлении во viewport.

```tsx
<Link to={{ name: "user", params: { id: 42 }, query: { tab: "posts" } }}>
  Профиль
</Link>
<Link to="/lazy" prefetch>Ленивый маршрут</Link>
<Link to="/users" prefetch="visible">Пользователи</Link>
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

`RouterState` содержит `route`, `params`, `query`, `hash`, `matched`, `pending`, `error`. Пока идёт навигация, `pending === true`; ошибка сохраняется в `error`, а промис `push`/`replace` отклоняется `RouterNavigationError` с `code`: `abort`, `guard`, `history`, `load`, `no-match`, `redirect`, `resolve`.

### Канонизация и параметры

Строковые цели и `base` приводятся к той же форме, что использует браузер: обратные слэши (`/users\..\about`) считаются разделителями, пустые сегменты схлопываются, `.` и `..` (включая `%2e`/`%2e%2e`) разрешаются, завершающий слэш снимается. Поэтому `router.resolve("/users/../about").path === "/about"`, а `history` получает уже канонический URL.

- Отсутствующий, `""`, `"."` и `".."` параметр запрещён: `resolve`/`href`/`push` бросают `RouterNavigationError` с `code: "resolve"`. Это защищает от расхождения состояния роутера и адресной строки.
- Lone surrogate в параметре не бросает ошибку: `toWellFormed()` заменяет его на `U+FFFD`, и в `params` приходит уже заменённое значение.
- Переход только по hash (`router.push("#section")` или `{ hash: "#section" }`) сохраняет сырой query текущего `fullPath`, даже если схема отбросила невалидные для неё параметры.
- Если `history.push`/`replace` бросает (`SecurityError`, `DataCloneError`, cross-origin URL), навигация отклоняется `RouterNavigationError` с `code: "history"`; текущий маршрут не меняется, `state.error` заполняется, `onError` вызывается.

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

Порядок поиска роутера в `Link`/`RouterView`: явный `router` prop → `getRuntimeOptions().container.peek(Router)` → `Router.current()` только на клиенте и без контейнера. В серверном рендере без `router` prop и контейнера бросается `RouterMissingError`.

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

В серверном рендере `Link` и `RouterView` не используют глобальный реестр `Router.current()`: передайте им `router` prop или зарегистрируйте роутер в контейнере (`new Router({ container })`/`router.provide(container)`), иначе бросается `RouterMissingError`.

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

## Установка (peer-зависимости)

```bash
pnpm add @ivlev-dev/silent-router
```

`@ivlev-dev/silent-core`, `@ivlev-dev/silent-di` и `@ivlev-dev/silent-reactivity` — peer-зависимости с диапазоном `>=0.12.0 <0.13.0`. Пакет ESM-only, Node.js 22+.

## Рецепт: Router + DI + layout + lazy pages + login guard

### 1. Сервисы и контейнер

```ts
import { Container } from "@ivlev-dev/silent-di";
import { Router, createMemoryHistory } from "@ivlev-dev/silent-router";
import { Session } from "./session";
import { routes } from "./routes";

export function createAppServices(url = "/") {
  const container = new Container("app", undefined, { implicitBindings: "error" });
  const session = new Session(null);
  const router = new Router({ routes, history: createMemoryHistory(url) });

  container.bindValue(Session, session);
  container.bindValue(Router, router);

  return { container, session, router };
}
```

Контейнер работает в строгом режиме: любая зависимость без явного биндинга бросает `MissingBindingError`. `Router` и `Session` регистрируются через `bindValue`, чтобы `peek` работал синхронно в `Link`, `RouterView` и view-model.

### 2. Маршруты, layout и lazy child

```ts
import { Route, type RouteInput } from "@ivlev-dev/silent-router";
import { requireAuth } from "./guards";
import { HomeView, CabinetLayout, NotFoundView } from "./views";

export class HomeRoute extends Route {
  readonly path = "/";
  readonly name = "home";
  readonly component = HomeView;
  readonly meta = { title: "Главная" };
}

export class ProfileRoute extends Route {
  readonly path = "profile";
  readonly name = "profile";
  readonly meta = { title: "Профиль" };

  async load() {
    const module = await import("./profile");
    return module.default;
  }
}

export class CabinetRoute extends Route {
  readonly path = "/cabinet";
  readonly name = "cabinet";
  readonly component = CabinetLayout;
  readonly beforeEnter = requireAuth;
  readonly meta = { title: "Кабинет" };
  readonly children: readonly RouteInput[] = [ProfileRoute];
}

export class NotFoundRoute extends Route<"*"> {
  readonly path = "*";
  readonly name = "not-found";
  readonly component = NotFoundView;
}

export const routes: readonly RouteInput[] = [HomeRoute, CabinetRoute, NotFoundRoute];
```

`ProfileRoute` загружается лениво через `load()`. Альтернатива — глобальный загрузчик в `RouterOptions.load`/`resolveComponent`, если ленивых страниц много.

### 3. Guard через `createGuard` и `context.container`

```ts
import { createGuard } from "@ivlev-dev/silent-router";
import { Session } from "./session";

export const requireAuth = createGuard(({ container, to }) => {
  const session = container?.peek<Session>(Session);
  if (session === undefined) {
    throw new Error("Session не забинжена в контейнер");
  }
  if (session.authenticated) {
    return true;
  }
  return `/login?next=${encodeURIComponent(to.fullPath)}`;
});
```

Guard не обращается к глобальному состоянию: контейнер приходит из `RouteGuardContext`.

### 4. App и layout

```tsx
import { Link, RouterView } from "@ivlev-dev/silent-router";

export function App() {
  return (
    <main>
      <RouterView
        fallback={<p>Загрузка…</p>}
        notFound={<NotFoundView />}
        error={(error) => <ErrorView error={error} />}
      />
    </main>
  );
}

export function CabinetLayout() {
  return (
    <section>
      <h1>Кабинет</h1>
      <RouterView depth={1} fallback={<p>Выберите раздел</p>} />
    </section>
  );
}
```

`App` использует `RouterView` без `router` prop: роутер разрешается из контейнера runtime-опций. `CabinetLayout` рендерит дочерний маршрут через `RouterView depth={1}` тоже без `router` prop.

### 5. `navigate()` в обработчиках

```ts
import type { IRouter } from "@ivlev-dev/silent-router";

export class LoginVM {
  constructor(
    private readonly router: IRouter,
    private readonly session: Session,
  ) {}

  async submit(next: string): Promise<void> {
    this.session.login("Алиса");
    await this.router.navigate(next);
  }
}
```

```tsx
<button onClick={() => void router.navigate("/cabinet")}>В кабинет</button>
```

`push()`/`replace()` бросают `RouterNavigationError` при guard/load/no-match/resolve/history, поэтому в `onClick` без обработки промиса возникает unhandled rejection. В обработчиках используйте `navigate()`, а `push()` — в async-функциях с `try/catch`.

### 6. Тестовый рецепт с `createTestRouter`

```ts
import { createTestRouter } from "@ivlev-dev/silent-router";

const { container, router } = createAppServices("/");
await router.start();

const testRouter = createTestRouter({
  routes,
  initial: "/",
  load: (context) => import("./profile").then((m) => m.default),
});

expect(testRouter.hasRoute("/cabinet/profile")).toBe(true);
expect(testRouter.isLoaded("/cabinet/profile")).toBe(false);

await testRouter.navigate("/cabinet/profile");
expect(testRouter.isLoaded("/cabinet/profile")).toBe(true);
```

`createTestRouter` принимает `routes`, `initial?`, `history?` и остальные `RouterOptions`; по умолчанию использует `MemoryHistory`.
