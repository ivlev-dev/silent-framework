import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Link,
  Router,
  RouterMissingError,
  createMemoryHistory,
  type RouteRecord,
} from "../src/index";
import { leaf, render, tick, type Rendered } from "./support";

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
  vi.restoreAllMocks();
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
});
