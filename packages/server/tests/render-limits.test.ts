import { describe, expect, it } from "vitest";
import { Suspense, lazy, type AnyComponent } from "@ivlev-dev/silent-core";
import { createDocument } from "../src/dom/document.js";
import { enqueueRenderTask, renderToString } from "../src/render.js";

function textView(text: string): Node {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

function simplePage(text: string): AnyComponent {
  return function Page(): Node {
    return textView(text);
  } as unknown as AnyComponent;
}

function hangingPage(): AnyComponent {
  const Never = lazy(
    () => new Promise<{ default: AnyComponent }>(() => {}),
  );
  return function Page(): Node {
    return Suspense({
      fallback: () => textView("waiting"),
      children: () => Never({}),
    });
  } as unknown as AnyComponent;
}

describe("renderToString: timeoutMs и signal", () => {
  it("отклоняет рендер по timeoutMs, освобождает сессию и рендерит повторно", async () => {
    const started = Date.now();

    await expect(
      renderToString(hangingPage(), { timeoutMs: 50 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(
      (globalThis as unknown as Record<string, unknown>)["document"],
    ).toBeUndefined();

    const next = await renderToString(simplePage("after-timeout"), {
      timeoutMs: 1000,
    });
    expect(next.html).toBe("<p>after-timeout</p>");
  });

  it("сразу отклоняет рендер, если signal уже aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      renderToString(simplePage("never"), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(
      (globalThis as unknown as Record<string, unknown>)["document"],
    ).toBeUndefined();
    expect((await renderToString(simplePage("ok"))).html).toBe("<p>ok</p>");
  });

  it("прерывает зависший рендер по signal", async () => {
    const controller = new AbortController();
    const pending = renderToString(hangingPage(), {
      signal: controller.signal,
    });

    setTimeout(() => {
      controller.abort();
    }, 20);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect((await renderToString(simplePage("after-abort"))).html).toBe(
      "<p>after-abort</p>",
    );
  });
  it("не затирает globalThis.document, установленный между SSR-рендерами", async () => {
    await renderToString(simplePage("first"));

    const target = globalThis as unknown as Record<string, unknown>;
    const fake = createDocument();
    target["document"] = fake;
    try {
      await renderToString(simplePage("second"));
      expect(globalThis.document).toBe(fake);
    } finally {
      delete target["document"];
    }
  });
});

describe("enqueueRenderTask", () => {
  it("снимает задачу, бросившую синхронно, и сохраняет порядок следующих", async () => {
    await expect(
      enqueueRenderTask(() => {
        throw new Error("sync-boom");
      }),
    ).rejects.toThrow("sync-boom");

    const order: string[] = [];
    const first = enqueueRenderTask(async () => {
      order.push("first");
      return 1;
    });
    const second = enqueueRenderTask(async () => {
      order.push("second");
      return 2;
    });

    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(order).toEqual(["first", "second"]);
  });
});
