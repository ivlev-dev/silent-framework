import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RouterNavigationError,
  createMemoryHistory,
  createTestRouter,
  type RouteRecord,
  type RouteTarget,
  type Router,
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
  vi.restoreAllMocks();
});

const routes: readonly RouteRecord[] = [
  { path: "/", name: "home", component: leaf("home") },
  { path: "/about", name: "about", component: leaf("about") },
  { path: "/login", name: "login", component: leaf("login") },
  { path: "/blocked", name: "blocked", component: leaf("blocked"), beforeEnter: () => false },
  { path: "/private", name: "private", component: leaf("private"), beforeEnter: () => "/login" },
  { path: "/broken", name: "broken", component: leaf("broken"), beforeEnter: () => {
    throw new Error("boom");
  } },
  { path: "/lazy", name: "lazy", load: async () => ({ default: leaf("lazy") }) },
  { path: "/bad-load", name: "bad-load", load: async () => {
    throw new Error("load boom");
  } },
];

describe("navigate()", () => {
  it("возвращает true при успешной навигации", async () => {
    const history = createMemoryHistory("/");
    const router = track(createTestRouter({ routes, history }));
    await router.start();

    expect(await router.navigate("/about")).toBe(true);
    expect(router.route?.name).toBe("about");
    expect(history.location.pathname).toBe("/about");
    expect(history.length).toBe(2);
  });

  it("поддерживает replace через опции", async () => {
    const history = createMemoryHistory("/");
    const router = track(createTestRouter({ routes, history }));
    await router.start();

    expect(await router.navigate("/about", { replace: true })).toBe(true);
    expect(router.route?.name).toBe("about");
    expect(history.length).toBe(1);
  });

  it("возвращает true при редиректе", async () => {
    const router = track(createTestRouter({ routes }));
    await router.start();

    expect(await router.navigate("/private")).toBe(true);
    expect(router.route?.name).toBe("login");
  });

  it("возвращает false без ошибки, если guard вернул false", async () => {
    const onError = vi.fn();
    const router = track(createTestRouter({ routes, onError }));
    await router.start();

    expect(await router.navigate("/blocked")).toBe(false);
    expect(router.route?.name).toBe("home");
    expect(router.state().error).toBeNull();
    expect(router.state().pending).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("возвращает false при ошибке загрузчика и пишет state.error", async () => {
    const onError = vi.fn();
    const router = track(createTestRouter({ routes, onError }));
    await router.start();

    expect(await router.navigate("/bad-load")).toBe(false);
    expect(router.route?.name).toBe("home");
    expect(router.state().error).toBeInstanceOf(RouterNavigationError);
    expect(router.state().error).toMatchObject({ code: "load" });
    expect(router.state().pending).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, to] = onError.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(RouterNavigationError);
    expect((error as RouterNavigationError).code).toBe("load");
    expect(to).toBe("/bad-load");
  });

  it("возвращает false на неизвестном пути и пишет state.error", async () => {
    const onError = vi.fn<(error: RouterNavigationError, to: RouteTarget) => void>();
    const router = track(createTestRouter({ routes, onError }));
    await router.start();

    expect(await router.navigate("/missing")).toBe(false);
    expect(router.state().error).toMatchObject({ code: "no-match" });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("возвращает false при ошибке guard и вызывает onError", async () => {
    const onError = vi.fn();
    const router = track(createTestRouter({ routes, onError }));
    await router.start();

    expect(await router.navigate("/broken")).toBe(false);
    expect(router.state().error).toMatchObject({ code: "guard" });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("возвращает false при отмене предыдущей навигацией без onError", async () => {
    const onError = vi.fn();
    let started = false;
    const router = track(createTestRouter({
      onError,
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/about", component: leaf("about") },
        {
          path: "/slow",
          load: async (_to, signal) => {
            started = true;
            expect(signal.aborted).toBe(false);
            await new Promise((resolve) => {
              setTimeout(resolve, 25);
            });
            return leaf("slow");
          },
        },
      ],
    }));
    await router.start();

    const first = router.navigate("/slow");
    await tick();
    expect(started).toBe(true);
    const second = router.navigate("/about");

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(router.route?.path).toBe("/about");
    expect(onError).not.toHaveBeenCalled();
  });

  it("push по-прежнему отклоняется при ошибке", async () => {
    const router = track(createTestRouter({ routes }));
    await router.start();

    await expect(router.push("/bad-load")).rejects.toBeInstanceOf(RouterNavigationError);
    await expect(router.push("/missing")).rejects.toMatchObject({ code: "no-match" });
    expect(router.route?.name).toBe("home");
  });

  it("push и replace по-прежнему разрешаются при успехе", async () => {
    const history = createMemoryHistory("/");
    const router = track(createTestRouter({ routes, history }));
    await router.start();

    await expect(router.push("/about")).resolves.toBeUndefined();
    await expect(router.replace("/login")).resolves.toBeUndefined();
    expect(router.route?.name).toBe("login");
    expect(history.length).toBe(2);
  });
});
