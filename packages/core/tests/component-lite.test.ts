import { afterEach, describe, expect, it } from "vitest";
import { mount } from "../src/mount.js";
import { hydrate } from "../src/hydrate.js";
import { component } from "../src/component-lite.js";
import {
  ViewRuntimeUnavailableError,
  setComponentCreator,
} from "../src/component-state.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

afterEach(() => {
  setComponentCreator(null);
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

function attachMeta(component_: unknown, vm: unknown): void {
  (component_ as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Test" };
}

function asComponent(fn: () => unknown): AnyComponent {
  return fn as unknown as AnyComponent;
}

describe("light-путь", () => {
  it("рендерит синхронный компонент без view-рантайма", async () => {
    setComponentCreator(null);
    const target = host();
    await mount(target, asComponent(() => document.createTextNode("sync")));
    expect(target.textContent).toBe("sync");
  });

  it("монтирует VM через динамический view-рантайм", async () => {
    class TextVM {
      value = "vm";
    }
    function TextView(this: { vm: TextVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(TextView, TextVM);

    const target = host();
    await mount(target, TextView as unknown as AnyComponent);
    expect(target.textContent).toBe("vm");
  });

  it("повторяет рендер при VM-потомке в синхронном корне", async () => {
    setComponentCreator(null);
    class ChildVM {
      value = "child";
    }
    function Child(this: { vm: ChildVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Child, ChildVM);

    const target = host();
    await mount(
      target,
      asComponent(() => component(Child as AnyComponent, {})),
    );
    expect(target.textContent).toBe("child");
  });

  it("бросает ViewRuntimeUnavailableError без загруженного креатора", () => {
    setComponentCreator(null);
    class DetachedVM {}
    function Detached(this: { vm: DetachedVM }): Node {
      void this.vm;
      return document.createComment("detached");
    }
    attachMeta(Detached, DetachedVM);

    expect(() => component(Detached as AnyComponent, {})).toThrow(
      ViewRuntimeUnavailableError,
    );
  });

  it("гидрирует VM-потомка в синхронном корне после повторной попытки", async () => {
    setComponentCreator(null);
    class ChildVM {
      value = "child";
    }
    function Child(this: { vm: ChildVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Child, ChildVM);

    const target = host("<!--silent-view-->child<!--silent-view-end-->");
    await hydrate(
      target,
      asComponent(() => component(Child as AnyComponent, {})),
      { onMismatch: () => undefined },
    );
    expect(target.textContent).toBe("child");
    expect(target.innerHTML).toBe(
      "<!--silent-view-->child<!--silent-view-end-->",
    );
  });
});
