import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryHistory,
  createMemoryHistory,
  createTestRouter,
  type RouteInput,
  type Router,
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
});

const routes: readonly RouteInput[] = [
  { path: "/", name: "home", component: leaf("home") },
  { path: "/about", name: "about", component: leaf("about") },
  { path: "/users/:id", name: "user", component: leaf("user") },
  { path: "/lazy", name: "lazy", load: () => leaf("lazy") },
  { path: "/empty", name: "empty" },
];

describe("createTestRouter", () => {
  it("создаёт MemoryHistory с начальным маршрутом по умолчанию", async () => {
    const router = track(createTestRouter({ routes }));
    await router.start();

    expect(router.route?.name).toBe("home");
    expect(router.base).toBe("");
  });

  it("использует initial как стартовую точку", async () => {
    const router = track(createTestRouter({ routes, initial: "/about" }));
    await router.start();

    expect(router.route?.name).toBe("about");
  });

  it("принимает явную историю вместо initial", async () => {
    const history = new MemoryHistory("/users/5");
    const router = track(createTestRouter({ routes, initial: "/about", history }));
    await router.start();

    expect(history).toBeInstanceOf(MemoryHistory);
    expect(router.route?.name).toBe("user");
    expect(router.params).toEqual({ id: "5" });
  });

  it("прокидывает остальные опции в Router", async () => {
    const router = track(createTestRouter({ routes, base: "/app", initial: "/" }));
    await router.start();

    expect(router.base).toBe("/app");
    expect(router.href("/about")).toBe("/app/about");
  });
});

describe("hasRoute и isLoaded", () => {
  it("hasRoute проверяет разрешимость цели", () => {
    const router = track(createTestRouter({ routes }));

    expect(router.hasRoute("/about")).toBe(true);
    expect(router.hasRoute("/users/1")).toBe(true);
    expect(router.hasRoute({ name: "about" })).toBe(true);
    expect(router.hasRoute({ name: "missing" })).toBe(false);
    expect(router.hasRoute("/missing")).toBe(false);
    expect(router.hasRoute({ name: "user", params: {} })).toBe(false);
  });

  it("isLoaded учитывает статические компоненты, кеш и отсутствие загрузчика", async () => {
    const router = track(createTestRouter({ routes }));
    await router.start();

    expect(router.isLoaded("/about")).toBe(true);
    expect(router.isLoaded("/empty")).toBe(true);
    expect(router.isLoaded("/lazy")).toBe(false);
    expect(router.isLoaded("/missing")).toBe(false);

    await router.push("/lazy");
    expect(router.isLoaded("/lazy")).toBe(true);
    expect(router.isLoaded("/about")).toBe(true);
  });

  it("isLoaded учитывает общий загрузчик", () => {
    const router = track(createTestRouter({
      routes: [{ path: "/shared", name: "shared" }],
      load: () => leaf("shared"),
    }));

    expect(router.isLoaded("/shared")).toBe(false);
    expect(router.hasRoute("/shared")).toBe(true);
  });

  it("работает без start и истории", () => {
    const router = track(createTestRouter({
      routes,
      history: createMemoryHistory("/users/9"),
    }));

    expect(router.hasRoute("/about")).toBe(true);
    expect(router.isLoaded("/about")).toBe(true);
    expect(router.isLoaded("/lazy")).toBe(false);
  });
});
