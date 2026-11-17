import { afterEach, describe, expect, it, vi } from "vitest";
import { Container } from "@ivlev-dev/silent-di";
import {
  Route,
  createGuard,
  createTestRouter,
  type RouteGuardContext,
  type Router,
  type TypedRouteLocation,
} from "../src/index";
import { leaf } from "./support";

const routers: Router[] = [];
const containers: Container[] = [];

function track(router: Router): Router {
  routers.push(router);
  return router;
}

function trackContainer(container: Container): Container {
  containers.push(container);
  return container;
}

afterEach(() => {
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  while (containers.length > 0) {
    containers.pop()?.dispose();
  }
  vi.restoreAllMocks();
});

describe("контекст guard", () => {
  it("передаёт container, router, signal и локации", async () => {
    const container = trackContainer(new Container("guard"));
    const seen: RouteGuardContext[] = [];
    const router = track(createTestRouter({
      container,
      routes: [
        { path: "/", component: leaf("home") },
        {
          path: "/auth",
          name: "auth",
          component: leaf("auth"),
          beforeEnter: (to, from, signal, context) => {
            seen.push(context);
            expect(to.path).toBe("/auth");
            expect(from?.path).toBe("/");
            expect(signal).toBeInstanceOf(AbortSignal);
            return true;
          },
        },
      ],
    }));
    await router.start();
    expect(await router.navigate("/auth")).toBe(true);

    const context = seen[0];
    expect(context).toBeDefined();
    expect(context?.router).toBe(router);
    expect(context?.container).toBe(container);
    expect(context?.to.path).toBe("/auth");
    expect(context?.from?.path).toBe("/");
    expect(context?.to.params).toEqual({});
    expect(context?.signal).toBeInstanceOf(AbortSignal);
    expect(context?.signal.aborted).toBe(false);
  });

  it("передаёт undefined, если container не задан", async () => {
    let container: Container | undefined | "unset" = "unset";
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        {
          path: "/plain",
          component: leaf("plain"),
          beforeEnter: (_to, _from, _signal, context) => {
            container = context.container;
            return true;
          },
        },
      ],
    }));
    await router.start();
    await router.navigate("/plain");
    expect(container).toBeUndefined();
  });

  it("createGuard возвращает редирект", async () => {
    const guard = createGuard((context) =>
      context.to.path === "/private" ? { name: "login" } : true
    );
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/login", name: "login", component: leaf("login") },
        { path: "/private", name: "private", component: leaf("private"), beforeEnter: guard },
      ],
    }));
    await router.start();

    expect(await router.navigate("/private")).toBe(true);
    expect(router.route?.name).toBe("login");
  });

  it("createGuard может запретить переход", async () => {
    const guard = createGuard(() => false);
    const router = track(createTestRouter({
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/closed", component: leaf("closed"), beforeEnter: guard },
      ],
    }));
    await router.start();

    expect(await router.navigate("/closed")).toBe(false);
    expect(router.route?.path).toBe("/");
  });

  it("createGuard получает контекст с container", async () => {
    const container = trackContainer(new Container("guard-context"));
    const handler = vi.fn((context: RouteGuardContext) => context.container !== undefined);
    const guard = createGuard(handler);
    const router = track(createTestRouter({
      container,
      routes: [
        { path: "/", component: leaf("home") },
        { path: "/ctx", component: leaf("ctx"), beforeEnter: guard },
      ],
    }));
    await router.start();
    await router.navigate("/ctx");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].container).toBe(container);
  });

  it("Route.beforeEnter принимает необязательный контекст", async () => {
    let seen: RouteGuardContext | undefined;

    class CtxRoute extends Route {
      readonly path = "/ctx-route";
      readonly name = "ctx-route";
      readonly component = leaf("ctx-route");

      beforeEnter(
        to: TypedRouteLocation,
        _from: TypedRouteLocation | null,
        _signal: AbortSignal,
        context?: RouteGuardContext,
      ): boolean {
        seen = context;
        expect(to.path).toBe("/ctx-route");
        return context?.router !== undefined;
      }
    }

    const container = trackContainer(new Container("class-guard"));
    const router = track(createTestRouter({
      routes: [{ path: "/", component: leaf("home") }, CtxRoute],
      container,
    }));
    await router.start();

    expect(await router.navigate("/ctx-route")).toBe(true);
    expect(seen?.container).toBe(container);
    expect(seen?.router).toBe(router);
  });
});
