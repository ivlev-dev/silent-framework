// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { AnyComponent } from "@ivlev-dev/silent-core";
import { getReady, hydrate, insert, setServerMode, templateHoles, withRuntimeOptions } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { Container } from "@ivlev-dev/silent-di";
import {
  IRouter,
  Router,
  RouterView,
  createMemoryHistory,
  type RouteInput,
} from "../src/index";
import { leaf, render, tick, type Rendered } from "./support";

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

class Session {
  constructor(readonly user: string) {}
}

class LayoutVM {
  static readonly instances: LayoutVM[] = [];

  static [DI_CREATE] = async (container: Container): Promise<LayoutVM> => {
    const session = await container.resolve<Session>(Session);
    const router = await container.resolve<IRouter>(IRouter);
    return new LayoutVM(session, router);
  };

  constructor(
    private readonly session: Session,
    private readonly router: IRouter,
  ) {
    LayoutVM.instances.push(this);
  }

  get user(): string {
    return this.session.user;
  }

  uses(session: Session, router: IRouter): boolean {
    return this.session === session && this.router === router;
  }
}

class ChildVM {
  static readonly instances: ChildVM[] = [];

  static [DI_CREATE] = async (container: Container): Promise<ChildVM> => {
    const session = await container.resolve<Session>(Session);
    const router = await container.resolve<IRouter>(IRouter);
    return new ChildVM(session, router);
  };

  constructor(
    private readonly session: Session,
    private readonly router: IRouter,
  ) {
    ChildVM.instances.push(this);
  }

  get user(): string {
    return this.session.user;
  }

  uses(session: Session, router: IRouter): boolean {
    return this.session === session && this.router === router;
  }
}

function LayoutView(this: { vm: LayoutVM }): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("data-view", "layout");
  section.setAttribute("data-user", this.vm.user);
  section.appendChild(RouterView({ depth: 1 }));
  return section;
}

(LayoutView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: LayoutVM,
  name: "LayoutView",
};

function ChildView(this: { vm: ChildVM }): HTMLElement {
  const article = document.createElement("article");
  article.setAttribute("data-view", "child");
  article.setAttribute("data-user", this.vm.user);
  return article;
}

(ChildView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: ChildVM,
  name: "ChildView",
};

function AppShell(): HTMLElement {
  const main = document.createElement("main");
  main.setAttribute("data-view", "app");
  main.appendChild(RouterView({}));
  return main;
}

class AppVM {
  static [DI_CREATE] = async (): Promise<AppVM> => new AppVM();
}

function AppView(this: { vm: AppVM }): HTMLElement {
  void this.vm;
  return AppShell();
}

(AppView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: AppVM,
  name: "AppView",
};

const appTemplate = templateHoles('<main data-view="app"><!--silent-hole-0--></main>');
const layoutTemplate = templateHoles('<section data-view="layout"><!--silent-hole-0--></section>');

function HydratedApp(this: { vm: AppVM }): Node {
  void this.vm;
  const root = appTemplate();
  insert(root.holes[0]?.parentNode ?? root.node, () => RouterView({}), root.holes[0]);
  return root.node;
}

(HydratedApp as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: AppVM,
  name: "HydratedApp",
};

class HydratedLayoutVM {
  static [DI_CREATE] = async (): Promise<HydratedLayoutVM> => new HydratedLayoutVM();
}

function HydratedLayout(this: { vm: HydratedLayoutVM }): Node {
  void this.vm;
  const root = layoutTemplate();
  insert(root.holes[0]?.parentNode ?? root.node, () => RouterView({ depth: 1 }), root.holes[0]);
  return root.node;
}

(HydratedLayout as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: HydratedLayoutVM,
  name: "HydratedLayout",
};

function HydratedChild(): HTMLElement {
  const article = document.createElement("article");
  article.setAttribute("data-view", "hydrated-child");
  article.textContent = "hydrated child";
  return article;
}

const hydrationRoutes: readonly RouteInput[] = [
  {
    path: "/app",
    name: "hydrated-app",
    component: HydratedLayout as unknown as AnyComponent,
    children: [
      {
        path: "child",
        name: "hydrated-child",
        load: async (): Promise<AnyComponent> => HydratedChild as unknown as AnyComponent,
      },
    ],
  },
];

function createHydrationRouter(initial: string, container?: Container): Router {
  return track(new Router({
    routes: hydrationRoutes,
    history: createMemoryHistory(initial),
    ...(container === undefined ? {} : { container }),
  }));
}

const routes: readonly RouteInput[] = [
  { path: "/login", name: "login", component: leaf("login") },
  {
    path: "/app",
    name: "app",
    component: LayoutView as unknown as AnyComponent,
    children: [
      {
        path: "child",
        name: "child",
        load: async (): Promise<AnyComponent> => ChildView as unknown as AnyComponent,
      },
    ],
  },
];

function createRouter(initial: string, container?: Container): Router {
  return track(new Router({
    routes,
    history: createMemoryHistory(initial),
    ...(container === undefined ? {} : { container }),
  }));
}

async function settle(host: HTMLElement): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await getReady(host);
    await tick();
  }
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
  LayoutVM.instances.length = 0;
  ChildVM.instances.length = 0;
  setServerMode(false);
  document.body.replaceChildren();
});

describe("RouterView: DI-область", () => {
  it("сохраняет контейнер для вложенного layout и ленивого child", async () => {
    const container = trackContainer(new Container("app"));
    const session = new Session("ivlev");
    container.bindValue(Session, session);
    const router = createRouter("/login");
    await router.start();
    container.bindValue(Router, router);

    const { host } = mount(() => AppShell(), container);
    expect(host.querySelector("[data-view=login]")).not.toBeNull();

    await router.push("/app/child");
    await settle(host);

    expect(host.querySelector("[data-view=layout]")?.getAttribute("data-user")).toBe("ivlev");
    expect(host.querySelector("[data-view=child]")?.getAttribute("data-user")).toBe("ivlev");
    expect(LayoutVM.instances).toHaveLength(1);
    expect(ChildVM.instances).toHaveLength(1);
    expect(LayoutVM.instances[0]?.uses(session, router)).toBe(true);
    expect(ChildVM.instances[0]?.uses(session, router)).toBe(true);
    expect(container.peek<Session>(Session)).toBe(session);
  });

  it("использует переданный container даже при другом container в runtime options", async () => {
    const outer = trackContainer(new Container("outer"));
    const inner = trackContainer(new Container("inner"));
    const outerRouter = createRouter("/login");
    const innerRouter = track(new Router({
      routes: [{ path: "/", name: "home", component: leaf("inner") }],
      history: createMemoryHistory("/"),
    }));
    await outerRouter.start();
    await innerRouter.start();
    outer.bindValue(Router, outerRouter);
    inner.bindValue(Router, innerRouter);

    const { host } = mount(() => RouterView({ container: inner }), outer);
    expect(host.querySelector("[data-view=inner]")).not.toBeNull();
    expect(host.querySelector("[data-view=login]")).toBeNull();
  });

  it("гидрирует layout и ленивый child с тем же DI-контейнером", async () => {
    const serverContainer = trackContainer(new Container("ssr-hydrate"));
    const serverSession = new Session("hydrated-user");
    serverContainer.bindValue(Session, serverSession);
    const serverRouter = createHydrationRouter("/app/child");
    serverContainer.bindValue(Router, serverRouter);
    await serverRouter.start();

    const rendered = await renderToString(HydratedApp as unknown as AnyComponent, {
      container: serverContainer,
    });
    expect(rendered.html).toContain("hydrated child");

    const root = document.createElement("div");
    root.innerHTML = rendered.html;
    document.body.appendChild(root);

    const clientContainer = trackContainer(new Container("client-hydrate"));
    clientContainer.bindValue(Session, new Session("hydrated-user"));
    const clientRouter = createHydrationRouter("/app/child");
    clientContainer.bindValue(Router, clientRouter);
    await clientRouter.start();

    const mismatches: string[] = [];
    const handle = await hydrate(root, HydratedApp as unknown as AnyComponent, {
      container: clientContainer,
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    await handle.ready;
    await settle(root);

    expect(root.querySelector("[data-view=layout]")).not.toBeNull();
    expect(root.querySelector("[data-view=hydrated-child]")?.textContent).toBe("hydrated child");
    expect(mismatches).toEqual([]);
    handle.dispose();
  });

  it("резолвит вложенный layout и ленивый child на SSR", async () => {
    setServerMode(true);
    const container = trackContainer(new Container("ssr"));
    const session = new Session("ssr-user");
    container.bindValue(Session, session);
    const router = createRouter("/app/child");
    await router.start();
    container.bindValue(Router, router);

    const node = withRuntimeOptions({ container }, () => RouterView({}));
    const host = document.createElement("div");
    host.appendChild(node);
    await settle(host);

    expect(host.querySelector("[data-view=layout]")?.getAttribute("data-user")).toBe("ssr-user");
    expect(host.querySelector("[data-view=child]")?.getAttribute("data-user")).toBe("ssr-user");
    expect(LayoutVM.instances.at(-1)?.uses(session, router)).toBe(true);
    expect(ChildVM.instances.at(-1)?.uses(session, router)).toBe(true);
  });
});
