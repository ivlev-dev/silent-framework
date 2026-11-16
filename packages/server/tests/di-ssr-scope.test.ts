import { describe, expect, it } from "vitest";
import { Container, InvalidScopeError, createToken } from "@ivlev-dev/silent-di";
import {
  getRuntimeOptions,
  type AnyComponent,
  type Preloader,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";

const VIEW = Symbol.for("silent.view");
const DI_CREATE = Symbol.for("silent.di.create");

function attachMeta(component: AnyComponent, vm: unknown, preloader?: Preloader): void {
  (component as unknown as Record<PropertyKey, unknown>)[VIEW] = {
    vm,
    ...(preloader !== undefined ? { preloader } : {}),
  };
}

function defineDiCreate(target: unknown, create: (di: Container) => Promise<unknown>): void {
  (target as unknown as Record<PropertyKey, unknown>)[DI_CREATE] = create;
}

describe("SSR: request scope и DI", () => {
  it("создаёт отдельный request scope на каждый рендер и освобождает его", async () => {
    const captured: Container[] = [];

    function App(): Node {
      const container = getRuntimeOptions().container;
      if (container !== undefined) {
        captured.push(container);
      }
      const element = document.createElement("div");
      element.textContent = "app";
      return element;
    }

    const base = new Container("app");
    const scoped = createToken<string>("Scoped");
    base.bind(scoped, () => "base").inScopedScope();

    await renderToString(App as unknown as AnyComponent, { container: base });
    await renderToString(App as unknown as AnyComponent, { container: base });

    expect(captured).toHaveLength(2);
    const first = captured[0];
    const second = captured[1];
    if (first === undefined || second === undefined) {
      throw new Error("request scope не создан");
    }

    expect(first).not.toBe(second);
    expect(first.name).toMatch(/^request:/);
    expect(second.name).toMatch(/^request:/);
    expect(() => first.createScope("late")).toThrow("has been disposed");
    await expect(first.resolve(scoped)).rejects.toThrow("has been disposed");
    expect(base.has(scoped)).toBe(true);
  });

  it("два запроса получают разные scoped-сервисы", async () => {
    let currentTenant = "alpha";
    const tenant = createToken<{ name: string }>("Tenant");
    const base = new Container("app");
    base.bind(tenant, () => ({ name: currentTenant })).inScopedScope();

    class TenantVM {
      constructor(readonly value: { name: string }) {}
    }

    defineDiCreate(TenantVM, async (di) => new TenantVM(await di.resolve(tenant)));

    function TenantView(this: { vm: TenantVM }): Node {
      const element = document.createElement("span");
      element.textContent = this.vm.value.name;
      return element;
    }

    attachMeta(TenantView as unknown as AnyComponent, TenantVM);

    currentTenant = "alpha";
    const first = await renderToString(TenantView as unknown as AnyComponent, {
      container: base,
    });
    currentTenant = "beta";
    const second = await renderToString(TenantView as unknown as AnyComponent, {
      container: base,
    });

    expect(first.html).toContain("<span>alpha</span>");
    expect(second.html).toContain("<span>beta</span>");
    expect(second.html).not.toContain("alpha");
  });

  it("root bindings общие для всех запросов", async () => {
    const base = new Container("app");
    const shared = createToken<{ id: number }>("Shared");
    const instances: Array<{ id: number }> = [];
    let calls = 0;

    base.bind(shared, () => {
      calls += 1;
      const value = { id: calls };
      instances.push(value);
      return value;
    });

    class SharedVM {
      constructor(readonly value: { id: number }) {}
    }

    defineDiCreate(SharedVM, async (di) => new SharedVM(await di.resolve(shared)));

    function SharedView(this: { vm: SharedVM }): Node {
      const element = document.createElement("b");
      element.textContent = String(this.vm.value.id);
      return element;
    }

    attachMeta(SharedView as unknown as AnyComponent, SharedVM);

    const first = await renderToString(SharedView as unknown as AnyComponent, {
      container: base,
    });
    const second = await renderToString(SharedView as unknown as AnyComponent, {
      container: base,
    });

    expect(calls).toBe(1);
    expect(instances).toHaveLength(1);
    expect(first.html).toContain("<b>1</b>");
    expect(second.html).toContain("<b>1</b>");
  });

  it("root singleton не может захватить request scoped-сервис", async () => {
    const tenant = createToken<{ name: string }>("Tenant");
    const service = createToken<{ name: string }>("TenantService");
    const base = new Container("app");

    base.bind(tenant, () => ({ name: "request" })).inScopedScope();
    base.bind(service, async (c: Container) => {
      const value = await c.resolve<{ name: string }>(tenant);
      return { name: value.name };
    });

    class ServiceVM {
      constructor(readonly value: { name: string }) {}
    }

    defineDiCreate(ServiceVM, async (di) => new ServiceVM(await di.resolve(service)));

    function ServiceView(this: { vm: ServiceVM }): Node {
      const element = document.createElement("span");
      element.textContent = this.vm.value.name;
      return element;
    }

    attachMeta(ServiceView as unknown as AnyComponent, ServiceVM);

    await expect(
      renderToString(ServiceView as unknown as AnyComponent, { container: base }),
    ).rejects.toBeInstanceOf(InvalidScopeError);
    expect(base.peek(service)).toBeUndefined();
  });

  it("scoped-сервис освобождается через Symbol.dispose после рендера", async () => {
    const resource = createToken<{ [Symbol.dispose](): void }>("Resource");
    const base = new Container("app");
    let disposed = 0;

    base.bind(resource, () => ({
      [Symbol.dispose](): void {
        disposed += 1;
      },
    })).inScopedScope();

    class ResourceVM {
      constructor(readonly value: unknown) {}
    }

    defineDiCreate(ResourceVM, async (di) => new ResourceVM(await di.resolve(resource)));

    function ResourceView(): Node {
      const element = document.createElement("i");
      element.textContent = "ok";
      return element;
    }

    attachMeta(ResourceView as unknown as AnyComponent, ResourceVM);

    await renderToString(ResourceView as unknown as AnyComponent, { container: base });
    expect(disposed).toBe(1);

    await renderToString(ResourceView as unknown as AnyComponent, { container: base });
    expect(disposed).toBe(2);
  });

  it("ошибка рендера не мешает освободить request scope", async () => {
    const captured: Container[] = [];

    function App(): Node {
      const container = getRuntimeOptions().container;
      if (container !== undefined) {
        captured.push(container);
      }
      throw new Error("render boom");
    }

    const base = new Container("app");

    await expect(
      renderToString(App as unknown as AnyComponent, { container: base }),
    ).rejects.toThrow("render boom");

    const scope = captured[0];
    if (scope === undefined) {
      throw new Error("request scope не создан");
    }
    expect(() => scope.createScope("late")).toThrow("has been disposed");
  });
});
