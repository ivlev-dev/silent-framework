import { afterEach, describe, expect, it } from "vitest";
import { createTestRouter, type RouteInput, type Router } from "../src/index";
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
  {
    path: "/app",
    meta: { section: "app", title: "App" },
    children: [
      {
        path: "",
        name: "app-home",
        component: leaf("app-home"),
        meta: { title: "Home" },
      },
      {
        path: "users/:id",
        name: "user",
        component: leaf("user"),
        meta: { tab: "info" },
        children: [
          {
            path: "posts/:postId",
            name: "post",
            component: leaf("post"),
            meta: { post: true },
          },
        ],
      },
    ],
  },
  { path: "/bare", name: "bare", component: leaf("bare") },
];

describe("meta маршрута", () => {
  it("объединяет meta от корня к листу, лист перекрывает родителей", async () => {
    const router = track(createTestRouter({ routes, initial: "/app/users/7/posts/3" }));
    await router.start();

    expect(router.route?.meta).toEqual({
      section: "app",
      title: "App",
      tab: "info",
      post: true,
    });
    expect(router.meta).toEqual(router.route?.meta);
    expect(router.route?.matched.map((entry) => entry.record.name)).toEqual([
      undefined,
      "user",
      "post",
    ]);
  });

  it("перекрывает значения родителя значениями листа", async () => {
    const router = track(createTestRouter({ routes, initial: "/app" }));
    await router.start();

    expect(router.route?.name).toBe("app-home");
    expect(router.meta).toEqual({ section: "app", title: "Home" });
  });

  it("возвращает пустой meta, если он не задан ни у кого", async () => {
    const router = track(createTestRouter({ routes, initial: "/bare" }));
    await router.start();

    expect(router.route?.meta).toEqual({});
    expect(router.meta).toEqual({});
  });

  it("заполняет meta в resolve", () => {
    const router = track(createTestRouter({ routes }));

    expect(router.resolve("/bare").meta).toEqual({});
    expect(router.resolve("/app/users/1").meta).toEqual({
      section: "app",
      title: "App",
      tab: "info",
    });
    expect(router.resolve({ name: "post", params: { id: "2", postId: "9" } }).meta).toEqual({
      section: "app",
      title: "App",
      tab: "info",
      post: true,
    });
  });

  it("не изменяет meta записей маршрута", async () => {
    const parentMeta = { title: "App" };
    const router = track(createTestRouter({
      routes: [
        {
          path: "/parent",
          meta: parentMeta,
          children: [{ path: "child", name: "child", component: leaf("child") }],
        },
      ],
      initial: "/parent/child",
    }));
    await router.start();

    expect(router.meta).toEqual({ title: "App" });
    expect(parentMeta).toEqual({ title: "App" });
    expect(router.meta).not.toBe(parentMeta);
  });
});
