import { afterEach, describe, expect, it } from "vitest";
import { createComponent, getReady, setPreloader, whenIdle } from "../src/component";
import { mount } from "../src/mount";
import type { AnyComponent, Preloader } from "../src/types";
import { ComponentContext } from "../src/component-context";
import { container } from "@silent/di";
import { createSignal, flushSync } from "@silent/reactivity";

const VIEW = Symbol.for("silent.view");
const DI_CREATE = Symbol.for("silent.di.create");
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
});

interface CounterProps {
  count: number;
}

class CounterVM {
  props: CounterProps | null = null;
  view: Node | null = null;
  events: string[] = [];

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
}

function Preloader(): Node {
  const element = document.createElement("span");
  element.textContent = "loading";
  return element;
}

function Counter(this: { vm: CounterVM }, props: CounterProps): Node {
  const element = document.createElement("span");
  element.textContent = String(props.count);
  void this.vm;
  return element;
}

function attachMeta(
  component: unknown,
  vm: unknown,
  preloader?: Preloader,
): void {
  (component as Record<PropertyKey, unknown>)[VIEW] = {
    vm,
    name: "Counter",
    ...(preloader !== undefined ? { preloader } : {}),
  };
}

describe("component runtime", () => {
  it("показывает прелоадер и монтирует view после резолва VM", async () => {
    attachMeta(Counter, CounterVM, Preloader);
    const result = createComponent(Counter as AnyComponent, { count: 3 });
    expect(result.node.textContent).toBe("loading");
    await result.ready;
    expect(result.node.textContent).toBe("3");
  });

  it("вызывает lifecycle и выставляет props/view", async () => {
    const instances: CounterVM[] = [];
    class TrackingVM extends CounterVM {
      constructor() {
        super();
        instances.push(this);
      }
    }
    attachMeta(Counter, TrackingVM, Preloader);
    const target = host();
    const handle = await mount(target, Counter as AnyComponent, { props: { count: 7 } });
    const vm = instances[0];
    expect(vm).toBeDefined();
    expect(vm?.props).toEqual({ count: 7 });
    expect(vm?.view).toBeInstanceOf(Element);
    expect(vm?.events).toEqual(["created", "beforeMount", "mounted"]);
    handle.dispose();
    expect(vm?.events).toEqual([
      "created",
      "beforeMount",
      "mounted",
      "beforeUnmount",
      "unmounted",
      "dispose",
    ]);
    expect(target.textContent).toBe("");
  });

  it("использует ComponentContext как DI-токен", async () => {
    let captured: ComponentContext<CounterProps> | null = null;
    class ContextVM {
      readonly context: ComponentContext<CounterProps>;

      constructor(context: ComponentContext<CounterProps>) {
        this.context = context;
        captured = context;
      }

      static [DI_CREATE] = async (di: typeof container): Promise<ContextVM> => {
        return new ContextVM(await di.resolve<ComponentContext<CounterProps>>(ComponentContext));
      };
    }
    const ContextCounter = function (this: { vm: ContextVM }, props: CounterProps): Node {
      const element = document.createElement("b");
      element.textContent = `${props.count}:${this.vm.context.props.count}`;
      return element;
    } as unknown as AnyComponent;
    attachMeta(ContextCounter, ContextVM, Preloader);
    const target = host();
    await mount(target, ContextCounter, { props: { count: 5 } });
    expect(captured?.props).toEqual({ count: 5 });
    expect(target.textContent).toBe("5:5");
  });

  it("разрешает интерфейсный токен через bind", async () => {
    const token = Symbol("vm");
    class TokenVM {
      value = "token";
    }
    const TokenCounter = function (this: { vm: TokenVM }): Node {
      const element = document.createElement("i");
      element.textContent = this.vm.value;
      return element;
    } as unknown as AnyComponent;
    (TokenCounter as Record<PropertyKey, unknown>)[VIEW] = { vm: token, name: "TokenCounter" };
    const scope = container.createScope("test");
    scope.bind(token, () => new TokenVM());
    const target = host();
    await mount(target, TokenCounter, { container: scope });
    expect(target.textContent).toBe("token");
    scope.dispose();
  });

  it("setPreloader задаёт прелоадер компонента", async () => {
    attachMeta(Counter, CounterVM);
    setPreloader(Counter as AnyComponent, Preloader);
    const result = createComponent(Counter as AnyComponent, { count: 1 });
    expect(result.node.textContent).toBe("loading");
    await result.ready;
    expect(result.node.textContent).toBe("1");
  });

  it("поддерживает синхронные компоненты", async () => {
    function Sync(props: { text: string }): Node {
      const element = document.createElement("em");
      element.textContent = props.text;
      return element;
    }
    const target = host();
    const handle = await mount(target, Sync as unknown as AnyComponent, {
      props: { text: "sync" },
    });
    expect(target.textContent).toBe("sync");
    handle.dispose();
    expect(target.textContent).toBe("");
  });

  it("рендерит вложенные async-компоненты", async () => {
    class ChildVM {
      value = "child";
    }
    function Child(this: { vm: ChildVM }): Node {
      const element = document.createElement("span");
      element.textContent = this.vm.value;
      return element;
    }
    attachMeta(Child, ChildVM, Preloader);
    const Parent = function (): Node {
      const container = document.createElement("div");
      container.appendChild(createComponent(Child as AnyComponent, {}).node);
      return container;
    } as unknown as AnyComponent;
    const target = host();
    await mount(target, Parent);
    await whenIdle();
    expect(target.textContent).toBe("child");
  });

  it("обновляет DOM точечно через реактивный VM", async () => {
    class ReactiveVM {
      readonly [key: string]: unknown;
    }
    const [count, setCount] = createSignal(0);
    const runtime = await import("@silent/reactivity");
    const ReactiveCounter = function (this: { vm: ReactiveVM }): Node {
      const element = document.createElement("span");
      runtime.createRenderEffect(() => {
        element.textContent = String(count());
      });
      void this.vm;
      return element;
    } as unknown as AnyComponent;
    attachMeta(ReactiveCounter, ReactiveVM, Preloader);
    const target = host();
    await mount(target, ReactiveCounter, {});
    expect(target.textContent).toBe("0");
    setCount(1);
    flushSync();
    expect(target.textContent).toBe("1");
  });
});
