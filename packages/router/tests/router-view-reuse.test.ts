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
  const node = document.createElement("input");
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

  it("обновляет light-компонент без потери focus", async () => {
    const { router, host } = await setup(
      [{ path: "/light/:id", component: LightView as unknown as AnyComponent }],
      "/light/a",
    );
    const input = host.querySelector("input");
    expect(input?.dataset.id).toBe("a");
    input!.focus();
    await router.push("/light/b");
    await tick();
    expect(host.querySelector("input")?.dataset.id).toBe("b");
    expect(document.activeElement).toBe(host.querySelector("input"));
  });

  it("вызывает updated() у ViewModel при смене params", async () => {
    const events: string[] = [];
    class RouteVM {
      constructor() {
        events.push("create");
      }

      updated(): void {
        events.push("updated");
      }

      dispose(): void {
        events.push("dispose");
      }
    }
    function HookView(this: { vm: RouteVM }, props: RouterViewComponentProps): HTMLElement {
      void this.vm;
      const node = document.createElement("b");
      attr(node, "data-id", () => props.params["id"]);
      return node;
    }
    (HookView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
      vm: RouteVM,
      name: "HookView",
    };
    const { router, host } = await setup(
      [{ path: "/hook/:id", component: HookView as unknown as AnyComponent }],
      "/hook/1",
    );
    const node = host.querySelector("b");
    await router.push("/hook/2");
    await tick();
    expect(node?.getAttribute("data-id")).toBe("2");
    expect(events).toEqual(["create", "updated"]);
  });
});

class ParentVM {}

function parentView(
  this: { vm: ParentVM },
  props: RouterViewComponentProps,
): HTMLElement {
  void this.vm;
  const section = document.createElement("section");
  attr(section, "data-parent", () => props.params["id"] ?? "");
  section.appendChild(RouterView({ depth: 1, router: props.router }));
  return section;
}

(parentView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: ParentVM,
  name: "ParentView",
};

class ChildVM {}

function childView(
  this: { vm: ChildVM },
  props: RouterViewComponentProps,
): HTMLElement {
  void this.vm;
  const article = document.createElement("article");
  attr(article, "data-child", () => props.params["postId"] ?? "");
  return article;
}

(childView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: ChildVM,
  name: "ChildView",
};

describe("RouterView: вложенный reuse", () => {
  it("обновляет parent и child без пересоздания", async () => {
    const { router, host } = await setup(
      [
        {
          path: "/u/:id",
          component: parentView as unknown as AnyComponent,
          children: [
            { path: "posts/:postId", component: childView as unknown as AnyComponent },
          ],
        },
      ],
      "/u/1/posts/8",
    );
    const section = host.querySelector("section");
    const article = host.querySelector("article");
    expect(section?.dataset.parent).toBe("1");
    expect(article?.dataset.child).toBe("8");

    await router.push("/u/2/posts/9");
    await tick();

    expect(host.querySelector("section")).toBe(section);
    expect(host.querySelector("article")).toBe(article);
    expect(section?.dataset.parent).toBe("2");
    expect(article?.dataset.child).toBe("9");
  });
});
