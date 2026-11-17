import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestRouter,
  type RouteLoaderResult,
  type Router,
  type RouterComponentLoadContext,
} from "../src/index";
import { leaf } from "./support";

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

describe("настраиваемые загрузчики", () => {
  it("загружает компонент через options.load и сохраняет его", async () => {
    const contexts: RouterComponentLoadContext[] = [];
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/lazy", name: "lazy", meta: { lazy: true } },
      ],
      load: (context): RouteLoaderResult => {
        contexts.push(context);
        return leaf(`lazy:${context.record.name ?? ""}`);
      },
    }));
    await router.start();

    expect(router.isLoaded("/lazy")).toBe(false);
    expect(await router.navigate("/lazy")).toBe(true);

    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    expect(context?.record.name).toBe("lazy");
    expect(context?.router).toBe(router);
    expect(context?.route.path).toBe("/lazy");
    expect(context?.params).toEqual({});
    expect(context?.query).toEqual({});
    expect(context?.hash).toBe("");
    expect(context?.meta).toEqual({ lazy: true });
    expect(context?.signal).toBeInstanceOf(AbortSignal);
    expect(router.matched[0]?.component).toBeTypeOf("function");
    expect(router.isLoaded("/lazy")).toBe(true);
  });

  it("использует options.resolveComponent, если options.load нет", async () => {
    const resolveComponent = vi.fn((): RouteLoaderResult => ({ default: leaf("resolved") }));
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/resolved", name: "resolved" },
      ],
      resolveComponent,
    }));
    await router.start();

    expect(await router.navigate("/resolved")).toBe(true);
    expect(resolveComponent).toHaveBeenCalledTimes(1);
    expect(router.matched[0]?.component).toBeTypeOf("function");
    expect(router.isLoaded("/resolved")).toBe(true);
  });

  it("record.load имеет приоритет над options.load", async () => {
    const own = vi.fn((): RouteLoaderResult => leaf("own"));
    const shared = vi.fn((): RouteLoaderResult => leaf("shared"));
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/own", name: "own", load: own },
        { path: "/shared", name: "shared" },
      ],
      load: shared,
    }));
    await router.start();

    await router.navigate("/own");
    expect(own).toHaveBeenCalledTimes(1);
    expect(shared).not.toHaveBeenCalled();

    await router.navigate("/shared");
    expect(shared).toHaveBeenCalledTimes(1);
  });

  it("не вызывает options.load для маршрутов со статическим компонентом", async () => {
    const load = vi.fn((): RouteLoaderResult => leaf("shared"));
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/static", component: leaf("static") },
      ],
      load,
    }));
    await router.start();

    expect(await router.navigate("/static")).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(router.isLoaded("/static")).toBe(true);
  });

  it("prefetch использует общий загрузчик и кеширует компонент", async () => {
    const load = vi.fn((): RouteLoaderResult => leaf("lazy"));
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/lazy", name: "lazy" },
      ],
      load,
    }));
    await router.start();

    expect(router.isLoaded("/lazy")).toBe(false);
    await router.prefetch("/lazy");
    expect(load).toHaveBeenCalledTimes(1);
    expect(router.isLoaded("/lazy")).toBe(true);

    expect(await router.navigate("/lazy")).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("оборачивает ошибку options.load в RouterNavigationError code load", async () => {
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/broken", name: "broken" },
      ],
      load: () => {
        throw new Error("shared boom");
      },
    }));
    await router.start();

    expect(await router.navigate("/broken")).toBe(false);
    expect(router.state().error).toMatchObject({
      code: "load",
      message: "Загрузчик маршрута broken завершился ошибкой",
    });
  });

  it("загружает только те записи цепочки, у которых нет компонента", async () => {
    const loaded: string[] = [];
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        {
          path: "/layout",
          component: leaf("layout"),
          children: [
            { path: "page", name: "page" },
          ],
        },
      ],
      load: (context): RouteLoaderResult => {
        loaded.push(context.record.name ?? context.record.path);
        return leaf("page");
      },
    }));
    await router.start();

    expect(await router.navigate("/layout/page")).toBe(true);
    expect(loaded).toEqual(["page"]);
    expect(router.matched).toHaveLength(2);
    expect(router.matched[1]?.component).toBeTypeOf("function");
  });
});
