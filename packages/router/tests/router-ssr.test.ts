// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  hydrate,
  insert,
  templateHoles,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  Router,
  RouterView,
  createMemoryHistory,
  type RouteInput,
  type RouterViewProps,
} from "../src/index";
import { tick } from "./support";

interface ViewProps {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
}

function userView(props: ViewProps): HTMLElement {
  const heading = document.createElement("h1");
  heading.setAttribute("data-user", props.params["id"] ?? "");
  heading.textContent = `User ${props.params["id"] ?? ""}`;
  return heading;
}

function aboutView(): HTMLElement {
  const heading = document.createElement("h2");
  heading.textContent = "About";
  return heading;
}

const routes: readonly RouteInput[] = [
  { path: "/users/:id", name: "user", component: userView as unknown as AnyComponent },
  { path: "/about", name: "about", component: aboutView as unknown as AnyComponent },
];

const routers: Router[] = [];

function app(router: Router) {
  return (): Node => RouterView({ router } as RouterViewProps);
}

async function createRouter(initial: string): Promise<Router> {
  const router = new Router({ routes, history: createMemoryHistory(initial) });
  routers.push(router);
  await router.start();
  return router;
}

afterEach(() => {
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  document.body.replaceChildren();
});

describe("RouterView: SSR и гидрация", () => {
  it("сериализует маршрут на сервере и гидрирует его без mismatch", async () => {
    const serverRouter = await createRouter("/users/7");
    const rendered = await renderToString(app(serverRouter) as AnyComponent);
    expect(rendered.html).toContain('data-user="7"');
    expect(rendered.html).toContain("silent-router-view");

    const root = document.createElement("div");
    root.innerHTML = rendered.html;
    document.body.appendChild(root);

    const clientRouter = await createRouter("/users/7");
    const mismatches: string[] = [];
    const handle = await hydrate(root, app(clientRouter) as AnyComponent, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    await handle.ready;

    const heading = root.querySelector("[data-user]");
    expect(heading).not.toBeNull();
    expect(heading?.getAttribute("data-user")).toBe("7");
    expect(mismatches).toEqual([]);

    await clientRouter.push("/users/9");
    await tick();

    expect(root.querySelector("[data-user]")?.getAttribute("data-user")).toBe("9");
    expect(mismatches).toEqual([]);
    handle.dispose();
  });

  it("гидрирует вложенную навигацию и смену маршрута", async () => {
    const serverRouter = await createRouter("/about");
    const rendered = await renderToString(app(serverRouter) as AnyComponent);
    expect(rendered.html).toContain("About");

    const root = document.createElement("div");
    root.innerHTML = rendered.html;
    document.body.appendChild(root);

    const clientRouter = await createRouter("/about");
    const mismatches: string[] = [];
    const handle = await hydrate(root, app(clientRouter) as AnyComponent, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    await handle.ready;

    expect(root.textContent).toContain("About");

    await clientRouter.push("/users/3");
    await tick();

    expect(root.querySelector("[data-user]")?.getAttribute("data-user")).toBe("3");
    expect(mismatches).toEqual([]);
    handle.dispose();
  });
});

class AppVM {}

const VIEW = Symbol.for("silent.view");

const appTemplate = templateHoles("<main><!--silent-hole-0--></main>");

function AppView(this: { vm: AppVM }, props: { router: Router }): Node {
  void this.vm;
  const root = appTemplate();
  insert(
    (root.holes[0]?.parentNode as Node | undefined) ?? root.node,
    () => RouterView({ router: props.router }),
    root.holes[0],
  );
  return root.node;
}

(AppView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: AppVM,
  name: "AppView",
};

describe("RouterView: SSR и гидрация с view-корнем", () => {
  it("адоптирует route-view и обновляет его после навигации", async () => {
    const serverRouter = await createRouter("/users/7");
    const rendered = await renderToString(AppView as unknown as AnyComponent, {
      props: { router: serverRouter },
    });
    expect(rendered.html).toContain('data-user="7"');

    const root = document.createElement("div");
    root.innerHTML = rendered.html;
    document.body.appendChild(root);

    const clientRouter = await createRouter("/users/7");
    const mismatches: string[] = [];
    const handle = await hydrate(root, AppView as unknown as AnyComponent, {
      props: { router: clientRouter },
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    await handle.ready;

    expect(root.querySelector("[data-user]")?.getAttribute("data-user")).toBe("7");
    expect(mismatches).toEqual([]);

    await clientRouter.push("/users/9");
    await tick();

    expect(root.querySelector("[data-user]")?.getAttribute("data-user")).toBe("9");
    expect(mismatches).toEqual([]);
    handle.dispose();
  });
});
