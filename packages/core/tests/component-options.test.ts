import { afterEach, describe, expect, it, vi } from "vitest";
import {
  component,
  getRuntimeOptions,
  setErrorHandler,
  whenIdle,
  withRuntimeOptions,
} from "../src/component";
import type { AnyComponent } from "../src/types";
import { createRoot, getOwner, runWithOwner } from "@ivlev-dev/silent-reactivity";
import { disposeNode } from "../src/dom";
import { Container, DI_CREATE } from "@ivlev-dev/silent-di";

const VIEW = Symbol.for("silent.view");
const DEP = Symbol("dep");

interface Dep {
  readonly id: string;
}

interface Edge {
  readonly token: symbol;
}

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = {
    vm,
    name: "OptionsView",
    moduleId: "/app/options-view.tsx",
  };
}

function scopeWith(id: string): { container: Container; dep: Dep } {
  const container = new Container(`options-${id}`, undefined, {
    implicitBindings: "allow",
  });
  const dep: Dep = { id };
  container.bind(DEP, () => dep);
  return { container, dep };
}

const roots: Node[] = [];

function render(fn: AnyComponent, options?: Parameters<typeof component>[2]): Node {
  const node = component(fn, {}, options);
  roots.push(node);
  return node;
}

async function resolveDep(di: Container): Promise<{ readonly id: string }> {
  const edge: Edge = { token: DEP };
  return di.resolve<{ readonly id: string }>(edge.token);
}

async function flush(): Promise<void> {
  await whenIdle();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  for (const node of roots.splice(0)) {
    disposeNode(node);
  }
  document.body.replaceChildren();
  setErrorHandler(null);
});

describe("component options", () => {
  it("передаёт явный контейнер в VM и вложенный компонент", async () => {
    const resolved: Dep[] = [];

    class RootVM {
      static [DI_CREATE] = async (di: Container): Promise<RootVM> => {
        resolved.push(await resolveDep(di));
        return new RootVM();
      };
    }

    class ChildVM {
      static [DI_CREATE] = async (di: Container): Promise<ChildVM> => {
        resolved.push(await resolveDep(di));
        return new ChildVM();
      };
    }

    const { container, dep } = scopeWith("A");

    function Child(this: { vm: ChildVM }): Node {
      void this.vm;
      return document.createTextNode("child");
    }
    attachMeta(Child, ChildVM);

    function Root(this: { vm: RootVM }): Node {
      void this.vm;
      const element = document.createElement("div");
      element.appendChild(component(Child as AnyComponent, {}, { container }));
      return element;
    }
    attachMeta(Root, RootVM);

    expect(getRuntimeOptions().container).toBeUndefined();
    render(Root as AnyComponent, { container });
    await flush();

    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toBe(dep);
    expect(resolved[1]).toBe(dep);
  });

  it("явный аргумент перекрывает withRuntimeOptions", async () => {
    const resolved: Dep[] = [];

    class ViewVM {
      static [DI_CREATE] = async (di: Container): Promise<ViewVM> => {
        resolved.push(await resolveDep(di));
        return new ViewVM();
      };
    }
    function View(this: { vm: ViewVM }): Node {
      void this.vm;
      return document.createTextNode("view");
    }
    attachMeta(View, ViewVM);

    const a = scopeWith("A");
    const b = scopeWith("B");

    withRuntimeOptions({ container: b.container }, () => {
      render(View as AnyComponent, { container: a.container });
    });
    await flush();

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBe(a.dep);
  });

  it("без явного аргумента сохраняет withRuntimeOptions", async () => {
    const resolved: Dep[] = [];

    class ViewVM {
      static [DI_CREATE] = async (di: Container): Promise<ViewVM> => {
        resolved.push(await resolveDep(di));
        return new ViewVM();
      };
    }
    function View(this: { vm: ViewVM }): Node {
      void this.vm;
      return document.createTextNode("view");
    }
    attachMeta(View, ViewVM);

    const b = scopeWith("B");

    withRuntimeOptions({ container: b.container }, () => {
      render(View as AnyComponent);
    });
    await flush();

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBe(b.dep);
  });

  it("дополняет runtime options, а не заменяет их", async () => {
    const onError = vi.fn();

    class BrokenVM {
      static [DI_CREATE] = (): never => {
        throw new Error("boom");
      };
    }
    function Broken(this: { vm: BrokenVM }): Node {
      void this.vm;
      return document.createTextNode("broken");
    }
    attachMeta(Broken, BrokenVM);

    const a = scopeWith("A");
    const b = scopeWith("B");

    withRuntimeOptions({ container: b.container, onError }, () => {
      render(Broken as AnyComponent, { container: a.container });
    });
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("runtime options: disposed container", () => {
  it("не отдаёт освобождённый контейнер как амбиентный", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous = process.env.SILENT_DEBUG_RUNTIME;
    process.env.SILENT_DEBUG_RUNTIME = "1";
    try {
      const disposed = new Container("disposed");
      disposed.dispose();
      withRuntimeOptions({ container: disposed }, () => {
        expect(getRuntimeOptions().container).toBeUndefined();
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      if (previous === undefined) {
        delete process.env.SILENT_DEBUG_RUNTIME;
      } else {
        process.env.SILENT_DEBUG_RUNTIME = previous;
      }
    }
  });

  it("выбрасывает освобождённый контейнер из owner-опций", () => {
    const disposed = new Container("disposed-owner");
    disposed.dispose();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let result: ReturnType<typeof getRuntimeOptions> | undefined;
      createRoot(() => {
        const owner = getOwner();
        withRuntimeOptions({ container: disposed }, () => {});
        runWithOwner(owner, () => {
          result = getRuntimeOptions();
        });
      });
      expect(result?.container).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
