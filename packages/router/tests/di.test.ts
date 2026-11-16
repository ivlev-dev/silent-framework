import { afterEach, describe, expect, it } from "vitest";
import type { AnyComponent } from "@ivlev-dev/silent-core";
import {
  getReady,
  setServerMode,
  withRuntimeOptions,
} from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";
import {
  IRouter,
  Link,
  Route,
  Router,
  RouterView,
  createMemoryHistory,
  type RouteInput,
} from "../src/index";
import { leaf, render, type Rendered } from "./support";

const VIEW = Symbol.for("silent.view");
const DI_CREATE = Symbol.for("silent.di.create");

const routers: Router[] = [];
const containers: Container[] = [];
const rendered: Rendered[] = [];

function track(router: Router): Router {
  routers.push(router);
  return router;
}

function trackContainer(container: Container): Container {
  containers.push(container);
  return container;
}

function mount(factory: () => Node, container?: Container): Rendered {
  const result = render(factory, container === undefined ? undefined : { container });
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
  while (containers.length > 0) {
    containers.pop()?.dispose();
  }
  RouteVM.instances.length = 0;
  setServerMode(false);
  document.body.replaceChildren();
});

class HomeRoute extends Route {
  readonly path = "/";
  readonly name = "home";
  readonly component = leaf("home");
}

class AboutRoute extends Route {
  readonly path = "/about";
  readonly name = "about";
  readonly component = leaf("about");
}

class RouteVM {
  static readonly instances: RouteVM[] = [];

  static [DI_CREATE] = async (container: Container): Promise<RouteVM> => {
    const router = await container.resolve<IRouter>(IRouter);
    return new RouteVM(router);
  };

  constructor(private readonly router: IRouter) {
    RouteVM.instances.push(this);
  }

  get path(): string {
    return this.router.route?.path ?? "";
  }

  uses(router: IRouter): boolean {
    return this.router === router;
  }

  dispose(): void {
    return;
  }
}

function DiView(this: { vm: RouteVM }): HTMLElement {
  const element = document.createElement("p");
  element.dataset.di = "route";
  element.textContent = this.vm.path;
  return element;
}

(DiView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: RouteVM,
  name: "DiView",
};

class DiRoute extends Route {
  readonly path = "/di";
  readonly name = "di";
  readonly component = DiView as unknown as AnyComponent;
}

function createRouter(
  routes: readonly RouteInput[],
  container?: Container,
  initial = "/",
  base?: string,
): Router {
  return track(new Router({
    routes,
    history: createMemoryHistory(initial),
    ...(container === undefined ? {} : { container }),
    ...(base === undefined ? {} : { base }),
  }));
}

describe("DI-доставка роутера", () => {
  it("регистрирует Router в контейнере через опцию container", async () => {
    const container = trackContainer(new Container("app"));
    const router = createRouter([HomeRoute], container);
    await router.start();
    expect(container.peek<Router>(Router)).toBe(router);
  });

  it("поддерживает router.provide и явный container.bind", async () => {
    const container = trackContainer(new Container("app"));
    const provided = createRouter([HomeRoute], undefined, "/");
    provided.provide(container);
    await provided.start();
    expect(container.peek<Router>(Router)).toBe(provided);

    const bound = createRouter([HomeRoute, AboutRoute], undefined, "/about");
    await bound.start();
    container.bind(Router, bound);
    expect(container.peekValue<Router>(Router)).toBe(bound);
    expect(await container.resolve<Router>(Router)).toBe(bound);
    const { host } = mount(() => RouterView({}), container);
    expect(host.querySelector("[data-view=about]")).not.toBeNull();
  });

  it("bind(Router, router) синхронно доступен Link и RouterView без provide и resolve", async () => {
    const container = trackContainer(new Container("app"));
    const router = createRouter([HomeRoute, AboutRoute], undefined, "/about", "/app");
    await router.start();
    container.bind(Router, router);
    expect(container.peekValue(Router)).toBe(router);
    expect(await container.resolve(Router)).toBe(router);

    const view = mount(() => RouterView({}), container);
    expect(view.host.querySelector("[data-view=about]")).not.toBeNull();

    const link = mount(
      () => Link({ to: "/about", children: "О нас" }),
      container,
    );
    expect(link.host.querySelector("a")?.getAttribute("href")).toBe("/app/about");
  });

  it("Link без router prop получает роутер из DI", async () => {
    const container = trackContainer(new Container("app"));
    const router = createRouter([HomeRoute, AboutRoute], container, "/", "/app");
    await router.start();
    const { host } = mount(
      () => Link({ to: "/about", children: "О нас" }),
      container,
    );
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/app/about");
  });

  it("RouterView без router prop получает роутер из DI", async () => {
    const container = trackContainer(new Container("app"));
    const router = createRouter([HomeRoute, AboutRoute], container, "/about");
    await router.start();
    const { host } = mount(() => RouterView({}), container);
    expect(host.querySelector("[data-view=about]")).not.toBeNull();
  });

  it("View-компонент получает IRouter через конструктор ViewModel", async () => {
    const container = trackContainer(new Container("app"));
    const router = createRouter([HomeRoute, DiRoute], container, "/di");
    await router.start();
    const { host } = mount(() => RouterView({}), container);
    await getReady(host);
    await Promise.resolve();
    expect(host.querySelector("[data-di=route]")?.textContent).toBe("/di");
    expect(RouteVM.instances).toHaveLength(1);
    expect(RouteVM.instances[0]?.uses(router)).toBe(true);
  });

  it("явный router prop важнее DI", async () => {
    const container = trackContainer(new Container("app"));
    const injected = createRouter([HomeRoute], container, "/");
    const explicit = createRouter([HomeRoute, AboutRoute], undefined, "/about", "/explicit");
    await injected.start();
    await explicit.start();
    const view = mount(() => RouterView({ router: explicit }), container);
    expect(view.host.querySelector("[data-view=about]")).not.toBeNull();
    const link = mount(
      () => Link({ to: "/about", router: explicit, children: "О нас" }),
      container,
    );
    expect(link.host.querySelector("a")?.getAttribute("href")).toBe("/explicit/about");
  });

  it("работает на SSR с MemoryHistory и view-компонентом", async () => {
    setServerMode(true);
    const container = trackContainer(new Container("ssr"));
    const router = createRouter([HomeRoute, DiRoute], container, "/di");
    await router.start();
    const node = withRuntimeOptions({ container }, () => RouterView({}));
    const host = document.createElement("div");
    host.appendChild(node);
    await getReady(host);
    await Promise.resolve();
    expect(host.querySelector("[data-di=route]")?.textContent).toBe("/di");
    expect(RouteVM.instances[0]?.uses(router)).toBe(true);
  });
});
