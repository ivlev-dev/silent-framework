import { afterEach, describe, expect, it } from "vitest";
import {
  createRenderEffect,
  createSignal,
  flushSync,
  setEffectErrorHandler,
} from "@ivlev-dev/silent-reactivity";
import { mount } from "../src/mount.js";
import { hydrate } from "../src/hydrate.js";
import { insert } from "../src/dom.js";
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
    const handle = await mount(
      target,
      asComponent(() => component(Child as AnyComponent, {})),
    );
    await handle.settled;
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

  it("ошибка ре-рендера сохраняет старый DOM и его эффекты", async () => {
    setComponentCreator(null);
    const [text, setText] = createSignal("a");
    const [suffix, setSuffix] = createSignal("!");
    const errors: unknown[] = [];
    const previousHandler = setEffectErrorHandler((error) => {
      errors.push(error);
    });

    function Marker(props: { readonly text: string }): HTMLElement {
      const element = document.createElement("span");
      element.textContent = props.text;
      createRenderEffect(() => {
        element.dataset.suffix = suffix();
      });
      if (props.text === "boom") {
        throw new Error("render failed");
      }
      return element;
    }

    function App(): HTMLElement {
      const element = document.createElement("div");
      insert(element, () =>
        component(Marker as unknown as AnyComponent, { text: text() }),
      );
      return element;
    }

    try {
      const target = host();
      await mount(target, asComponent(() => App()));
      expect(target.textContent).toBe("a");

      setText("boom");
      flushSync();
      expect(errors.some((error) => String(error).includes("render failed"))).toBe(
        true,
      );
      // Старый DOM остаётся, а его render-root не освобождён.
      expect(target.textContent).toBe("a");
      expect(target.innerHTML).not.toContain("boom");

      setSuffix("?");
      flushSync();
      expect(target.querySelector("span")?.dataset.suffix).toBe("?");
    } finally {
      setEffectErrorHandler(previousHandler);
    }
  });

  it("не зацикливает внешний insert-эффект через чтения и записи в теле компонента", async () => {
    setComponentCreator(null);
    let renders = 0;
    const [counter, setCounter] = createSignal(0);

    function Writer(props: { readonly label: string }): HTMLElement {
      renders += 1;
      const previous = counter();
      const element = document.createElement("span");
      element.textContent = `${props.label}:${String(previous)}`;
      setCounter(previous + 1);
      return element;
    }

    function App(): HTMLElement {
      const element = document.createElement("div");
      insert(element, () =>
        component(Writer as unknown as AnyComponent, {
          get label() {
            return `run-${String(counter())}`;
          },
        }),
      );
      return element;
    }

    const target = host();
    await mount(target, asComponent(() => App()));
    flushSync();
    expect(renders).toBeLessThanOrEqual(2);
  });
});
