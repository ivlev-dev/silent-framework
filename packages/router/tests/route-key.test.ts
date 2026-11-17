import { afterEach, describe, expect, it, vi } from "vitest";
import { expectTypeOf } from "vitest";
import {
  Route,
  createTestRouter,
  type RouteDefinition,
  type RouteLocation,
  type RouteRecord,
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
  vi.restoreAllMocks();
});

describe("ключ маршрута (key)", () => {
  it("типизирует key в определениях и записях", () => {
    expectTypeOf<RouteDefinition["key"]>().toEqualTypeOf<
      ((to: RouteLocation) => string | number) | undefined
    >();
    expectTypeOf<NonNullable<RouteRecord["key"]>>().returns.toEqualTypeOf<string | number>();
  });

  it("копируется из определения в запись и получает локацию", async () => {
    const key = vi.fn((to: RouteLocation) => to.params["id"] ?? "");
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/users/:id", name: "user", component: leaf("user"), key },
      ],
      initial: "/users/42",
    }));
    await router.start();

    const record = router.matched[0]?.record;
    expect(record?.key).toBeTypeOf("function");
    expect(key).not.toHaveBeenCalled();
    expect(record?.key?.(router.route as RouteLocation)).toBe("42");
    expect(key).toHaveBeenCalledTimes(1);
  });

  it("поддерживает числовой ключ", async () => {
    const router = track(createTestRouter({
      routes: [
        {
          path: "/item/:id",
          name: "item",
          component: leaf("item"),
          key: (to) => Number(to.params["id"]),
        },
      ],
      initial: "/item/7",
    }));
    await router.start();

    expect(router.matched[0]?.record.key?.(router.route as RouteLocation)).toBe(7);
  });

  it("копируется из route-класса", async () => {
    class KeyedRoute extends Route {
      readonly path = "/keyed";
      readonly name = "keyed";
      readonly component = leaf("keyed");
      readonly key = (to: RouteLocation): string => to.path;
    }

    const router = track(createTestRouter({ routes: [KeyedRoute], initial: "/keyed" }));
    await router.start();

    expect(router.matched[0]?.record.key?.(router.route as RouteLocation)).toBe("/keyed");
  });

  it("копируется во вложенных определениях", async () => {
    const router = track(createTestRouter({
      routes: [
        {
          path: "/parent",
          component: leaf("parent"),
          key: () => "parent",
          children: [
            {
              path: "child",
              name: "child",
              component: leaf("child"),
              key: (to) => `child:${to.path}`,
            },
          ],
        },
      ],
      initial: "/parent/child",
    }));
    await router.start();

    expect(router.matched.map((entry) => entry.record.key?.(router.route as RouteLocation)))
      .toEqual(["parent", "child:/parent/child"]);
  });

  it("не задаёт key, если он не указан", async () => {
    const router = track(createTestRouter({
      routes: [{ path: "/", name: "home", component: leaf("home") }],
    }));
    await router.start();

    expect(router.matched[0]?.record.key).toBeUndefined();
  });
});
