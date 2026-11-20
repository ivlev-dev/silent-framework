import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Link,
  Router,
  RouterMissingError,
  createMemoryHistory,
  type RouteRecord,
} from "../src/index";
import { setServerMode, type AnyComponent, type RuntimeOptions } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";
import { renderToString } from "@ivlev-dev/silent-server";
import { leaf, render, tick, type Rendered } from "./support";

const routers: Router[] = [];
const rendered: Rendered[] = [];

function track(router: Router): Router {
  routers.push(router);
  return router;
}

function mount(factory: () => Node, options?: RuntimeOptions): Rendered {
  const result = render(factory, options);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const routes: readonly RouteRecord[] = [
  { path: "/", name: "home", component: leaf("home") },
  { path: "/about", name: "about", component: leaf("about") },
  { path: "/users", name: "users", component: leaf("users") },
  { path: "/users/:id", name: "user", component: leaf("user") },
];

function setup(): { router: Router; history: ReturnType<typeof createMemoryHistory> } {
  const history = createMemoryHistory("/app/");
  const router = track(new Router({ routes, base: "/app", history }));
  return { router, history };
}

describe("Link", () => {
  it("создаёт href с учётом base", async () => {
    const { router } = setup();
    await router.start();
    const { host } = mount(() => Link({ to: "/about", children: "О нас" }));
    const anchor = host.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/app/about");
    expect(anchor?.textContent).toBe("О нас");
  });

  it("строит href по имени и параметрам", async () => {
    const { router } = setup();
    await router.start();
    const { host } = mount(() => Link({
      to: { name: "user", params: { id: 7 }, query: { tab: "info" } },
      children: "Профиль",
    }));
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/app/users/7?tab=info");
  });

  it("предзагружает lazy route по hover при prefetch", async () => {
    let loaded = 0;
    const lazy = (): HTMLElement => {
      const element = document.createElement("div");
      element.dataset.view = "lazy";
      return element;
    };
    const router = track(new Router({
      routes: [
        { path: "/", name: "home", component: leaf("home") },
        {
          path: "/lazy",
          name: "lazy",
          load: async () => {
            loaded += 1;
            return lazy;
          },
        },
      ],
      history: createMemoryHistory("/"),
    }));
    await router.start();
    const { host } = mount(() => Link({ to: "/lazy", prefetch: true, children: "lazy" }));
    host.querySelector("a")?.dispatchEvent(new MouseEvent("pointerenter", { bubbles: true }));
    await tick();
    await tick();
    expect(loaded).toBe(1);
  });

  it("предзагружает lazy route по pointerdown (touch)", async () => {
    let loaded = 0;
    const lazy = (): HTMLElement => {
      const element = document.createElement("div");
      element.dataset.view = "lazy-touch";
      return element;
    };
    const router = track(new Router({
      routes: [
        { path: "/", name: "home", component: leaf("home") },
        {
          path: "/lazy-touch",
          name: "lazy-touch",
          load: async () => {
            loaded += 1;
            return lazy;
          },
        },
      ],
      history: createMemoryHistory("/"),
    }));
    await router.start();
    const { host } = mount(() => Link({ to: "/lazy-touch", prefetch: true, children: "lazy" }));
    host.querySelector("a")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await tick();
    await tick();
    expect(loaded).toBe(1);
  });

  it("предзагружает lazy route при появлении во viewport", async () => {
    let loaded = 0;
    const lazy = (): HTMLElement => {
      const element = document.createElement("div");
      element.dataset.view = "lazy-visible";
      return element;
    };
    const instances: MockIntersectionObserver[] = [];
    class MockIntersectionObserver {
      readonly callback: IntersectionObserverCallback;
      target: Element | null = null;
      disconnected = false;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        instances.push(this);
      }

      observe(target: Element): void {
        this.target = target;
      }

      disconnect(): void {
        this.disconnected = true;
      }

      trigger(isIntersecting: boolean): void {
        this.callback(
          [{ isIntersecting, target: this.target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const router = track(new Router({
      routes: [
        { path: "/", name: "home", component: leaf("home") },
        {
          path: "/lazy-visible",
          name: "lazy-visible",
          load: async () => {
            loaded += 1;
            return lazy;
          },
        },
      ],
      history: createMemoryHistory("/"),
    }));
    await router.start();
    const { host } = mount(() =>
      Link({ to: "/lazy-visible", prefetch: "visible", children: "lazy" }),
    );
    expect(host.querySelector("a")).not.toBeNull();
    expect(loaded).toBe(0);

    const observer = instances[0];
    expect(observer?.target).toBe(host.querySelector("a"));
    observer?.trigger(false);
    await tick();
    expect(loaded).toBe(0);

    observer?.trigger(true);
    await tick();
    await tick();
    expect(loaded).toBe(1);
    expect(observer?.disconnected).toBe(true);

    observer?.trigger(true);
    await tick();
    expect(loaded).toBe(1);
  });

  it("предзагружает visible-ссылку сразу без IntersectionObserver", async () => {
    let loaded = 0;
    const lazy = (): HTMLElement => {
      const element = document.createElement("div");
      element.dataset.view = "lazy-fallback";
      return element;
    };
    vi.stubGlobal("IntersectionObserver", undefined);
    const router = track(new Router({
      routes: [
        { path: "/", name: "home", component: leaf("home") },
        {
          path: "/lazy-fallback",
          name: "lazy-fallback",
          load: async () => {
            loaded += 1;
            return lazy;
          },
        },
      ],
      history: createMemoryHistory("/"),
    }));
    await router.start();
    mount(() => Link({ to: "/lazy-fallback", prefetch: "visible", children: "lazy" }));
    await tick();
    await tick();
    expect(loaded).toBe(1);
  });

  it("не запускает visible-prefetch во время SSR", async () => {
    let loaded = 0;
    const lazy = (): HTMLElement => document.createElement("div");
    vi.stubGlobal("IntersectionObserver", undefined);
    const router = track(new Router({
      routes: [
        { path: "/", name: "home", component: leaf("home") },
        {
          path: "/lazy-server",
          name: "lazy-server",
          load: async () => {
            loaded += 1;
            return lazy;
          },
        },
      ],
      history: createMemoryHistory("/"),
    }));
    await router.start();
    const prefetch = vi.spyOn(router, "prefetch");
    setServerMode(true);
    try {
      mount(() => Link({ to: "/lazy-server", prefetch: "visible", children: "lazy" }));
      await tick();
    } finally {
      setServerMode(false);
    }
    expect(prefetch).not.toHaveBeenCalled();
    expect(loaded).toBe(0);
  });

  it("не перехватывает внешние ссылки", async () => {
    const { router } = setup();
    await router.start();
    const push = vi.spyOn(router, "push");
    const { host } = mount(() => Link({ to: "https://example.com/docs", children: "docs" }));
    const anchor = host.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("https://example.com/docs");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("ставит aria-current на точный активный маршрут", async () => {
    const { router } = setup();
    await router.start();
    const { host } = mount(() => Link({ to: "/", children: "Главная" }));
    expect(host.querySelector("a")?.getAttribute("aria-current")).toBe("page");
    await router.push("/about");
    expect(host.querySelector("a")?.getAttribute("aria-current")).toBeNull();
  });

  it("перехватывает левый клик и делает push", async () => {
    const { router } = setup();
    await router.start();
    const push = vi.spyOn(router, "push");
    const { host } = mount(() => Link({ to: "/about", children: "О нас" }));
    const anchor = host.querySelector("a");
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    anchor?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledWith("/about");
    await tick();
    expect(router.route?.name).toBe("about");
  });

  it("делает replace для replace-ссылки", async () => {
    const { router, history } = setup();
    await router.start();
    const push = vi.spyOn(router, "push");
    const replace = vi.spyOn(router, "replace");
    const { host } = mount(() => Link({ to: "/about", replace: true, children: "О нас" }));
    host.querySelector("a")?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/about");
    await tick();
    expect(history.location.pathname).toBe("/app/about");
    expect(history.length).toBe(1);
  });

  it("не перехватывает клик с модификатором", async () => {
    const { router } = setup();
    await router.start();
    const push = vi.spyOn(router, "push");
    const { host } = mount(() => Link({ to: "/about", children: "О нас" }));
    const anchor = host.querySelector("a");
    anchor?.removeAttribute("href");
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
      });
      anchor?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(push).not.toHaveBeenCalled();
  });

  it("не перехватывает не-левый клик и уже отменённое событие", async () => {
    const { router } = setup();
    await router.start();
    const push = vi.spyOn(router, "push");
    const { host } = mount(() => Link({ to: "/about", children: "О нас" }));
    const anchor = host.querySelector("a");
    anchor?.removeAttribute("href");
    anchor?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 1,
    }));
    const prevented = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    prevented.preventDefault();
    anchor?.dispatchEvent(prevented);
    expect(push).not.toHaveBeenCalled();
  });

  it("реактивно переключает active и exactActive классы", async () => {
    const { router } = setup();
    await router.start();
    const { host } = mount(() => Link({
      to: "/",
      class: "nav",
      activeClass: "active",
      exactActiveClass: "exact",
      children: "Главная",
    }));
    const anchor = host.querySelector("a");
    expect(anchor?.className).toBe("nav active exact");
    await router.push("/about");
    expect(anchor?.className).toBe("nav");
    await router.push("/");
    expect(anchor?.className).toBe("nav active exact");
  });

  it("ставит active для вложенного пути, но не exactActive", async () => {
    const { router } = setup();
    await router.start();
    const { host } = mount(() => Link({
      to: "/users",
      activeClass: "active",
      exactActiveClass: "exact",
      children: "Пользователи",
    }));
    const anchor = host.querySelector("a");
    await router.push("/users/5");
    expect(anchor?.className).toBe("active");
  });

  it("требует Router и выбрасывает RouterMissingError", () => {
    while (routers.length > 0) {
      routers.pop()?.dispose();
    }
    expect(() => Link({ to: "/", children: "x" })).toThrow(RouterMissingError);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "foo:bar",
  ])("не выставляет href и не перехватывает опасную схему %s", async (to) => {
    const { router } = setup();
    await router.start();
    const push = vi.spyOn(router, "push");
    const { host } = mount(() => Link({ to, children: "опасно" }));
    const anchor = host.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBeNull();
    expect(anchor.getAttribute("aria-current")).toBeNull();

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.com",
    "https://example.com/docs?q=1",
    "mailto:dev@example.com",
    "tel:+79001234567",
    "//cdn.example.com/app.js",
    "#section",
  ])("оставляет разрешённую внешнюю ссылку %s без перехвата", async (to) => {
    const { router } = setup();
    await router.start();
    const push = vi.spyOn(router, "push");
    const { host } = mount(() => Link({ to, children: "внешняя" }));
    const anchor = host.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe(to);
    expect(anchor.getAttribute("aria-current")).toBeNull();

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("не бросает при отсутствии маршрута и отдаёт сырой href", async () => {
    const { router } = setup();
    await router.start();
    const push = vi.spyOn(router, "push");
    const { host } = mount(() => Link({
      to: "/nope",
      class: "nav",
      activeClass: "active",
      exactActiveClass: "exact",
      children: "404",
    }));
    const anchor = host.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("/nope");
    expect(anchor.getAttribute("aria-current")).toBeNull();
    expect(anchor.className).toBe("nav");

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledWith("/nope");
  });

  it("не бросает для объектной цели без маршрута и не выставляет href", async () => {
    const { router } = setup();
    await router.start();
    const { host } = mount(() => Link({
      to: { name: "missing" },
      activeClass: "active",
      children: "404",
    }));
    const anchor = host.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBeNull();
    expect(anchor.getAttribute("aria-current")).toBeNull();
    expect(anchor.className).toBe("");
  });

  it("не падает при SSR-рендере ссылки на отсутствующий маршрут", async () => {
    const { router } = setup();
    await router.start();
    const rendered = await renderToString(
      (() => Link({ to: "/nope", router, children: "404" })) as AnyComponent,
    );
    expect(rendered.html).toContain('href="/nope"');
    expect(rendered.html).not.toContain("aria-current");
  });

  it("не откатывается к Router.current при контейнере без биндинга", async () => {
    const { router } = setup();
    await router.start();
    const container = new Container();
    try {
      expect(() => render(
        () => Link({ to: "/about", children: "О нас" }),
        { container },
      )).toThrow(RouterMissingError);
    } finally {
      container.dispose();
    }
  });

  it("использует router из контейнера, а не Router.current", async () => {
    const routes: readonly RouteRecord[] = [
      { path: "/", name: "home", component: leaf("home") },
      { path: "/about", name: "about", component: leaf("about") },
    ];
    const fromContainer = track(new Router({
      routes,
      base: "/one",
      history: createMemoryHistory("/"),
    }));
    const current = track(new Router({
      routes,
      base: "/two",
      history: createMemoryHistory("/"),
    }));
    await current.start();
    expect(Router.current()).toBe(current);

    const container = new Container();
    container.bindValue(Router, fromContainer);
    try {
      const { host } = mount(
        () => Link({ to: "/about", children: "О нас" }),
        { container },
      );
      expect(host.querySelector("a")?.getAttribute("href")).toBe("/one/about");
    } finally {
      container.dispose();
    }
  });

  it("сравнивает query при выборе exactActive и aria-current", async () => {
    const router = track(new Router({
      routes: [
        { path: "/", name: "home", component: leaf("home") },
        { path: "/about", name: "about", component: leaf("about") },
      ],
      history: createMemoryHistory("/about?tab=info"),
    }));
    await router.start();
    const info = mount(() => Link({
      to: "/about?tab=info",
      class: "nav",
      activeClass: "active",
      exactActiveClass: "exact",
      children: "info",
    }));
    const files = mount(() => Link({
      to: "/about?tab=files",
      class: "nav",
      activeClass: "active",
      exactActiveClass: "exact",
      children: "files",
    }));

    const infoAnchor = info.host.querySelector("a")!;
    const filesAnchor = files.host.querySelector("a")!;
    expect(infoAnchor.getAttribute("aria-current")).toBe("page");
    expect(infoAnchor.className).toBe("nav active exact");
    expect(filesAnchor.getAttribute("aria-current")).toBeNull();
    expect(filesAnchor.className).toBe("nav active");
  });

  it("сравнивает hash при выборе exactActive и aria-current", async () => {
    const router = track(new Router({
      routes: [{ path: "/docs", name: "docs", component: leaf("docs") }],
      history: createMemoryHistory("/docs#install"),
    }));
    await router.start();
    const install = mount(() => Link({ to: "/docs#install", children: "install" }));
    const usage = mount(() => Link({ to: "/docs#usage", children: "usage" }));
    expect(install.host.querySelector("a")?.getAttribute("aria-current")).toBe("page");
    expect(usage.host.querySelector("a")?.getAttribute("aria-current")).toBeNull();
  });

  it("позволяет отключить сравнение query через exactQuery", async () => {
    const router = track(new Router({
      routes: [{ path: "/about", name: "about", component: leaf("about") }],
      history: createMemoryHistory("/about?tab=info"),
    }));
    await router.start();
    const { host } = mount(() => Link({
      to: "/about?tab=files",
      exactQuery: false,
      children: "files",
    }));
    expect(host.querySelector("a")?.getAttribute("aria-current")).toBe("page");
  });
});
