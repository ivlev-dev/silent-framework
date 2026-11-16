import { afterEach, describe, expect, it } from "vitest";
import { setServerMode } from "@ivlev-dev/silent-core";
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
    resolveLoad?.(leaf("lazy"));
    await pending;
    expect(host.querySelector("[data-view=lazy]")).not.toBeNull();
  });
});
