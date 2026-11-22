import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Router,
  RouterNavigationError,
  createBrowserHistory,
  createMemoryHistory,
  type RouteRecord,
} from "../src/index";
import { leaf, tick } from "./support";

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

const routes: readonly RouteRecord[] = [
  { path: "/", name: "home", component: leaf("home") },
  { path: "/about", name: "about", component: leaf("about") },
  {
    path: "/users",
    name: "users",
    component: leaf("users"),
    children: [
      { path: "", name: "users-index", component: leaf("users-index") },
      { path: ":id", name: "user", component: leaf("user") },
    ],
  },
  {
    path: "/edit/:id",
    name: "edit",
    component: leaf("edit"),
    query: { page: "number" },
  },
];

describe("канонизация цели", () => {
  it("разрешает literal dot-сегменты до матчинга и href", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes, history }));
    await router.start();

    expect(router.resolve("/users/../about").path).toBe("/about");
    expect(router.href("/users/../about")).toBe("/about");
    expect(router.resolve("/users/./5").params).toEqual({ id: "5" });
    expect(router.resolve("/users//5").params).toEqual({ id: "5" });

    await router.push("/users/../about");
    expect(router.route?.path).toBe("/about");
    expect(history.location.pathname).toBe("/about");
  });

  it("раскрывает percent-encoded dot-сегменты", async () => {
    const history = createMemoryHistory("/about");
    const router = track(new Router({ routes, history }));
    await router.start();

    expect(router.resolve("/users/%2e%2e").path).toBe("/");
    expect(router.resolve("/users/%2E%2E/about").path).toBe("/about");

    await router.push("/users/%2e%2e");
    expect(router.route?.path).toBe("/");
    expect(history.location.pathname).toBe("/");
  });

  it("считает обратный слэш разделителем и схлопывает повторы", async () => {
    const history = createMemoryHistory("/");
    const router = track(new Router({ routes, history }));
    await router.start();

    expect(router.resolve("/users\\..\\about").path).toBe("/about");
    expect(router.href("/users\\..\\about")).toBe("/about");
    expect(router.resolve("/users\\\\5").path).toBe("/users/5");

    await router.push("/users\\..\\about");
    expect(router.route?.path).toBe("/about");
    expect(history.location.pathname).toBe("/about");
  });

  it("согласует состояние роутера и BrowserHistory после dot-segment push", async () => {
    window.history.replaceState(null, "", "/about");
    const history = createBrowserHistory(window);
    const router = track(new Router({ routes, history }));
    await router.start();

    await router.push("/users/%2e%2e");
    expect(router.route?.path).toBe("/");
    expect(history.location.pathname).toBe("/");
    expect(window.location.pathname).toBe("/");
    history.dispose();
  });

  it("отклоняет пустой и dot-параметр с кодом resolve", () => {
    const router = track(new Router({ routes, history: createMemoryHistory("/") }));

    for (const id of ["", ".", ".."]) {
      let error: unknown;
      try {
        router.href({ name: "user", params: { id } });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RouterNavigationError);
      expect((error as RouterNavigationError).code).toBe("resolve");
    }

    expect(() => router.resolve({ name: "user", params: { id: "" } })).toThrow(
      /Пустой параметр/,
    );
    expect(() => router.resolve({ name: "user", params: { id: ".." } })).toThrow(
      /Недопустимый параметр/,
    );
  });

  it("не падает на lone surrogate в параметре", () => {
    const router = track(new Router({ routes, history: createMemoryHistory("/") }));
    const location = router.resolve({ name: "user", params: { id: "\uD800" } });

    expect(location.path).toBe("/users/%EF%BF%BD");
    expect(location.params).toEqual({ id: "\uFFFD" });
    expect(router.href({ name: "user", params: { id: "\uD800" } }))
      .toBe("/users/%EF%BF%BD");
  });

  it("сохраняет сырой search при hash-only переходе", async () => {
    const history = createMemoryHistory("/edit/7?page=abc#old");
    const router = track(new Router({ routes, history }));
    await router.start();
    expect(router.query).toEqual({});

    expect(router.resolve("#new").fullPath).toBe("/edit/7?page=abc#new");
    expect(router.resolve({ hash: "#next" }).fullPath).toBe("/edit/7?page=abc#next");

    await router.push("#new");
    expect(router.route?.fullPath).toBe("/edit/7?page=abc#new");
    expect(router.route?.query).toEqual({});
    expect(history.location.pathname).toBe("/edit/7");
    expect(history.location.search).toBe("?page=abc");
    expect(history.location.hash).toBe("#new");
  });

  it("классифицирует ошибку записи history отдельным кодом", async () => {
    const history = createMemoryHistory("/");
    const onError = vi.fn();
    const router = track(new Router({ routes, history, onError }));
    await router.start();
    const push = vi.spyOn(history, "push").mockImplementation(() => {
      throw new Error("cross-origin");
    });

    let error: unknown;
    try {
      await router.push("/about");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RouterNavigationError);
    expect((error as RouterNavigationError).code).toBe("history");
    expect(router.route?.path).toBe("/");
    expect(router.state().pending).toBe(false);
    expect(router.state().error).toBeInstanceOf(RouterNavigationError);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "history" }),
      "/about",
    );
    await tick();
    push.mockRestore();
  });
});
