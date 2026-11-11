import { afterEach, describe, expect, it } from "vitest";
import { hydrate } from "../src/hydrate.js";
import { createRenderEffect, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { container, DI_CREATE } from "@ivlev-dev/silent-di";
import type { AnyComponent, Preloader } from "../src/types.js";

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
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

function attachMeta(component: unknown, vm: unknown, preloader?: Preloader): void {
  (component as Record<PropertyKey, unknown>)[VIEW] = {
    vm,
    name: "Test",
    ...(preloader !== undefined ? { preloader } : {}),
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("hydrate", () => {
  it("сохраняет серверную разметку до готовности VM", async () => {
    const gate = deferred();
    class SlowVM {
      value = "client";
      static [DI_CREATE] = async (): Promise<SlowVM> => {
        await gate.promise;
        return new SlowVM();
      };
    }
    function View(this: { vm: SlowVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(View, SlowVM);

    const target = host('<p id="server">server markup</p>');
    const hydration = hydrate(target, View as unknown as AnyComponent, { onMismatch: () => undefined });
    expect(target.textContent).toBe("server markup");

    gate.resolve();
    await hydration;
    expect(target.textContent).toBe("client");
    expect(target.querySelector("#server")).toBeNull();
  });

  it("заменяет устаревшую серверную разметку", async () => {
    class FreshVM {
      value = "fresh";
    }
    function View(this: { vm: FreshVM }): Node {
      const element = document.createElement("span");
      element.textContent = this.vm.value;
      return element;
    }
    attachMeta(View, FreshVM);

    const target = host("<div>stale</div>");
    await hydrate(target, View as unknown as AnyComponent, { onMismatch: () => undefined });
    expect(target.innerHTML).toBe(
      "<!--silent-view--><span>fresh</span><!--silent-view-end-->",
    );
  });

  it("не показывает прелоадер поверх готовой разметки", async () => {
    const gate = deferred();
    class SlowVM {
      value = "ready";
      static [DI_CREATE] = async (): Promise<SlowVM> => {
        await gate.promise;
        return new SlowVM();
      };
    }
    function View(this: { vm: SlowVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    function Loading(): Node {
      return document.createTextNode("loading");
    }
    attachMeta(View, SlowVM, Loading);

    const target = host("<b>server</b>");
    const hydration = hydrate(target, View as unknown as AnyComponent, { onMismatch: () => undefined });
    await Promise.resolve();
    expect(target.textContent).toBe("server");

    gate.resolve();
    await hydration;
    expect(target.textContent).toBe("ready");
  });

  it("оставляет интерактивность после гидрации", async () => {
    const [count, setCount] = createSignal(0);
    class CounterVM {}
    function Counter(this: { vm: CounterVM }): Node {
      const button = document.createElement("button");
      void this.vm;
      createRenderEffect(() => {
        button.textContent = String(count());
      });
      button.addEventListener("click", () => setCount((value) => value + 1));
      return button;
    }
    attachMeta(Counter, CounterVM);

    const target = host("<button>0</button>");
    await hydrate(target, Counter as unknown as AnyComponent, { onMismatch: () => undefined });
    expect(target.textContent).toBe("0");

    target.querySelector("button")?.click();
    flushSync();
    expect(target.textContent).toBe("1");
  });

  it("наследует DI-скоуп и очищается через dispose", async () => {
    const token = Symbol("service");
    class ScopedVM {
      value = "";
      static [DI_CREATE] = async (di: typeof container): Promise<ScopedVM> => {
        const service = await di.resolve<{ readonly name: string }>(token);
        const vm = new ScopedVM();
        vm.value = service.name;
        return vm;
      };
    }
    function Scoped(this: { vm: ScopedVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Scoped, ScopedVM);

    const scope = container.createScope("hydrate");
    scope.bind(token, () => ({ name: "scoped" }));
    const target = host("<i>server</i>");
    const handle = await hydrate(target, Scoped as unknown as AnyComponent, {
      container: scope,
      onMismatch: () => undefined,
    });
    expect(target.textContent).toBe("scoped");

    handle.dispose();
    expect(target.textContent).toBe("");
    scope.dispose();
  });
});
