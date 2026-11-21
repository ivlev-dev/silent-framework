import { describe, expect, it } from "vitest";
import { createResource, text, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";
import { renderToStream } from "../src/stream.js";

function innerApp(): AnyComponent {
  return function Inner(): Node {
    const element = document.createElement("span");
    element.textContent = "inner";
    return element;
  } as unknown as AnyComponent;
}

describe("SSR context: reentrancy guard", () => {
  it("вложенный renderToString из компонента отклоняется без deadlock", async () => {
    let captured: unknown = null;

    function Outer(): Node {
      const pending = renderToString(innerApp());
      void pending.catch((error: unknown) => {
        captured = error;
      });
      const element = document.createElement("div");
      element.textContent = "outer";
      return element;
    }

    const { html } = await renderToString(Outer as unknown as AnyComponent, {
      timeoutMs: 1000,
    });
    expect(html).toBe("<div>outer</div>");

    await Promise.resolve();
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).name).toBe("RenderReentrancyError");

    // Очередь не заблокирована отклонённой вложенной задачей.
    const next = await renderToString(innerApp());
    expect(next.html).toBe("<span>inner</span>");
  });

  it("вложенный renderToString после await внутри ресурса видит свой store", async () => {
    let captured: unknown = null;

    function Outer(): Node {
      const resource = createResource(async () => {
        await Promise.resolve();
        try {
          await renderToString(innerApp());
        } catch (error) {
          captured = error;
        }
        return "outer-async";
      });
      const element = document.createElement("p");
      const label = document.createTextNode("");
      element.appendChild(label);
      text(label, () => resource.data() ?? "loading");
      return element;
    }

    const { html } = await renderToString(Outer as unknown as AnyComponent, {
      timeoutMs: 1000,
    });
    expect(html).toBe("<p>outer-async</p>");
    expect((captured as Error).name).toBe("RenderReentrancyError");

    const next = await renderToString(innerApp());
    expect(next.html).toBe("<span>inner</span>");
  });

  it("отложенный через queueMicrotask вложенный renderToString отклоняется", async () => {
    let captured: unknown = null;
    let resolved = false;
    let releaseDeferred!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseDeferred = resolve;
    });

    // Отложенный вызов не дожидаемся из компонента: раньше он просто вставал
    // в очередь и выполнялся после внешнего рендера. Теперь guard срабатывает
    // и на него, пока store внешнего рендера ещё активен.
    function Outer(): Node {
      queueMicrotask(() => {
        void renderToString(innerApp())
          .then(() => {
            resolved = true;
          })
          .catch((error: unknown) => {
            captured = error;
          })
          .finally(releaseDeferred);
      });
      const element = document.createElement("div");
      element.textContent = "outer";
      return element;
    }

    const { html } = await renderToString(Outer as unknown as AnyComponent, {
      timeoutMs: 1000,
    });
    expect(html).toBe("<div>outer</div>");

    await deferred;
    expect(resolved).toBe(false);
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).name).toBe("RenderReentrancyError");

    // Очередь не заблокирована отклонённым отложенным вызовом.
    const next = await renderToString(innerApp());
    expect(next.html).toBe("<span>inner</span>");
  });

  it("отложенный через setTimeout вложенный renderToString отклоняется", async () => {
    let captured: unknown = null;
    let resolved = false;
    // Гейт держит внешний рендер активным, пока таймер не сработает: иначе
    // нулевой setTimeout успел бы выполниться уже после dispose store.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let releaseDeferred!: () => void;
    const deferred = new Promise<void>((resolve) => {
      releaseDeferred = resolve;
    });

    function Outer(): Node {
      setTimeout(() => {
        void renderToString(innerApp())
          .then(() => {
            resolved = true;
          })
          .catch((error: unknown) => {
            captured = error;
          })
          .finally(() => {
            releaseGate();
            releaseDeferred();
          });
      }, 0);

      const resource = createResource(async () => {
        await gate;
        return "outer-async";
      });
      const element = document.createElement("p");
      const label = document.createTextNode("");
      element.appendChild(label);
      text(label, () => resource.data() ?? "loading");
      return element;
    }

    const { html } = await renderToString(Outer as unknown as AnyComponent, {
      timeoutMs: 1000,
    });
    expect(html).toBe("<p>outer-async</p>");

    await deferred;
    expect(resolved).toBe(false);
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).name).toBe("RenderReentrancyError");

    const next = await renderToString(innerApp());
    expect(next.html).toBe("<span>inner</span>");
  });

  it("вложенный renderToStream бросает RenderReentrancyError", async () => {
    let captured: unknown = null;

    function Inner(): Node {
      return document.createElement("span");
    }

    function Outer(): Node {
      try {
        renderToStream(Inner as unknown as AnyComponent);
      } catch (error) {
        captured = error;
      }
      return document.createElement("div");
    }

    await renderToString(Outer as unknown as AnyComponent, { timeoutMs: 1000 });
    expect((captured as Error).name).toBe("RenderReentrancyError");
  });
});
