import { afterEach, describe, expect, it, vi } from "vitest";
import {
  component,
  createComponent,
  setDefaultPreloader,
  setErrorHandler,
  whenIdle,
  type AnyComponent,
  type Preloader,
} from "../src/component";
import { mount } from "../src/mount";
import { lazy, Suspense } from "../src/suspense";
import { container, DI_CREATE } from "@silent/di";
import type { Container } from "@silent/di";

const VIEW = Symbol.for("silent.view");
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
  document.body.replaceChildren();
  setErrorHandler(null);
  setDefaultPreloader(null);
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

async function flush(): Promise<void> {
  await whenIdle();
  await Promise.resolve();
  await Promise.resolve();
}

function staticComponent(text: string): () => Node {
  return (): Node => document.createTextNode(text);
}

function Loading(): Node {
  return document.createTextNode("loading");
}

describe("Suspense", () => {
  it("показывает fallback и затем содержимое", async () => {
    const gate = deferred();
    class SlowVM {
      value = "ready";
      static [DI_CREATE] = async (): Promise<SlowVM> => {
        await gate.promise;
        return new SlowVM();
      };
    }
    function Slow(this: { vm: SlowVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Slow, SlowVM);

    const target = host();
    await mount(target, Suspense as unknown as AnyComponent, {
      props: {
        fallback: Loading(),
        children: () => component(Slow as AnyComponent, {}),
      },
    });

    expect(target.textContent).toBe("loading");

    gate.resolve();
    await flush();

    expect(target.textContent).toBe("ready");
  });

  it("монтирует синхронных детей сразу", async () => {
    const target = host();
    await mount(target, Suspense as unknown as AnyComponent, {
      props: {
        fallback: Loading(),
        children: () => staticComponent("content")(),
      },
    });
    expect(target.textContent).toBe("content");
  });

  it("дожидается вложенного Suspense", async () => {
    const gate = deferred();
    class InnerVM {
      value = "inner";
      static [DI_CREATE] = async (): Promise<InnerVM> => {
        await gate.promise;
        return new InnerVM();
      };
    }
    function Inner(this: { vm: InnerVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Inner, InnerVM);

    const target = host();
    await mount(target, Suspense as unknown as AnyComponent, {
      props: {
        fallback: Loading(),
        children: () =>
          component(Suspense as unknown as AnyComponent, {
            fallback: staticComponent("inner-loading")(),
            children: () => component(Inner as AnyComponent, {}),
          }),
      },
    });

    expect(target.textContent).toBe("inner-loading");

    gate.resolve();
    await flush();

    expect(target.textContent).toBe("inner");
  });

  it("убирает fallback при уничтожении без резолва", async () => {
    const gate = deferred();
    class NeverVM {
      static [DI_CREATE] = async (): Promise<NeverVM> => {
        await gate.promise;
        return new NeverVM();
      };
    }
    function Never(this: { vm: NeverVM }): Node {
      return document.createTextNode("never");
    }
    attachMeta(Never, NeverVM);

    const target = host();
    const handle = await mount(target, Suspense as unknown as AnyComponent, {
      props: {
        fallback: Loading(),
        children: () => component(Never as AnyComponent, {}),
      },
    });
    handle.dispose();
    gate.resolve();
    await flush();

    expect(target.textContent).toBe("");
  });
});

describe("lazy", () => {
  it("грузит модуль один раз и рендерит компонент", async () => {
    const loader = vi.fn(async () => ({
      default: staticComponent("lazy") as unknown as AnyComponent,
    }));
    const Lazy = lazy(loader);

    const first = host();
    await mount(first, Lazy as unknown as AnyComponent, {
      preloader: staticComponent("wait"),
    });
    await flush();
    expect(first.textContent).toBe("lazy");

    const second = host();
    await mount(second, Lazy as unknown as AnyComponent);
    await flush();
    expect(second.textContent).toBe("lazy");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("рендерит прелоадер без Suspense", async () => {
    const gate = deferred();
    const loader = vi.fn(async () => {
      await gate.promise;
      return staticComponent("lazy") as unknown as AnyComponent;
    });
    const Lazy = lazy(loader, { preloader: Loading });

    const target = host();
    const handle = mount(target, Lazy as unknown as AnyComponent);
    expect(target.textContent).toBe("loading");

    gate.resolve();
    await handle;
    await flush();
    expect(target.textContent).toBe("lazy");
  });

  it("не рендерит собственный прелоадер внутри Suspense", async () => {
    const gate = deferred();
    const loader = vi.fn(async () => {
      await gate.promise;
      return staticComponent("lazy") as unknown as AnyComponent;
    });
    const Lazy = lazy(loader, { preloader: Loading });

    const target = host();
    await mount(target, Suspense as unknown as AnyComponent, {
      props: {
        fallback: staticComponent("outer-loading")(),
        children: () => component(Lazy as unknown as AnyComponent, {}),
      },
    });
    expect(target.textContent).toBe("outer-loading");

    gate.resolve();
    await flush();
    expect(target.textContent).toBe("lazy");
  });

  it("сообщает об ошибке загрузки", async () => {
    const onError = vi.fn();
    const Lazy = lazy(async () => {
      throw new Error("boom");
    }, { onError });

    const target = host();
    await mount(target, Lazy as unknown as AnyComponent);
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(target.textContent).toBe("Error: boom");
  });
});

describe("наследование DI-скоупа", () => {
  it("передаёт скоуп вложенным компонентам после резолва VM", async () => {
    const token = Symbol("service");
    class ChildVM {
      value = "";
      static [DI_CREATE] = async (di: Container): Promise<ChildVM> => {
        const service = await di.resolve<{ readonly name: string }>(token);
        const vm = new ChildVM();
        vm.value = service.name;
        return vm;
      };
    }
    function Child(this: { vm: ChildVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Child, ChildVM);

    class ParentVM {}
    function Parent(this: { vm: ParentVM }): Node {
      const element = document.createElement("div");
      void this.vm;
      element.appendChild(component(Child as AnyComponent, {}));
      return element;
    }
    attachMeta(Parent, ParentVM);

    const scope = container.createScope("parent");
    scope.bind(token, () => ({ name: "scoped" }));

    const target = host();
    const handle = await mount(target, Parent as unknown as AnyComponent, {
      container: scope,
    });
    await flush();

    expect(target.textContent).toBe("scoped");
    handle.dispose();
    expect(target.textContent).toBe("");
  });

  it("наследует скоуп через синхронные компоненты", async () => {
    const token = Symbol("sync-service");
    class LeafVM {
      value = "";
      static [DI_CREATE] = async (di: Container): Promise<LeafVM> => {
        const service = await di.resolve<{ readonly name: string }>(token);
        const vm = new LeafVM();
        vm.value = service.name;
        return vm;
      };
    }
    function Leaf(this: { vm: LeafVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Leaf, LeafVM);

    function Wrapper(): Node {
      return component(Leaf as AnyComponent, {});
    }

    const scope = container.createScope("sync-parent");
    scope.bind(token, () => ({ name: "sync-scoped" }));

    const target = host();
    await mount(target, Wrapper as unknown as AnyComponent, {
      container: scope,
    });
    await flush();

    expect(target.textContent).toBe("sync-scoped");
  });
});

describe("createComponent ready", () => {
  it("дожидается готовности узла синхронного компонента", async () => {
    class LateVM {
      value = "late";
      static [DI_CREATE] = async (): Promise<LateVM> => {
        await Promise.resolve();
        return new LateVM();
      };
    }
    function Late(this: { vm: LateVM }): Node {
      return document.createTextNode(this.vm.value);
    }
    attachMeta(Late, LateVM);

    function Wrapper(): Node {
      return component(Late as AnyComponent, {});
    }

    const result = createComponent(Wrapper as unknown as AnyComponent);
    await result.ready;
    expect(result.node.textContent).toBe("late");
  });
});
