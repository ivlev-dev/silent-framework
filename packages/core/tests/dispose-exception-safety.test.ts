// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { onCleanup } from "@ivlev-dev/silent-reactivity";
import { mount } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");

interface FrameVm {
  readonly title: string;
}

function attachMeta(component: unknown, vm: unknown): void {
  (component as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Frame" };
}

function mountHost(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

function asComponent(fn: (this: { vm: FrameVm }) => unknown): AnyComponent {
  return fn as unknown as AnyComponent;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("dispose view-компонента", () => {
  it("освобождает DOM, даже если cleanup бросает исключение", async () => {
    class FrameViewModel implements FrameVm {
      readonly title = "frame";
    }
    function Frame(this: { vm: FrameVm }): HTMLElement {
      onCleanup(() => {
        throw new Error("boom");
      });
      const element = document.createElement("div");
      element.textContent = this.vm.title;
      return element;
    }
    attachMeta(Frame, FrameViewModel);

    const target = mountHost();
    const handle = await mount(target, asComponent(Frame));
    await handle.settled;
    expect(target.innerHTML).toBe(
      "<!--silent-view--><div>frame</div><!--silent-view-end-->",
    );

    expect(() => handle.dispose()).toThrowError("boom");
    expect(target.innerHTML).toBe("");

    expect(() => handle.dispose()).not.toThrow();
  });

  it("собирает ошибки всех фаз и бросает AggregateError", async () => {
    class FrameViewModel implements FrameVm {
      readonly title = "frame";
      beforeUnmount(): void {
        throw new Error("before");
      }
      unmounted(): void {
        throw new Error("after");
      }
    }
    function Frame(this: { vm: FrameVm }): HTMLElement {
      onCleanup(() => {
        throw new Error("cleanup");
      });
      const element = document.createElement("div");
      element.textContent = this.vm.title;
      return element;
    }
    attachMeta(Frame, FrameViewModel);

    const target = mountHost();
    const handle = await mount(target, asComponent(Frame));
    await handle.settled;

    let caught: unknown = null;
    try {
      handle.dispose();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.length).toBe(3);
    expect(target.innerHTML).toBe("");
  });
});
