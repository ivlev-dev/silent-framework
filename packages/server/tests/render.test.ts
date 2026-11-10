import { describe, expect, it } from "vitest";
import {
  For,
  Show,
  Suspense,
  attr,
  createComponent,
  isServerMode,
  lazy,
  templateHoles,
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

function defineDiCreate(target: unknown, create: () => Promise<unknown>): void {
  (target as unknown as Record<PropertyKey, unknown>)[DI_CREATE] = create;
}

describe("renderToString", () => {
  it("рендерит синхронный компонент с атрибутами и текстом", async () => {
    function Hello(props: { name: string }): Node {
      const root = document.createElement("div");
      root.setAttribute("class", "greeting");
      root.setAttribute("data-kind", "card");
      const heading = document.createElement("h1");
      heading.textContent = `Hello, ${props.name}`;
      root.appendChild(heading);
      return root;
    }

    const { html } = await renderToString(Hello as unknown as AnyComponent, {
      props: { name: "SSR" },
    });

    expect(html).toContain('<div class="greeting" data-kind="card">');
    expect(html).toContain("<h1>Hello, SSR</h1>");
    expect(html).toContain("</div>");
  });

  it("рендерит финальный view после резолва async VM, а не прелоадер", async () => {
    class ProfileVM {
      readonly label = "profile";
    }

    defineDiCreate(ProfileVM, async () => {
      await Promise.resolve();
      return new ProfileVM();
    });

    function Profile(this: { vm: ProfileVM }): Node {
      const element = document.createElement("section");
      element.setAttribute("data-view", "profile");
      element.textContent = this.vm.label;
      return element;
    }

    function Loading(): Node {
      const element = document.createElement("span");
      element.textContent = "loading";
      return element;
    }

    attachMeta(
      Profile as unknown as AnyComponent,
      ProfileVM,
      Loading as unknown as Preloader,
    );

    const { html } = await renderToString(Profile as unknown as AnyComponent);

    expect(html).toContain('<section data-view="profile">profile</section>');
    expect(html).not.toContain("loading");
  });

  it("рендерит вложенный async-компонент внутри синхронного родителя", async () => {
    class ChildVM {
      readonly value = "child";
    }

    defineDiCreate(ChildVM, async () => new ChildVM());

    function Child(this: { vm: ChildVM }): Node {
      const element = document.createElement("span");
      element.textContent = this.vm.value;
      return element;
    }

    function Loading(): Node {
      const element = document.createElement("span");
      element.textContent = "loading";
      return element;
    }

    attachMeta(Child as unknown as AnyComponent, ChildVM, Loading as unknown as Preloader);

    function Parent(): Node {
      const container = document.createElement("div");
      container.appendChild(
        createComponent(Child as unknown as AnyComponent, {}).node,
      );
      return container;
    }

    const { html } = await renderToString(Parent as unknown as AnyComponent);

    expect(html).toContain("<div>");
    expect(html).toContain("<span>child</span>");
    expect(html).not.toContain("loading");
  });

  it("рендерит For со всеми элементами", async () => {
    function List(): Node {
      return For({
        each: ["one", "two", "three"],
        children: (item: string): Node => {
          const element = document.createElement("li");
          element.textContent = item;
          return element;
        },
      });
    }

    const { html } = await renderToString(List as unknown as AnyComponent);

    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("<li>three</li>");
  });

  it("рендерит выбранную ветку Show", async () => {
    function Branch(props: { visible: boolean }): Node {
      return Show({
        when: props.visible,
        children: (): Node => {
          const element = document.createElement("strong");
          element.textContent = "shown";
          return element;
        },
        fallback: (): Node => {
          const element = document.createElement("em");
          element.textContent = "hidden";
          return element;
        },
      });
    }

    const visible = await renderToString(Branch as unknown as AnyComponent, {
      props: { visible: true },
    });
    const hidden = await renderToString(Branch as unknown as AnyComponent, {
      props: { visible: false },
    });

    expect(visible.html).toContain("<strong>shown</strong>");
    expect(visible.html).not.toContain("hidden");
    expect(hidden.html).toContain("<em>hidden</em>");
    expect(hidden.html).not.toContain("shown");
  });

  it("рендерит Suspense с lazy без fallback", async () => {
    function Final(): Node {
      const element = document.createElement("article");
      element.textContent = "lazy content";
      return element;
    }

    const LazyFinal = lazy(
      async (): Promise<{ default: AnyComponent }> => {
        await Promise.resolve();
        return { default: Final as unknown as AnyComponent };
      },
    );

    function App(): Node {
      return Suspense({
        fallback: (): Node => {
          const element = document.createElement("span");
          element.textContent = "fallback";
          return element;
        },
        children: () => LazyFinal({}),
      });
    }

    const { html } = await renderToString(App as unknown as AnyComponent);

    expect(html).toContain("<article>lazy content</article>");
    expect(html).not.toContain("fallback");
  });

  it("сохраняет серверные атрибуты-маркеры и динамические пропсы", async () => {
    function Marked(): Node {
      const factory = templateHoles('<div data-silent-a-0=""><span>base</span></div>');
      const clone = factory();
      const element = clone.attrs[0];
      if (element !== undefined) {
        attr(element, "data-state", () => "ready");
      }
      return clone.node;
    }

    const { html } = await renderToString(Marked as unknown as AnyComponent);

    expect(html).toContain('data-silent-a-0=""');
    expect(html).toContain('data-state="ready"');
    expect(html).toContain("<span>base</span>");
  });

  it("сериализует class и style", async () => {
    function Styled(): Node {
      const element = document.createElement("div");
      attr(element, "class", () => "card active");
      attr(element, "style", () => "color: red; display: block;");
      return element;
    }

    const { html } = await renderToString(Styled as unknown as AnyComponent);

    expect(html).toContain('class="card active"');
    expect(html).toContain('style="color: red; display: block;"');
  });

  it("восстанавливает глобалы и выключает серверный режим", async () => {
    const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, "document");

    function Simple(): Node {
      const element = document.createElement("div");
      element.textContent = "x";
      return element;
    }

    const { html } = await renderToString(Simple as unknown as AnyComponent);

    expect(html).toContain("<div>x</div>");
    expect(isServerMode()).toBe(false);
    if (!hadDocument) {
      expect(globalThis.document).toBeUndefined();
    }
  });

  it("выполняет параллельные рендеры последовательно", async () => {
    function Alpha(props: { label: string }): Node {
      const element = document.createElement("div");
      element.textContent = props.label;
      return element;
    }

    function Beta(props: { label: string }): Node {
      const element = document.createElement("section");
      element.textContent = props.label;
      return element;
    }

    const [alpha, beta] = await Promise.all([
      renderToString(Alpha as unknown as AnyComponent, { props: { label: "alpha" } }),
      renderToString(Beta as unknown as AnyComponent, { props: { label: "beta" } }),
    ]);

    expect(alpha.html).toContain("<div>alpha</div>");
    expect(alpha.html).not.toContain("beta");
    expect(beta.html).toContain("<section>beta</section>");
    expect(beta.html).not.toContain("alpha");
  });

  it("пробрасывает ошибку VM без onError", async () => {
    class BrokenVM {}

    defineDiCreate(BrokenVM, async () => {
      throw new Error("vm boom");
    });

    function Broken(this: { vm: BrokenVM }): Node {
      void this.vm;
      return document.createElement("div");
    }

    attachMeta(Broken as unknown as AnyComponent, BrokenVM);

    await expect(renderToString(Broken as unknown as AnyComponent)).rejects.toThrow("vm boom");
  });

  it("вызывает onError и не бросает", async () => {
    class BrokenVM {}

    defineDiCreate(BrokenVM, async () => {
      throw new Error("handled boom");
    });

    function Broken(this: { vm: BrokenVM }): Node {
      void this.vm;
      return document.createElement("div");
    }

    attachMeta(Broken as unknown as AnyComponent, BrokenVM);

    const errors: unknown[] = [];
    const { html } = await renderToString(Broken as unknown as AnyComponent, {
      onError: (error) => {
        errors.push(error);
      },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(html).toContain("Error: handled boom");
  });

  it("вызывает unmounted и dispose VM после рендера", async () => {
    const events: string[] = [];

    class LifecycleVM {
      unmounted(): void {
        events.push("unmounted");
      }

      dispose(): void {
        events.push("dispose");
      }
    }

    defineDiCreate(LifecycleVM, async () => new LifecycleVM());

    function Lifecycle(this: { vm: LifecycleVM }): Node {
      void this.vm;
      const element = document.createElement("p");
      element.textContent = "life";
      return element;
    }

    attachMeta(Lifecycle as unknown as AnyComponent, LifecycleVM);

    const { html } = await renderToString(Lifecycle as unknown as AnyComponent);

    expect(html).toContain("<p>life</p>");
    expect(events).toEqual(["unmounted", "dispose"]);
  });
});
