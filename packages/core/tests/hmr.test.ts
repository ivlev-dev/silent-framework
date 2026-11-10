import { afterEach, describe, expect, it } from "vitest";
import { hmrInvalidate, hmrUpdate } from "../src/hmr";
import { createComponent } from "../src/component";
import { mount } from "../src/mount";
import { reactive } from "../src/decorators";
import { createRenderEffect, flushSync } from "@ivlev-dev/silent-reactivity";
import type { AnyComponent } from "../src/types";

const VIEW = Symbol.for("silent.view");
const DI_CREATE = Symbol.for("silent.di.create");

interface CounterProps {
  step: number;
}

class CounterVM {
  static readonly instances: CounterVM[] = [];

  @reactive accessor count = 0;

  constructor() {
    CounterVM.instances.push(this);
  }

  readonly events: string[] = [];

  increment(step: number): void {
    this.count += step;
  }

  updated(): void {
    this.events.push("updated");
  }
}

function attachMeta(component: unknown, moduleId: string, name: string): void {
  (component as Record<PropertyKey, unknown>)[VIEW] = {
    vm: CounterVM,
    name,
    moduleId,
  };
}

function Counter(this: { vm: CounterVM }, props: CounterProps): Node {
  const element = document.createElement("span");
  createRenderEffect(() => {
    element.textContent = String(this.vm.count);
  });
  void props;
  return element;
}

function NextCounter(this: { vm: CounterVM }): Node {
  const element = document.createElement("span");
  createRenderEffect(() => {
    element.textContent = `next:${this.vm.count}`;
  });
  return element;
}

const hosts: HTMLElement[] = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

afterEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
});

describe("HMR", () => {
  it("перерисовывает view, сохраняя VM и состояние", async () => {
    attachMeta(Counter, "/app/counter.tsx", "Counter");
    attachMeta(NextCounter, "/app/counter.tsx", "NextCounter");
    const target = host();
    const handle = await mount(target, Counter as AnyComponent, {
      props: { step: 1 },
    });
    const vm = CounterVM.instances.at(-1);
    expect(vm).toBeDefined();
    vm?.increment(5);
    flushSync();
    expect(target.textContent).toBe("5");
    hmrUpdate("/app/counter.tsx", { Counter: NextCounter });
    expect(target.textContent).toBe("next:5");
    expect(vm?.events).toContain("updated");
    handle.dispose();
  });

  it("обновляет preloader во время ожидания VM", async () => {
    class DelayedVM {
      static [DI_CREATE] = async (): Promise<DelayedVM> => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new DelayedVM();
      };
    }
    function LoadingOne(): Node {
      const element = document.createElement("i");
      element.textContent = "one";
      return element;
    }
    function LoadingTwo(): Node {
      const element = document.createElement("i");
      element.textContent = "two";
      return element;
    }
    function DelayedCounter(this: { vm: DelayedVM }): Node {
      const element = document.createElement("span");
      element.textContent = "ready";
      void this.vm;
      return element;
    }
    (DelayedCounter as unknown as Record<PropertyKey, unknown>)[VIEW] = {
      vm: DelayedVM,
      preloader: LoadingOne,
      preloaderName: "LoadingOne",
      name: "DelayedCounter",
      moduleId: "/app/delayed.tsx",
    };
    const result = createComponent(DelayedCounter as AnyComponent, {});
    expect(result.node.textContent).toBe("one");
    hmrInvalidate("/app/delayed.tsx", { LoadingOne: LoadingTwo });
    expect(result.node.textContent).toBe("two");
    await result.ready;
    expect(result.node.textContent).toBe("ready");
    result.dispose();
  });
});
