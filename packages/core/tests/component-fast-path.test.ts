// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "@ivlev-dev/silent-reactivity";
import {
  createComponent,
  setReady,
  type ComponentResult,
} from "../src/component";
import { template, templateHoles } from "../src/dom";
import type { AnyComponent } from "../src/types";

const roots: (() => void)[] = [];

afterEach(() => {
  for (const dispose of roots.splice(0)) {
    dispose();
  }
  document.body.replaceChildren();
  for (const title of Array.from(document.head.querySelectorAll("title"))) {
    title.remove();
  }
});

function asComponent(fn: () => unknown): AnyComponent {
  return fn as unknown as AnyComponent;
}

function inRoot(fn: () => ComponentResult): ComponentResult {
  let result: ComponentResult | null = null;
  let dispose: () => void = () => {};
  createRoot((stop) => {
    dispose = stop;
    result = fn();
    return null;
  });
  roots.push(dispose);
  if (result === null) {
    throw new Error("компонент не создан");
  }
  return result;
}

describe("createComponent без метаданных", () => {
  it("возвращает одиночный узел шаблона как есть", () => {
    const render = template('<div class="card"><span>ok</span></div>');
    const node = render();
    const result = inRoot(() => createComponent(asComponent(() => node), {}));

    expect(result.node).toBe(node);
    expect(result.node.textContent).toBe("ok");
  });

  it("сохраняет ready, выставленный на узле", async () => {
    const node = template("<div></div>")();
    let resolveReady: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    setReady(node, pending);

    const result = inRoot(() => createComponent(asComponent(() => node), {}));
    let settled = false;
    void result.ready.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveReady();
    await result.ready;
    expect(settled).toBe(true);
  });

  it("удаляет узел и вызывает disposer при dispose", () => {
    const node = template("<div></div>")();
    const result = inRoot(() => createComponent(asComponent(() => node), {}));
    const host = document.createElement("div");
    host.appendChild(result.node);

    result.dispose();

    expect(host.childNodes.length).toBe(0);
  });

  it("не применяет быстрый путь к DocumentFragment", () => {
    const render = template("<h1>a</h1><p>b</p>");
    const result = inRoot(() => createComponent(asComponent(() => render()), {}));

    expect(result.node).toBeInstanceOf(DocumentFragment);
    expect(result.node.childNodes.length).toBe(2);
    expect(result.node.textContent).toBe("ab");
  });

  it("оборачивает строку в текстовый узел", () => {
    const result = inRoot(() =>
      createComponent(asComponent(() => "text"), {}),
    );

    expect(result.node).toBeInstanceOf(Text);
    expect(result.node.textContent).toBe("text");
  });

  it("сохраняет извлечение метаданных для шаблона с title", () => {
    const render = templateHoles("<div><title>Page</title><span>body</span></div>");
    const node = render().node;
    const result = inRoot(() => createComponent(asComponent(() => node), {}));

    expect(result.node).toBe(node);
    expect((node as Element).querySelector("title")).toBeNull();
    expect((node as Element).querySelector("span")?.textContent).toBe("body");
    expect(document.title).toBe("Page");
  });
});
