import { afterEach, describe, expect, it } from "vitest";
import {
  Router,
  RouterNavigationError,
  createMemoryHistory,
  type RouteRecord,
} from "../src/index";
import { leaf } from "./support";

const routers: Router[] = [];

function createRouter(routes: readonly RouteRecord[]): Router {
  const router = new Router({ routes, history: createMemoryHistory("/") });
  routers.push(router);
  return router;
}

const routes: readonly RouteRecord[] = [
  { path: "/", name: "home", component: leaf("home") },
  {
    path: "/users",
    name: "users",
    component: leaf("users"),
    children: [
      { path: "", name: "users-index", component: leaf("users-index") },
      { path: ":id", name: "user", component: leaf("user") },
      { path: ":id/posts/:postId", name: "post", component: leaf("post") },
    ],
  },
  { path: "/files/*", name: "files", component: leaf("files") },
  { path: "/static/path", name: "static-path", component: leaf("static") },
  { path: "/:slug", name: "slug", component: leaf("slug") },
];

afterEach(() => {
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  document.body.replaceChildren();
});

describe("сопоставление маршрутов", () => {
  it("разбирает статический путь и query/hash", () => {
    const router = createRouter(routes);
    const location = router.resolve("/users?tab=a&tab=b&q=x%20y#top");
    expect(location.path).toBe("/users");
    expect(location.name).toBe("users-index");
    expect(location.query).toEqual({ tab: ["a", "b"], q: "x y" });
    expect(location.hash).toBe("#top");
    expect(location.fullPath).toBe("/users?tab=a&tab=b&q=x+y#top");
  });

  it("извлекает параметры вложенного маршрута", () => {
    const router = createRouter(routes);
    const location = router.resolve("/users/42");
    expect(location.name).toBe("user");
    expect(location.params).toEqual({ id: "42" });
    expect(location.matched).toHaveLength(2);
    expect(location.matched[0]?.record.name).toBe("users");
    expect(location.matched[1]?.record.name).toBe("user");
  });

  it("поддерживает несколько параметров и index-маршрут", () => {
    const router = createRouter(routes);
    const post = router.resolve("/users/42/posts/7");
    expect(post.name).toBe("post");
    expect(post.params).toEqual({ id: "42", postId: "7" });
    expect(post.matched).toHaveLength(2);
    const index = router.resolve("/users");
    expect(index.name).toBe("users-index");
    expect(index.matched).toHaveLength(2);
  });

  it("захватывает wildcard-хвост", () => {
    const router = createRouter(routes);
    const location = router.resolve("/files/a/b/c.txt");
    expect(location.name).toBe("files");
    expect(location.params["*"]).toBe("a/b/c.txt");
  });

  it("не отдаёт корень wildcard-маршруту", async () => {
    const router = createRouter([
      ...routes,
      { path: "*", name: "not-found", component: leaf("not-found") },
    ]);
    await router.start();
    expect(router.route?.name).toBe("home");
    await router.push("/unknown/deep");
    expect(router.route?.name).toBe("not-found");
  });

  it("выбирает наиболее специфичный маршрут", () => {
    const router = createRouter(routes);
    expect(router.resolve("/static/path").name).toBe("static-path");
    expect(router.resolve("/users/42").name).toBe("user");
    expect(router.resolve("/about").name).toBe("slug");
    expect(router.resolve("/about").params).toEqual({ slug: "about" });
  });

  it("декодирует параметры и статические сегменты", () => {
    const local = createRouter([
      { path: "/café/:name", name: "cafe", component: leaf("cafe") },
    ]);
    const location = local.resolve("/caf%C3%A9/%D0%BC%D0%B8%D1%80");
    expect(location.name).toBe("cafe");
    expect(location.params).toEqual({ name: "мир" });
  });

  it("строит путь по имени и параметрам", () => {
    const router = createRouter(routes);
    const location = router.resolve({
      name: "post",
      params: { id: 42, postId: 7 },
      query: { q: "hello world", tag: ["a", "b"] },
      hash: "comments",
    });
    expect(location.path).toBe("/users/42/posts/7");
    expect(location.fullPath).toBe("/users/42/posts/7?q=hello+world&tag=a&tag=b#comments");
  });

  it("оставляет hash и query при относительных переходах", async () => {
    const router = createRouter(routes);
    await router.push("/users/42?tab=info");
    expect(router.resolve("#details").fullPath).toBe("/users/42?tab=info#details");
    expect(router.resolve("?tab=other").fullPath).toBe("/users/42?tab=other");
  });

  it("выбрасывает RouterNavigationError для неизвестного имени и отсутствующего параметра", () => {
    const router = createRouter(routes);
    expect(() => router.resolve({ name: "missing" })).toThrow(RouterNavigationError);
    expect(() => router.resolve({ name: "user" })).toThrow(RouterNavigationError);
    expect(() => router.resolve({ name: "user" })).toThrow(/id/);
  });

  it("выбрасывает RouterNavigationError, если путь не сопоставлен", () => {
    const router = createRouter([{ path: "/only", component: leaf("only") }]);
    expect(() => router.resolve("/missing")).toThrow(RouterNavigationError);
    try {
      router.resolve("/missing");
    } catch (error) {
      expect((error as RouterNavigationError).code).toBe("no-match");
    }
  });

  it("учитывает base при построении href", () => {
    const router = new Router({
      routes,
      base: "/app/",
      history: createMemoryHistory("/app/"),
    });
    routers.push(router);
    expect(router.base).toBe("/app");
    expect(router.href("/users/1")).toBe("/app/users/1");
    expect(router.href({ name: "user", params: { id: 2 } })).toBe("/app/users/2");
  });
});
