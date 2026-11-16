import { afterEach, describe, expect, it } from "vitest";
import { expectTypeOf } from "vitest";
import type { AnyComponent } from "@ivlev-dev/silent-core";
import {
  Route,
  Router,
  RouterView,
  createMemoryHistory,
  type PathParams,
  type RouteInput,
  type RouteLoadContext,
  type RouteLoaderResult,
  type RouteViewProps,
  type RouterViewComponentProps,
} from "../src/index";
import { leaf, render, type Rendered } from "./support";

const routers: Router[] = [];
const rendered: Rendered[] = [];

function track(router: Router): Router {
  routers.push(router);
  return router;
}

function mount(factory: () => Node): Rendered {
  const result = render(factory);
  rendered.push(result);
  return result;
}

afterEach(() => {
  while (rendered.length > 0) {
    rendered.pop()?.dispose();
  }
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  document.body.replaceChildren();
});

class HomeRoute extends Route {
  readonly path = "/";
  readonly name = "home";
  readonly component = leaf("home");
}

class UsersRoute extends Route {
  readonly path = "/users";
  readonly name = "users";
  readonly component = usersLayout;
  readonly children = [UsersIndexRoute, UserRoute];
}

class UsersIndexRoute extends Route {
  readonly path = "";
  readonly name = "users-index";
  readonly component = leaf("users-index");
}

class UserRoute extends Route<"{id}", { tab?: "info" | "profile" }> {
  readonly path = "{id}";
  readonly name = "user";
  readonly component = userView;
}

class LegacyParamRoute extends Route<"/legacy/:id"> {
  readonly path = "/legacy/:id";
  readonly name = "legacy";
  readonly component = leaf("legacy");
}

class LoginRoute extends Route {
  readonly path = "/login";
  readonly name = "login";
  readonly component = leaf("login");
}

class PrivateRoute extends Route {
  readonly path = "/private";
  readonly name = "private";
  readonly component = leaf("private");

  beforeEnter(): string {
    return "/login";
  }
}

class NewRoute extends Route {
  readonly path = "/new";
  readonly name = "new";
  readonly component = leaf("new");
}

class OldRoute extends Route {
  readonly path = "/old";
  readonly redirect = "/new";
}

function usersLayout(props: RouterViewComponentProps): HTMLElement {
  const section = document.createElement("section");
  section.dataset.view = "users-layout";
  section.appendChild(RouterView({ depth: 1, router: props.router }));
  return section;
}

function userView(
  props: RouteViewProps<"{id}", { tab?: "info" | "profile" }>,
): HTMLElement {
  const element = document.createElement("p");
  element.dataset.view = "user";
  element.dataset.tab = props.query.tab ?? "none";
  element.textContent = `user:${props.params.id}`;
  return element;
}

function createRouter(
  routes: readonly RouteInput[],
  initial = "/",
): Router {
  return track(new Router({
    routes,
    history: createMemoryHistory(initial),
  }));
}

describe("Route-классы", () => {
  it("типизирует path params и query", () => {
    expectTypeOf<PathParams<"/edit/{id}">>().toEqualTypeOf<{ readonly id: string }>();
    expectTypeOf<PathParams<"/users/:id/posts/:postId">>().toEqualTypeOf<{
      readonly id: string;
      readonly postId: string;
    }>();
    expectTypeOf<RouteViewProps<"/edit/{id}", { tab?: "info" }>["params"]>()
      .toEqualTypeOf<{ readonly id: string }>();
    expectTypeOf<RouteViewProps<"/edit/{id}", { tab?: "info" }>["query"]>()
      .toEqualTypeOf<{ tab?: "info" }>();
  });

  it("инстанцирует классы и разбирает {id} и :id", async () => {
    const router = createRouter([HomeRoute, UsersRoute, LegacyParamRoute], "/users/42");
    await router.start();
    expect(router.route?.name).toBe("user");
    expect(router.params).toEqual({ id: "42" });
    expect(router.query).toEqual({});

    const legacy = router.resolve("/legacy/7");
    expect(legacy.name).toBe("legacy");
    expect(legacy.params).toEqual({ id: "7" });

    const typed = router.resolve({
      name: "user",
      params: { id: 9 },
      query: { tab: "info" },
    });
    expect(typed.fullPath).toBe("/users/9?tab=info");
  });

  it("рендерит вложенные route-классы через RouterView", async () => {
    const router = createRouter([HomeRoute, UsersRoute], "/users/7?tab=info");
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    expect(host.querySelector("[data-view=users-layout]")).not.toBeNull();
    expect(host.querySelector("[data-view=user]")?.textContent).toBe("user:7");
    expect(host.querySelector("[data-view=user]")?.getAttribute("data-tab")).toBe("info");
  });

  it("принимает экземпляры route-классов", async () => {
    const instance = new HomeRoute();
    const router = createRouter([instance]);
    await router.start();
    expect(router.route?.name).toBe("home");
  });

  it("выполняет beforeEnter и redirect из route-класса", async () => {
    const router = createRouter([HomeRoute, LoginRoute, PrivateRoute, OldRoute, NewRoute]);
    await router.start();
    await router.push("/private");
    expect(router.route?.name).toBe("login");
    await router.push("/old");
    expect(router.route?.name).toBe("new");
  });

  it("загружает компонент через load(ctx) и кеширует его", async () => {
    let calls = 0;
    let seenRouter: Router | null = null;
    let loadedId = "";

    class LazyRoute extends Route<"/lazy/{id}"> {
      readonly path = "/lazy/{id}";
      readonly name = "lazy";
      async load(context: RouteLoadContext<"/lazy/{id}">): Promise<RouteLoaderResult> {
        calls += 1;
        seenRouter = context.router as Router;
        loadedId = context.params.id;
        const module: { readonly default: AnyComponent } = await Promise.resolve({
          default: leaf("lazy") as AnyComponent,
        });
        return module;
      }
    }

    const router = createRouter([HomeRoute, LazyRoute]);
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    await router.push("/lazy/1");
    expect(host.querySelector("[data-view=lazy]")).not.toBeNull();
    expect(calls).toBe(1);
    expect(seenRouter).toBe(router);
    expect(loadedId).toBe("1");
    await router.push("/lazy/2");
    expect(calls).toBe(1);
    expect(router.params).toEqual({ id: "2" });
  });

  it("сохраняет совместимость с object-routes", async () => {
    const router = track(new Router({
      routes: [
        HomeRoute,
        { path: "/plain", name: "plain", component: leaf("plain") },
      ],
      history: createMemoryHistory("/"),
    }));
    await router.start();
    await router.push("/plain");
    expect(router.route?.name).toBe("plain");
  });
});
