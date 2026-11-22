import { afterEach, describe, expect, it } from "vitest";
import { attr, setServerMode } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";
import { onCleanup } from "@ivlev-dev/silent-reactivity";
import {
  Router,
  RouterMissingError,
  RouterView,
  createMemoryHistory,
  type RouteRecord,
  type RouterViewComponentProps,
} from "../src/index";
import { leaf, render, tick, view, type Rendered } from "./support";

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
  setServerMode(false);
  document.body.replaceChildren();
});

function layout(props: RouterViewComponentProps): HTMLElement {
  const section = document.createElement("section");
  section.dataset.view = "layout";
  section.appendChild(RouterView({ depth: 1, router: props.router }));
  return section;
}

let cleanups = 0;

function cleanupView(): HTMLElement {
  onCleanup(() => {
    cleanups += 1;
  });
  const element = document.createElement("div");
  element.dataset.view = "cleanup";
  return element;
}

function metaView(props: RouterViewComponentProps): HTMLElement {
  const element = document.createElement("div");
  element.dataset.view = "meta";
  attr(element, "data-title", () => String(props.meta["title"] ?? ""));
  attr(element, "data-route-title", () => String(props.route.meta["title"] ?? ""));
  return element;
}

const routes: readonly RouteRecord[] = [
  { path: "/", name: "home", component: leaf("home") },
  {
    path: "/section",
    name: "section",
    component: layout,
    children: [
      { path: "", name: "section-index", component: leaf("section-index") },
      { path: "child/:id", name: "child", component: view("child") },
    ],
  },
  { path: "/other", name: "other", component: leaf("other") },
  { path: "/empty", name: "empty" },
  { path: "/cleanup", name: "cleanup", component: cleanupView },
  { path: "/meta-a", name: "meta-a", component: metaView, meta: { title: "A" } },
  { path: "/meta-b", name: "meta-b", component: metaView, meta: { title: "B" } },
];

function createRouter(initial = "/"): Router {
  return track(new Router({
    routes,
    history: createMemoryHistory(initial),
  }));
}

describe("RouterView", () => {
  it("рендерит вложенные компоненты по глубине", async () => {
    const router = createRouter("/section/child/1");
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    expect(host.querySelector("[data-view=layout]")).not.toBeNull();
    expect(host.querySelector("[data-view=child]")?.textContent).toBe("child:1");
  });

  it("рендерит только выбранную глубину", async () => {
    const router = createRouter("/section/child/1");
    await router.start();
    const { host } = mount(() => RouterView({ router, depth: 1 }));
    expect(host.querySelector("[data-view=layout]")).toBeNull();
    expect(host.querySelector("[data-view=child]")?.textContent).toBe("child:1");
  });

  it("реактивно обновляется при навигации", async () => {
    const router = createRouter("/");
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    expect(host.querySelector("[data-view=home]")).not.toBeNull();
    await router.push("/section/child/5");
    expect(host.querySelector("[data-view=layout]")).not.toBeNull();
    expect(host.querySelector("[data-view=child]")?.textContent).toBe("child:5");
    await router.push("/section/child/9");
    expect(host.querySelector("[data-view=child]")?.textContent).toBe("child:9");
    await router.push("/other");
    expect(host.querySelector("[data-view=layout]")).toBeNull();
    expect(host.querySelector("[data-view=other]")).not.toBeNull();
  });

  it("показывает fallback для отсутствующей глубины или компонента", async () => {
    const router = createRouter("/empty");
    await router.start();
    const fallback = document.createElement("em");
    fallback.textContent = "fallback";
    const { host } = mount(() => RouterView({ router, fallback }));
    expect(host.textContent).toBe("fallback");
    const deep = mount(() => RouterView({ router, depth: 4, fallback }));
    expect(deep.host.textContent).toBe("fallback");
  });

  it("передаёт meta в компонент маршрута и обновляет её при reuse", async () => {
    const router = createRouter("/meta-a");
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    const element = host.querySelector("[data-view=meta]");
    expect(element?.getAttribute("data-title")).toBe("A");
    expect(element?.getAttribute("data-route-title")).toBe("A");
    await router.push("/meta-b");
    expect(element?.getAttribute("data-title")).toBe("B");
    expect(element?.getAttribute("data-route-title")).toBe("B");
  });

  it("освобождает DOM и вызывает onCleanup при уходе с маршрута", async () => {
    cleanups = 0;
    const router = createRouter("/cleanup");
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    expect(host.querySelector("[data-view=cleanup]")).not.toBeNull();
    await router.push("/other");
    expect(host.querySelector("[data-view=cleanup]")).toBeNull();
    expect(cleanups).toBe(1);
  });

  it("работает на SSR с MemoryHistory", async () => {
    setServerMode(true);
    const router = createRouter("/section/child/2");
    await router.start();
    const container = document.createDocumentFragment();
    container.appendChild(RouterView({ router }));
    const host = document.createElement("div");
    host.appendChild(container);
    expect(host.querySelector("[data-view=layout]")).not.toBeNull();
    expect(host.querySelector("[data-view=child]")?.textContent).toBe("child:2");
  });

  it("требует Router и выбрасывает RouterMissingError", () => {
    while (routers.length > 0) {
      routers.pop()?.dispose();
    }
    expect(() => RouterView({})).toThrow(RouterMissingError);
  });

  it("в серверном рендере не откатывается к Router.current", async () => {
    const router = createRouter("/");
    await router.start();
    expect(Router.current()).toBe(router);
    setServerMode(true);
    try {
      expect(() => RouterView({})).toThrow(RouterMissingError);
      expect(() => RouterView({})).toThrow(/Router\.current\(\) на сервере не используется/);
    } finally {
      setServerMode(false);
    }
  });

  it("не откатывается к текущему Router при контейнере без Router", () => {
    createRouter("/");
    const container = new Container("no-router");
    expect(() => RouterView({ container })).toThrow(RouterMissingError);
    expect(() => RouterView({ container })).toThrow(/не нашёл Router/);
    container.dispose();
  });

  it("сообщает о зарегистрированном, но не разрешённом Router", async () => {
    const container = new Container("pending");
    const router = createRouter("/");
    container.bind(Router, async () => router);
    expect(() => RouterView({ container })).toThrow(RouterMissingError);
    expect(() => RouterView({ container })).toThrow(/bindValue\/provide/);
    await container.resolve(Router);
    container.dispose();
  });

  it("обновляется после асинхронной загрузки компонента", async () => {
    let resolveLoad: ((component: () => HTMLElement) => void) | null = null;
    const lazyRoutes: readonly RouteRecord[] = [
      { path: "/", component: leaf("home") },
      {
        path: "/lazy",
        load: () => new Promise((resolve) => {
          resolveLoad = (component) => {
            resolve(component);
          };
        }),
      },
    ];
    const router = track(new Router({
      routes: lazyRoutes,
      history: createMemoryHistory("/"),
    }));
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    const pending = router.push("/lazy");
    await tick();
    expect(resolveLoad).not.toBeNull();
    (resolveLoad as ((component: () => HTMLElement) => void) | null)?.(leaf("lazy"));
    await pending;
    expect(host.querySelector("[data-view=lazy]")).not.toBeNull();
  });
});
