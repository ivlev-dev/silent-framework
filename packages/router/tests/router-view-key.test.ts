// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { attr, type AnyComponent } from "@ivlev-dev/silent-core";
import {
  Router,
  RouterView,
  createTestRouter,
  type RouteRecord,
  type RouterViewComponentProps,
} from "../src/index";
import { render, tick, type Rendered } from "./support";

const VIEW = Symbol.for("silent.view");
const routers: Router[] = [];
const rendered: Rendered[] = [];

function track(router: Router): Router {
  routers.push(router);
  return router;
}

function mount(factory: () => Node): Rendered {
  const result = render(factory);
  rendered.push(result);
  return result;
}

class KeyedVM {
  static readonly instances: KeyedVM[] = [];

  constructor() {
    KeyedVM.instances.push(this);
  }

  updated(): void {
    return;
  }

  dispose(): void {
    return;
  }
}

function KeyedView(
  this: { vm: KeyedVM },
  props: RouterViewComponentProps,
): HTMLElement {
  void this.vm;
  const element = document.createElement("div");
  element.dataset.view = "keyed";
  attr(element, "data-id", () => props.params["id"] ?? "");
  return element;
}

(KeyedView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: KeyedVM,
  name: "KeyedView",
};

afterEach(() => {
  while (rendered.length > 0) {
    rendered.pop()?.dispose();
  }
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  KeyedVM.instances.length = 0;
  document.body.replaceChildren();
});

const routes: readonly RouteRecord[] = [
  {
    path: "/keyed/:id",
    name: "keyed",
    component: KeyedView as unknown as AnyComponent,
    key: (to) => to.params["id"] ?? "",
  },
  {
    path: "/plain/:id",
    name: "plain",
    component: KeyedView as unknown as AnyComponent,
  },
  {
    path: "/number/:id",
    name: "number",
    component: KeyedView as unknown as AnyComponent,
    key: (to) => Number(to.params["id"]),
  },
];

async function setup(initial: string): Promise<{ router: Router; host: HTMLElement }> {
  const router = track(createTestRouter({ routes, initial }));
  await router.start();
  const result = mount(() => RouterView({ router }));
  await tick();
  return { router, host: result.host };
}

describe("RouterView: key маршрута", () => {
  it("пересоздаёт DOM при смене key с тем же компонентом", async () => {
    const { router, host } = await setup("/keyed/1");
    const first = host.querySelector("[data-view=keyed]");
    expect(first).not.toBeNull();
    expect(first?.getAttribute("data-id")).toBe("1");
    expect(KeyedVM.instances).toHaveLength(1);

    await router.push("/keyed/2");
    await tick();

    const second = host.querySelector("[data-view=keyed]");
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second?.getAttribute("data-id")).toBe("2");
    expect(KeyedVM.instances).toHaveLength(2);
  });

  it("переиспользует DOM без key при том же компоненте", async () => {
    const { router, host } = await setup("/plain/1");
    const first = host.querySelector("[data-view=keyed]");
    expect(first).not.toBeNull();

    await router.push("/plain/2");
    await tick();

    const second = host.querySelector("[data-view=keyed]");
    expect(second).toBe(first);
    expect(second?.getAttribute("data-id")).toBe("2");
    expect(KeyedVM.instances).toHaveLength(1);
  });

  it("не пересоздаёт DOM при неизменном key", async () => {
    const { router, host } = await setup("/number/7");
    const first = host.querySelector("[data-view=keyed]");

    await router.push("/number/7?tab=files");
    await tick();

    expect(host.querySelector("[data-view=keyed]")).toBe(first);
    expect(KeyedVM.instances).toHaveLength(1);
  });

  it("пересоздаёт DOM при смене числового key", async () => {
    const { router, host } = await setup("/number/1");
    const first = host.querySelector("[data-view=keyed]");

    await router.push("/number/2");
    await tick();

    const second = host.querySelector("[data-view=keyed]");
    expect(second).not.toBe(first);
    expect(second?.getAttribute("data-id")).toBe("2");
    expect(KeyedVM.instances).toHaveLength(2);
  });
});
