import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Router,
  RouterNavigationError,
  createBrowserHistory,
  createMemoryHistory,
  type RouteRecord,
  type ScrollPosition,
} from "../src/index";
import { leaf, tick, view } from "./support";

const routers: Router[] = [];

function track(router: Router): Router {
  routers.push(router);
  return router;
}

afterEach(() => {
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

const baseRoutes: readonly RouteRecord[] = [
  { path: "/", name: "home", component: leaf("home") },
  { path: "/about", name: "about", component: leaf("about") },
  { path: "/login", name: "login", component: leaf("login") },
  { path: "/redirect", redirect: "/about" },
  {
    path: "/private",
    name: "private",
    component: leaf("private"),
    beforeEnter: () => "/login",
  },
  {
    path: "/blocked",
    name: "blocked",
    component: leaf("blocked"),
    beforeEnter: () => false,
  },
  {
    path: "/broken",
    name: "broken",
    component: leaf("broken"),
    beforeEnter: () => {
      throw new Error("boom");
    },
  },
  {
    path: "/lazy",
    name: "lazy",
    load: async () => ({ default: leaf("lazy") }),
  },
  {
    path: "/bad-load",
    name: "bad-load",
    load: async () => {
      throw new Error("load boom");
    },
  },
];

describe("навигация", () => {
  it("push и replace обновляют состояние и историю", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    expect(router.route?.name).toBe("home");

    await router.push("/about");
    expect(router.route?.name).toBe("about");
    expect(history.location.pathname).toBe("/about");
    expect(history.length).toBe(2);

    await router.replace("/login");
    expect(router.route?.name).toBe("login");
    expect(history.location.pathname).toBe("/login");
    expect(history.length).toBe(2);
    expect(router.state().pending).toBe(false);
  });

  it("back и forward обновляют состояние из истории", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await router.push("/about");
    await router.push("/login");

    router.back();
    await tick();
    expect(router.route?.name).toBe("about");

    router.back();
    await tick();
    expect(router.route?.name).toBe("home");

    router.forward();
    await tick();
    expect(router.route?.name).toBe("about");
  });

  it("обрабатывает popstate браузерной истории", async () => {
    window.history.replaceState(null, "", "/");
    const history = createBrowserHistory(window);
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await router.push("/about");
    expect(window.location.pathname).toBe("/about");

    window.history.replaceState(null, "", "/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await tick();
    expect(router.route?.name).toBe("login");
    history.dispose();
  });

  it("выполняет редирект маршрута через replace", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await router.push("/redirect");
    expect(router.route?.name).toBe("about");
    expect(history.location.pathname).toBe("/about");
    expect(history.length).toBe(1);
  });

  it("выполняет редирект из guard", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await router.push("/private");
    expect(router.route?.name).toBe("login");
    expect(history.location.pathname).toBe("/login");
  });

  it("отменяет навигацию, если guard вернул false", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await router.push("/blocked");
    expect(router.route?.name).toBe("home");
    expect(router.state().pending).toBe(false);
    expect(router.state().error).toBeNull();
  });

  it("поддерживает асинхронные guard с AbortSignal", async () => {
    const history = createMemoryHistory("/");
    const calls: string[] = [];
    const routes: readonly RouteRecord[] = [
      { path: "/", component: leaf("home") },
      {
        path: "/async",
        component: leaf("async"),
        beforeEnter: async (to, from, signal) => {
          calls.push(`from:${from?.path ?? "null"}`);
          await Promise.resolve();
          calls.push(`to:${to.path}:${String(signal.aborted)}`);
          return true;
        },
      },
    ];
    const router = track(new Router({ routes, history }));
    await router.start();
    await router.push("/async");
    expect(calls).toEqual(["from:/", "to:/async:false"]);
    expect(router.route?.path).toBe("/async");
  });

  it("превращает ошибку guard в RouterNavigationError", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await expect(router.push("/broken")).rejects.toBeInstanceOf(RouterNavigationError);
    try {
      await router.push("/broken");
    } catch (error) {
      expect((error as RouterNavigationError).code).toBe("guard");
    }
    expect(router.route?.name).toBe("home");
    expect(router.state().error).toBeInstanceOf(Error);
  });

  it("загружает асинхронный компонент и сохраняет его в matched", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await router.push("/lazy");
    const entry = router.state().matched[0];
    expect(entry?.component).toBeTypeOf("function");
    expect(router.state().pending).toBe(false);
  });

  it("превращает ошибку загрузчика в RouterNavigationError", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await expect(router.push("/bad-load")).rejects.toMatchObject({ code: "load" });
    expect(router.route?.name).toBe("home");
  });

  it("отменяет предыдущую навигацию при новой", async () => {
    let loaderSignal: AbortSignal | null = null;
    let started = false;
    const history = createMemoryHistory("/");
    const routes: readonly RouteRecord[] = [
      { path: "/", component: leaf("home") },
      { path: "/about", component: leaf("about") },
      {
        path: "/slow",
        load: async (_to, signal) => {
          started = true;
          loaderSignal = signal;
          await new Promise((resolve) => {
            setTimeout(resolve, 25);
          });
          return leaf("slow");
        },
      },
    ];
    const router = track(new Router({ routes, history }));
    await router.start();
    const first = router.push("/slow");
    await tick();
    expect(started).toBe(true);
    const second = router.push("/about");
    await Promise.all([first, second]);
    expect(loaderSignal?.aborted).toBe(true);
    expect(router.route?.path).toBe("/about");
  });

  it("отклоняет навигацию на неизвестный путь", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await expect(router.push("/missing")).rejects.toMatchObject({ code: "no-match" });
    expect(router.route?.name).toBe("home");
    expect(router.state().error).toBeInstanceOf(RouterNavigationError);
  });

  it("вызывает scrollBehavior и восстанавливает сохранённую позицию", async () => {
    const scrollX = vi.spyOn(window, "scrollX", "get").mockReturnValue(5);
    const scrollY = vi.spyOn(window, "scrollY", "get").mockReturnValue(100);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const saved: (ScrollPosition | null)[] = [];
    const history = createMemoryHistory("/");
    const router = track(new Router({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/a", component: leaf("a") },
      ],
      history,
      scrollBehavior: (to, _from, savedPosition) => {
        saved.push(savedPosition);
        return { left: 0, top: to.path === "/a" ? 20 : 0 };
      },
    }));
    await router.start();
    scrollTo.mockClear();
    await router.push("/a");
    expect(scrollTo).toHaveBeenCalledWith(0, 20);
    await router.push("/");
    expect(saved.at(-1)).toEqual({ left: 5, top: 100 });
    scrollX.mockRestore();
    scrollY.mockRestore();
  });

  it("прокручивает к элементу по hash без scrollBehavior", async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element): void {
      scrolled.push(this.id);
    };
    try {
      const history = createMemoryHistory("/");
      const router = track(new Router({
        routes: [
          { path: "/", component: leaf("home") },
          { path: "/docs", component: leaf("docs") },
        ],
        history,
      }));
      await router.start();
      const section = document.createElement("section");
      section.id = "install";
      document.body.appendChild(section);

      await router.push("/docs#install");
      await tick();
      expect(scrolled).toEqual(["install"]);

      await router.push("/docs#missing");
      await tick();
      expect(scrolled).toEqual(["install"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("снимает слушатели истории при dispose", async () => {
    const history = createMemoryHistory("/");
    const router = new Router({ routes: baseRoutes, history });
    await router.start();
    await router.push("/about");
    router.dispose();
    history.back();
    await tick();
    expect(router.route?.name).toBe("about");
    expect(Router.current()).not.toBe(router);
  });

  it("переключается между несколькими экземплярами через Router.current", async () => {
    const first = new Router({
      routes: baseRoutes,
      history: createMemoryHistory("/"),
    });
    const second = new Router({
      routes: baseRoutes,
      history: createMemoryHistory("/"),
    });
    expect(Router.current()).toBe(second);
    second.dispose();
    expect(Router.current()).toBe(first);
    first.dispose();
    expect(Router.current()).toBeNull();
  });

  it("останавливает и снова запускает подписку на историю", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes: baseRoutes, history }));
    await router.start();
    await router.push("/about");
    router.stop();
    history.back();
    await tick();
    expect(router.route?.name).toBe("about");
    await router.start();
    history.forward();
    await tick();
    expect(router.route?.name).toBe("about");
  });

  it("показывает параметры в компоненте через RouterView-пропсы", async () => {
    const history = createMemoryHistory("/users/1");
    const routes: readonly RouteRecord[] = [
      { path: "/users/:id", component: view("user") },
    ];
    const router = track(new Router({ routes, history }));
    await router.start();
    await router.push("/users/7");
    expect(router.params).toEqual({ id: "7" });
    expect(router.matched[0]?.params["id"]).toBe("7");
  });
  it("не дублирует навигацию на текущий маршрут", async () => {
    const beforeEnter = vi.fn();
    const routes: readonly RouteRecord[] = [
      { path: "/about", name: "about", component: leaf("about"), beforeEnter },
    ];
    const history = createMemoryHistory("/about");
    const router = track(new Router({ routes, history }));
    await router.start();
    beforeEnter.mockClear();

    await router.push("/about");
    await router.push({ name: "about" });
    expect(beforeEnter).not.toHaveBeenCalled();
    expect(history.length).toBe(1);

    await router.push("/about?tab=files");
    expect(beforeEnter).toHaveBeenCalledTimes(1);
    expect(history.length).toBe(2);
    expect(router.query).toEqual({ tab: "files" });

    await router.replace("/about?tab=files");
    expect(history.length).toBe(2);
  });
});
