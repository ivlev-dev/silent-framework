// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { attr, type AnyComponent } from "@ivlev-dev/silent-core";
import { flushSync } from "@ivlev-dev/silent-reactivity";
import {
  Router,
  RouterView,
  createMemoryHistory,
  type RouteInput,
  type RouterViewComponentProps,
} from "../src/index";
import { render, tick, type Rendered } from "./support";

const VIEW = Symbol.for("silent.view");
const routers: Router[] = [];
const rendered: Rendered[] = [];

class FormVM {}

function FormView(
  this: { vm: FormVM },
  props: RouterViewComponentProps,
): HTMLElement {
  void this.vm;
  const input = document.createElement("input");
  input.dataset.view = "form";
  attr(input, "data-id", () => props.params["id"]);
  attr(input, "data-tab", () => String(props.query["tab"] ?? ""));
  return input;
}

(FormView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: FormVM,
  name: "FormView",
};

class StaticVM {}

function StaticView(this: { vm: StaticVM }): HTMLElement {
  void this.vm;
  const node = document.createElement("p");
  node.textContent = "static";
  return node;
}

(StaticView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: StaticVM,
  name: "StaticView",
};

function LightView(props: RouterViewComponentProps): HTMLElement {
  const node = document.createElement("span");
  node.dataset.id = props.params["id"];
  return node;
}

afterEach(() => {
  while (rendered.length > 0) {
    rendered.pop()?.dispose();
  }
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  document.body.replaceChildren();
});

async function setup(
  routes: readonly RouteInput[],
  initial: string,
): Promise<{ router: Router; host: HTMLElement }> {
  const router = new Router({
    routes,
    history: createMemoryHistory(initial),
  });
  routers.push(router);
  await router.start();
  const result = render(() => RouterView({ router }));
  rendered.push(result);
  await tick();
  await tick();
  return { router, host: result.host };
}

describe("RouterView: переиспользование view", () => {
  it("обновляет params и query без пересоздания DOM и focus", async () => {
    const { router, host } = await setup(
      [{ path: "/form/:id", component: FormView as unknown as AnyComponent }],
      "/form/1",
    );
    const input = host.querySelector("input");
    expect(input).not.toBeNull();
    input!.value = "typed";
    input!.focus();

    await router.push("/form/2?tab=files");
    flushSync();
    await tick();

    expect(host.querySelector("input")).toBe(input);
    expect(input!.getAttribute("data-id")).toBe("2");
    expect(input!.getAttribute("data-tab")).toBe("files");
    expect(input!.value).toBe("typed");
    expect(document.activeElement).toBe(input);
  });

  it("пересоздаёт view при смене компонента маршрута", async () => {
    const { router, host } = await setup(
      [
        { path: "/form/:id", component: FormView as unknown as AnyComponent },
        { path: "/static", component: StaticView as unknown as AnyComponent },
      ],
      "/form/1",
    );
    expect(host.querySelector("input")).not.toBeNull();
    await router.push("/static");
    await tick();
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("p")?.textContent).toBe("static");
  });

  it("пересоздаёт light-компонент при смене params", async () => {
    const { router, host } = await setup(
      [{ path: "/light/:id", component: LightView as unknown as AnyComponent }],
      "/light/a",
    );
    const first = host.querySelector("span");
    expect(first?.dataset.id).toBe("a");
    await router.push("/light/b");
    await tick();
    const second = host.querySelector("span");
    expect(second).not.toBe(first);
    expect(second?.dataset.id).toBe("b");
  });
});
