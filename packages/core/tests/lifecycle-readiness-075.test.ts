// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRoot,
  createSignal,
  flushSync,
} from "@ivlev-dev/silent-reactivity";
import { container, DI_CREATE } from "@ivlev-dev/silent-di";
import type { Container } from "@ivlev-dev/silent-di";
import {
  createComponent,
  getOwnReady,
  getReady,
  whenIdle,
  type ComponentResult,
} from "../src/component.js";
import { component } from "../src/component-lite.js";
import { mount } from "../src/mount.js";
import { insert, attr } from "../src/dom.js";
import { Show } from "../src/control-flow.js";
import { ErrorBoundary } from "../src/error-boundary.js";
import { Suspense, lazy } from "../src/suspense.js";
import { getViewInstances } from "../src/registry.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];
const disposers: Array<() => void> = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function attachMeta(
  target: unknown,
  vm: unknown,
  extra: Record<string, unknown> = {},
): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Test", ...extra };
}

function asComponent(fn: (...args: never[]) => unknown): AnyComponent {
  return fn as unknown as AnyComponent;
}

async function flush(): Promise<void> {
  await whenIdle();
  flushSync();
  await Promise.resolve();
  await Promise.resolve();
}

function track(dispose: () => void): void {
  disposers.push(dispose);
}

function inRoot<T>(fn: () => T): T {
  let value: T | null = null;
  const stop = createRoot((dispose) => {
    track(dispose);
    value = fn();
    return null;
  });
  void stop;
  return value as T;
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("готовность: ready и settled", () => {
  it("mount.ready ждёт корень, mount.settled — async-потомка", async () => {
    const gate = deferred();
    class RootVM {
      readonly value = "root";
    }
    class ChildVM {
      readonly value = "child";
      static [DI_CREATE] = async (): Promise<ChildVM> => {
        await gate.promise;
        return new ChildVM();
      };
    }
    function Child(this: { vm: ChildVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Child, ChildVM);
    function Root(this: { vm: RootVM }): Node {
      const element = document.createElement("div");
      void this.vm;
      element.appendChild(component(Child as AnyComponent, {}));
      return element;
    }
    attachMeta(Root, RootVM);

    const target = host();
    const handle = await mount(target, Root as AnyComponent);
    let settled = false;
    void handle.settled.then(() => {
      settled = true;
    });

    await handle.ready;
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(target.textContent).toBe("");

    gate.resolve();
    await handle.settled;

    expect(settled).toBe(true);
    expect(target.textContent).toBe("child");
    handle.dispose();
  });

  it("getReady фрагмента агрегирует готовность всех детей", async () => {
    const first = deferred();
    const second = deferred();
    class FirstVM {
      static [DI_CREATE] = async (): Promise<FirstVM> => {
        await first.promise;
        return new FirstVM();
      };
    }
    class SecondVM {
      static [DI_CREATE] = async (): Promise<SecondVM> => {
        await second.promise;
        return new SecondVM();
      };
    }
    function First(this: { vm: FirstVM }): Node {
      void this.vm;
      return document.createTextNode("1");
    }
    function Second(this: { vm: SecondVM }): Node {
      void this.vm;
      return document.createTextNode("2");
    }
    attachMeta(First, FirstVM);
    attachMeta(Second, SecondVM);

    const result = inRoot(() =>
      createComponent(
        asComponent(() => [
          component(First as AnyComponent, {}),
          component(Second as AnyComponent, {}),
        ]),
      ),
    );
    const fragment = result.node;
    expect(fragment).toBeInstanceOf(DocumentFragment);
    expect(await getOwnReady(fragment)).toBeUndefined();

    let ready = false;
    void getReady(fragment).then(() => {
      ready = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);

    second.resolve();
    await flush();
    expect(ready).toBe(true);

    result.dispose();
  });
});

describe("light-компоненты", () => {
  it("обновление reactive props сохраняет focus и не пересоздаёт инстанс", () => {
    const [label, setLabel] = createSignal("a");
    const [seed, setSeed] = createSignal(0);
    const hostElement = host();
    let calls = 0;

    function Field(props: {
      readonly label: string;
      readonly seed: number;
    }): Node {
      calls += 1;
      const input = document.createElement("input");
      attr(input, "value", () => props.label);
      void props.seed;
      return input;
    }

    let stop: () => void = () => {};
    createRoot((dispose) => {
      stop = dispose;
      insert(hostElement, () =>
        component(Field as unknown as AnyComponent, {
          get label(): string {
            return label();
          },
          get seed(): number {
            return seed();
          },
        }),
      );
      return null;
    });
    track(stop);

    const input = hostElement.querySelector("input");
    expect(input).not.toBeNull();
    input!.focus();
    expect(document.activeElement).toBe(input);

    setLabel("b");
    flushSync();
    expect(hostElement.querySelector("input")).toBe(input);
    expect(input?.value).toBe("b");
    expect(document.activeElement).toBe(input);

    setSeed(1);
    flushSync();
    expect(calls).toBe(1);
    expect(hostElement.querySelector("input")).toBe(input);
    expect(document.activeElement).toBe(input);
  });
});

describe("Suspense: освобождение отложенных детей", () => {
  it("dispose во время fallback освобождает VM и scope", async () => {
    const gate = deferred();
    class NeverVM {
      disposed = false;
      static last: NeverVM | null = null;
      static [DI_CREATE] = async (): Promise<NeverVM> => {
        await gate.promise;
        const vm = new NeverVM();
        NeverVM.last = vm;
        return vm;
      };
      dispose(): void {
        this.disposed = true;
      }
    }
    function Never(this: { vm: NeverVM }): Node {
      return document.createTextNode("never");
    }
    attachMeta(Never, NeverVM);

    const scope = container.createScope("suspense-dispose");
    const target = host();
    const handle = await mount(target, Suspense as unknown as AnyComponent, {
      container: scope,
      props: {
        fallback: document.createTextNode("loading"),
        children: () => component(Never as AnyComponent, {}),
      },
    });

    const scopeChildren = (scope as unknown as { children: Set<Container> }).children;
    expect(target.textContent).toBe("loading");
    expect(scopeChildren.size).toBeGreaterThan(0);

    handle.dispose();
    await handle.settled;
    expect(scopeChildren.size).toBe(0);

    gate.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await flush();
    expect(NeverVM.last).not.toBeNull();
    expect(NeverVM.last?.disposed).toBe(true);
    expect(target.textContent).toBe("");
    scope.dispose();
  });

  it("dispose снимает незавершённую lazy-загрузку", async () => {
    const gate = deferred();
    const Lazy = lazy(async () => {
      await gate.promise;
      return () => document.createTextNode("later");
    });
    const scope = container.createScope("lazy-dispose");
    const target = host();
    const handle = await mount(target, Suspense as unknown as AnyComponent, {
      container: scope,
      props: {
        fallback: document.createTextNode("loading"),
        children: () => component(Lazy as AnyComponent, {}),
      },
    });
    expect(target.textContent).toBe("loading");

    handle.dispose();
    await handle.settled;

    gate.resolve();
    await flush();
    expect(target.textContent).toBe("");
    scope.dispose();
  });
});

describe("runtime-контекст из Show/insert", () => {
  it("компонент из Show наследует DI-скоуп", async () => {
    const token = Symbol("show-scope");
    const scope = container.createScope("show-scope");
    scope.bind(token, () => ({ name: "scoped" }));

    class ScopedVM {
      readonly name: string;
      static [DI_CREATE] = async (di: Container): Promise<ScopedVM> => {
        const service = await di.resolve<{ readonly name: string }>(token);
        const vm = new ScopedVM(service.name);
        return vm;
      };
      constructor(name: string) {
        this.name = name;
      }
    }
    function Scoped(this: { vm: ScopedVM }): Node {
      return document.createTextNode(this.vm.name);
    }
    attachMeta(Scoped, ScopedVM);

    const [open, setOpen] = createSignal(false);
    function Parent(): Node {
      const element = document.createElement("div");
      insert(element, () =>
        Show({
          when: () => open(),
          fallback: () => null,
          children: () => component(Scoped as AnyComponent, {}),
        }),
      );
      return element;
    }

    const target = host();
    const handle = await mount(target, Parent as AnyComponent, {
      container: scope,
    });
    expect(target.textContent).toBe("");

    setOpen(true);
    flushSync();
    await whenIdle();
    expect(target.textContent).toBe("scoped");

    handle.dispose();
    scope.dispose();
  });

  it("компонент из insert наследует onError", async () => {
    const onError = vi.fn();
    class FailVM {
      static [DI_CREATE] = async (): Promise<FailVM> => {
        throw new Error("insert-fail");
      };
    }
    function Fail(this: { vm: FailVM }): Node {
      void this.vm;
      return document.createTextNode("ok");
    }
    attachMeta(Fail, FailVM);

    const [open, setOpen] = createSignal(false);
    function Parent(): Node {
      const element = document.createElement("div");
      insert(element, () =>
        open() ? component(Fail as AnyComponent, {}) : null,
      );
      return element;
    }

    const target = host();
    const handle = await mount(target, Parent as AnyComponent, { onError });
    setOpen(true);
    flushSync();
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String((onError.mock.calls[0]?.[0] as Error).message)).toBe(
      "insert-fail",
    );
    handle.dispose();
  });

  it("компонент из Show регистрируется в Suspense через owner-контекст", async () => {
    const gate = deferred();
    class SlowVM {
      readonly value = "slow";
      static [DI_CREATE] = async (): Promise<SlowVM> => {
        await gate.promise;
        return new SlowVM();
      };
    }
    function Slow(this: { vm: SlowVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Slow, SlowVM);

    function Inner(): Node {
      const element = document.createElement("div");
      insert(element, () =>
        Show({
          when: () => true,
          children: () => component(Slow as AnyComponent, {}),
        }),
      );
      return element;
    }

    const target = host();
    const handle = await mount(target, Suspense as unknown as AnyComponent, {
      props: {
        fallback: document.createTextNode("fallback"),
        children: () => component(Inner as AnyComponent, {}),
      },
    });

    expect(target.textContent).toBe("fallback");
    gate.resolve();
    await flush();
    expect(target.textContent).toBe("slow");
    handle.dispose();
  });
});

describe("HMR lifecycle", () => {
  it("recreateVm проходит beforeUnmount/unmounted и очищает scope-сервисы", async () => {
    const moduleId = "/app/hmr-lifecycle.tsx";
    const token = Symbol("service");
    const scope = container.createScope("hmr");
    let factoryCalls = 0;
    scope.bind(token, () => {
      factoryCalls += 1;
      return { id: factoryCalls };
    }).inScopedScope();

    class FirstVM {
      readonly events: string[] = [];
      static last: FirstVM | null = null;
      constructor() {
        FirstVM.last = this;
      }
      created(): void {
        this.events.push("created");
      }
      beforeMount(): void {
        this.events.push("beforeMount");
      }
      mounted(): void {
        this.events.push("mounted");
      }
      beforeUnmount(): void {
        this.events.push("beforeUnmount");
      }
      unmounted(): void {
        this.events.push("unmounted");
      }
      dispose(): void {
        this.events.push("dispose");
      }
      static [DI_CREATE] = async (di: Container): Promise<FirstVM> => {
        await di.resolve(token);
        return new FirstVM();
      };
    }
    class SecondVM {
      readonly events: string[] = [];
      static last: SecondVM | null = null;
      constructor() {
        SecondVM.last = this;
      }
      created(): void {
        this.events.push("created");
      }
      beforeMount(): void {
        this.events.push("beforeMount");
      }
      mounted(): void {
        this.events.push("mounted");
      }
      static [DI_CREATE] = async (di: Container): Promise<SecondVM> => {
        await di.resolve(token);
        return new SecondVM();
      };
    }
    function View(this: { vm: FirstVM | SecondVM }): Node {
      return document.createTextNode("view");
    }
    attachMeta(View, FirstVM, { moduleId, name: "View" });

    const target = host();
    const handle = await mount(target, View as AnyComponent, {
      container: scope,
    });
    const [instance] = getViewInstances(moduleId);
    expect(instance).toBeDefined();

    const before = factoryCalls;
    await instance!.recreateVm(SecondVM);
    await whenIdle();

    expect(factoryCalls).toBeGreaterThan(before);
    expect(FirstVM.last?.events).toEqual([
      "created",
      "beforeMount",
      "mounted",
      "beforeUnmount",
      "unmounted",
      "dispose",
    ]);
    expect(SecondVM.last?.events).toEqual(["created", "beforeMount", "mounted"]);
    handle.dispose();
    scope.dispose();
  });

  it("rerender корректно освобождает дочерние VM", async () => {
    const moduleId = "/app/hmr-parent-child.tsx";
    class ParentVM {
      readonly label = "parent";
    }
    class ChildVM {
      readonly events: string[] = [];
      static last: ChildVM | null = null;
      constructor() {
        ChildVM.last = this;
      }
      beforeUnmount(): void {
        this.events.push("beforeUnmount");
      }
      unmounted(): void {
        this.events.push("unmounted");
      }
      dispose(): void {
        this.events.push("dispose");
      }
      mounted(): void {
        this.events.push("mounted");
      }
    }
    function Child(this: { vm: ChildVM }): Node {
      void this.vm;
      return document.createTextNode("child");
    }
    attachMeta(Child, ChildVM, { name: "Child" });
    function ParentView(this: { vm: ParentVM }): Node {
      const element = document.createElement("div");
      void this.vm;
      element.appendChild(component(Child as AnyComponent, {}));
      return element;
    }
    function NextParentView(this: { vm: ParentVM }): Node {
      const element = document.createElement("section");
      void this.vm;
      element.appendChild(component(Child as AnyComponent, {}));
      return element;
    }
    attachMeta(ParentView, ParentVM, { moduleId, name: "ParentView" });

    const target = host();
    const handle = await mount(target, ParentView as AnyComponent);
    await whenIdle();
    const firstChild = ChildVM.last;
    expect(firstChild).not.toBeNull();

    const { hmrUpdate } = await import("../src/hmr.js");
    hmrUpdate(moduleId, { ParentView: NextParentView });
    await whenIdle();

    expect(ChildVM.last).not.toBe(firstChild);
    expect(firstChild?.events).toEqual([
      "mounted",
      "beforeUnmount",
      "unmounted",
      "dispose",
    ]);
    expect(ChildVM.last?.events).toEqual(["mounted"]);
    expect(target.querySelector("section")).not.toBeNull();
    handle.dispose();
  });

  it("recreateVm не оставляет VM, пришедшую после готовности старого поколения", async () => {
    const moduleId = "/app/hmr-race.tsx";
    const gate = deferred();
    class SlowVM {
      readonly label = "slow";
      disposed = false;
      static last: SlowVM | null = null;
      static [DI_CREATE] = async (): Promise<SlowVM> => {
        await gate.promise;
        const vm = new SlowVM();
        SlowVM.last = vm;
        return vm;
      };
      dispose(): void {
        this.disposed = true;
      }
    }
    class FastVM {
      readonly label = "fast";
    }
    function View(this: { vm: SlowVM | FastVM }): Node {
      return document.createTextNode(this.vm.label);
    }
    attachMeta(View, SlowVM, { moduleId, name: "View" });

    const result: ComponentResult = inRoot(() =>
      createComponent(View as AnyComponent, {}),
    );
    await Promise.resolve();
    const [instance] = getViewInstances(moduleId);
    expect(instance).toBeDefined();

    const recreation = instance!.recreateVm(FastVM);
    gate.resolve();
    await recreation;
    await result.settled;

    expect(SlowVM.last?.disposed).toBe(true);
    expect(result.node.textContent).toBe("fast");
    result.dispose();
  });
});

describe("ErrorBoundary и lazy", () => {
  it("ловит ошибку загрузки lazy", async () => {
    const Lazy = lazy(async () => {
      throw new Error("lazy-boom");
    });

    const target = host();
    let stop: () => void = () => {};
    createRoot((dispose) => {
      stop = dispose;
      target.appendChild(
        ErrorBoundary({
          fallback: (error) =>
            document.createTextNode(`caught:${(error as Error).message}`),
          children: () => component(Lazy as AnyComponent, {}),
        }),
      );
      return null;
    });
    track(stop);

    await flush();
    expect(target.textContent).toBe("caught:lazy-boom");
  });

  it("dispose освобождает fallback после поздней ошибки", async () => {
    const gate = deferred();
    const Lazy = lazy(async () => {
      await gate.promise;
      throw new Error("late-boom");
    });

    const target = host();
    let stop: () => void = () => {};
    createRoot((dispose) => {
      stop = dispose;
      target.appendChild(
        ErrorBoundary({
          fallback: (error) => document.createTextNode(`late:${(error as Error).message}`),
          children: () => component(Lazy as AnyComponent, {}),
        }),
      );
      return null;
    });

    stop();
    gate.resolve();
    await flush();
    expect(target.textContent).toBe("");
  });
});
