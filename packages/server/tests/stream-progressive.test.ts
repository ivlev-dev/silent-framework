import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import {
  Head,
  Suspense,
  lazy,
  templateHoles,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";
import { renderToStream, type StreamOptions } from "../src/stream.js";
import { clearTemplateCache } from "../src/template-cache.js";

afterEach(() => {
  clearTemplateCache();
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function finalView(label: string): Node {
  const element = document.createElement("article");
  element.setAttribute("data-view", "final");
  element.textContent = label;
  return element;
}

function fallbackView(label: string): Node {
  const element = document.createElement("span");
  element.setAttribute("data-view", "fallback");
  element.textContent = label;
  return element;
}

async function readAll(reader: ReadableStreamDefaultReader<string>): Promise<string> {
  let result = "";
  for (;;) {
    const next = await reader.read();
    if (next.done === true) {
      return result;
    }
    result += next.value;
  }
}

async function readChunk(reader: ReadableStreamDefaultReader<string>): Promise<string> {
  const next = await reader.read();
  return next.done === true ? "" : next.value;
}

describe("renderToStream: progressive protocol", () => {
  it("отдаёт head и shell до завершения Suspense", async () => {
    const gate = deferred<{ default: AnyComponent }>();
    const events: string[] = [];
    let head = "";

    const LazyFinal = lazy(() => gate.promise);
    function Page(): Node {
      Head({ title: "Progressive" });
      return Suspense({
        fallback: () => fallbackView("loading"),
        children: () => LazyFinal({}),
      });
    }

    const started = Date.now();
    const stream = renderToStream(Page as unknown as AnyComponent, {
      onHead(value, info) {
        head = value;
        events.push(info.final ? "head:final" : "head:shell");
      },
      onShell() {
        events.push("shell");
      },
      onChunk() {
        if (!events.includes("chunk")) {
          events.push("chunk");
        }
      },
    });
    const reader = stream.getReader();
    const first = await readChunk(reader);
    const ttfb = Date.now() - started;

    expect(ttfb).toBeLessThan(250);
    expect(first).toContain("loading");
    expect(first).not.toContain("streamed-content");
    expect(events[0]).toBe("head:shell");
    expect(events.indexOf("shell")).toBeGreaterThan(-1);
    expect(events.indexOf("shell")).toBeLessThan(events.indexOf("chunk"));
    expect(head).toContain("<title>Progressive</title>");

    gate.resolve({ default: finalViewComponent("streamed-content") });
    const rest = await readAll(reader);

    expect(rest).toContain("streamed-content");
    expect(rest).toContain('data-silent-stream="');
    expect(rest).toContain("__silentStream.patch(");
  });

  it("заменяет fallback на контент минимальным клиентским runtime", async () => {
    const gate = deferred<{ default: AnyComponent }>();
    function makePage(): AnyComponent {
      const LazyFinal = lazy(() => gate.promise);
      return function Page(): Node {
        return Suspense({
          fallback: () => fallbackView("loading"),
          children: () => LazyFinal({}),
        });
      } as unknown as AnyComponent;
    }

    const stream = renderToStream(makePage());
    const reader = stream.getReader();
    const chunks: string[] = [];
    chunks.push(await readChunk(reader));
    gate.resolve({ default: finalViewComponent("resolved-by-runtime") });
    chunks.push(await readAll(reader));
    const html = chunks.join("");

    const dom = new JSDOM(
      `<!doctype html><html><head></head><body><div id="app">${html}</div></body></html>`,
      { runScripts: "dangerously" },
    );
    const app = dom.window.document.querySelector("#app");
    expect(app).not.toBeNull();
    const rendered = app?.innerHTML ?? "";

    expect(rendered).toContain("resolved-by-runtime");
    expect(rendered).not.toContain("loading");
    expect(rendered).not.toContain("data-silent-stream");
    expect(rendered).not.toContain("silent-stream:");
    expect(rendered).not.toContain("silent-stream-end:");
    expect(dom.window.document.querySelectorAll("template").length).toBe(0);

    const expected = await renderToString(makePage());
    expect(rendered).toBe(expected.html);
    dom.window.close();
  });

  it("дожидается async VM и дописывает чанк с итоговой view", async () => {
    const gate = deferred<object>();
    const VIEW = Symbol.for("silent.view");
    const CREATE = Symbol.for("silent.di.create");

    class ProfileVM {
      readonly label = "async-profile";
    }
    (ProfileVM as unknown as Record<symbol, unknown>)[CREATE] = () => gate.promise;

    function Profile(this: { vm: ProfileVM }): Node {
      return finalView(this.vm.label);
    }
    (Profile as unknown as Record<symbol, unknown>)[VIEW] = { vm: ProfileVM };

    const stream = renderToStream(Profile as unknown as AnyComponent);
    const reader = stream.getReader();
    const shell = await readChunk(reader);
    expect(shell).not.toContain("async-profile");
    expect(shell).toContain("silent-view");

    gate.resolve(new ProfileVM());
    const rest = await readAll(reader);
    expect(rest).toContain("async-profile");
    expect(rest).toContain("silent-stream:");
  });

  it("дополняет head после асинхронной границы", async () => {
    const gate = deferred<{ default: AnyComponent }>();
    const events: string[] = [];
    let finalHead = "";

    const LazyFinal = lazy(() => gate.promise);
    function FinalWithHead(): Node {
      Head({ title: "Late head" });
      return finalView("late-head-view");
    }
    function Page(): Node {
      return Suspense({
        fallback: () => fallbackView("loading"),
        children: () => LazyFinal({}),
      });
    }

    const stream = renderToStream(Page as unknown as AnyComponent, {
      onHead(value, info) {
        events.push(info.final ? "final" : "shell");
        if (info.final) {
          finalHead = value;
        }
      },
    });
    const reader = stream.getReader();
    expect(await readChunk(reader)).toContain("loading");

    gate.resolve({ default: FinalWithHead as unknown as AnyComponent });
    await readAll(reader);

    expect(events).toEqual(["shell", "final"]);
    expect(finalHead).toContain("<title>Late head</title>");
  });

  it("независимо патчит вложенные Suspense", async () => {
    const outerGate = deferred<{ default: AnyComponent }>();
    const innerGate = deferred<{ default: AnyComponent }>();

    function makeOuterFinal(
      inner: Promise<{ default: AnyComponent }>,
    ): AnyComponent {
      const InnerLazy = lazy(() => inner);
      return function OuterFinal(): Node {
        const section = document.createElement("section");
        section.appendChild(finalView("outer-final"));
        section.appendChild(
          Suspense({
            fallback: () => fallbackView("inner-loading"),
            children: () => InnerLazy({}),
          }),
        );
        return section;
      } as unknown as AnyComponent;
    }

    function makePage(
      outer: Promise<{ default: AnyComponent }>,
    ): AnyComponent {
      const OuterLazy = lazy(() => outer);
      return function Page(): Node {
        return Suspense({
          fallback: () => fallbackView("outer-loading"),
          children: () => OuterLazy({}),
        });
      } as unknown as AnyComponent;
    }

    const stream = renderToStream(makePage(outerGate.promise));
    const reader = stream.getReader();
    let html = await readChunk(reader);
    expect(html).toContain("outer-loading");

    outerGate.resolve({ default: makeOuterFinal(innerGate.promise) });
    for (;;) {
      if (html.includes("inner-loading")) {
        break;
      }
      const next = await reader.read();
      if (next.done === true) {
        break;
      }
      html += next.value;
    }
    expect(html).toContain("outer-final");
    expect(html).toContain("inner-loading");

    innerGate.resolve({ default: finalViewComponent("inner-final") });
    html += await readAll(reader);

    const dom = new JSDOM(
      `<!doctype html><html><head></head><body><div id="app">${html}</div></body></html>`,
      { runScripts: "dangerously" },
    );
    const rendered = dom.window.document.querySelector("#app")?.innerHTML ?? "";
    expect(rendered).toContain("outer-final");
    expect(rendered).toContain("inner-final");
    expect(rendered).not.toContain("loading");
    expect(rendered).not.toContain("silent-stream");

    const expected = await renderToString(
      makePage(
        Promise.resolve({ default: makeOuterFinal(Promise.resolve({ default: finalViewComponent("inner-final") })) }),
      ),
    );
    expect(rendered).toBe(expected.html);
    dom.window.close();
  });

  it("стримит ошибку Suspense в чанк", async () => {
    const gate = deferred<{ default: AnyComponent }>();
    const LazyFinal = lazy(() => gate.promise);
    function Page(): Node {
      return Suspense({
        fallback: () => fallbackView("waiting"),
        children: () => LazyFinal({}),
      });
    }

    const stream = renderToStream(Page as unknown as AnyComponent, {
      onError() {},
    });
    const reader = stream.getReader();
    const shell = await readChunk(reader);
    expect(shell).toContain("waiting");

    gate.reject(new Error("stream-boom"));
    const rest = await readAll(reader);
    expect(rest).toContain("Error: stream-boom");
  });

  it("закрывает поток ошибкой после отправки shell", async () => {
    const gate = deferred<object>();
    const VIEW = Symbol.for("silent.view");
    const CREATE = Symbol.for("silent.di.create");

    class BrokenVM {}
    (BrokenVM as unknown as Record<symbol, unknown>)[CREATE] = () => gate.promise;

    function BrokenView(this: { vm: BrokenVM }): Node {
      void this.vm;
      return finalView("never-rendered");
    }
    (BrokenView as unknown as Record<symbol, unknown>)[VIEW] = { vm: BrokenVM };

    const stream = renderToStream(BrokenView as unknown as AnyComponent);
    const reader = stream.getReader();
    const shell = await readChunk(reader);
    expect(shell).toContain("silent-view");

    gate.reject(new Error("late-failure"));
    await expect(readAll(reader)).rejects.toThrow("late-failure");
  });

  it("не пишет в поток после отмены читателя", async () => {
    const gate = deferred<{ default: AnyComponent }>();
    const LazyFinal = lazy(() => gate.promise);
    function Page(): Node {
      return Suspense({
        fallback: () => fallbackView("cancel-wait"),
        children: () => LazyFinal({}),
      });
    }

    let chunks = 0;
    const options: StreamOptions = {
      onChunk() {
        chunks += 1;
      },
    };
    const stream = renderToStream(Page as unknown as AnyComponent, options);
    const reader = stream.getReader();
    await readChunk(reader);
    const before = chunks;
    await reader.cancel();
    gate.resolve({ default: finalViewComponent("after-cancel") });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(chunks).toBe(before);
  });

  it("прерывает поток по AbortSignal", async () => {
    const gate = deferred<{ default: AnyComponent }>();
    const LazyFinal = lazy(() => gate.promise);
    function Page(): Node {
      return Suspense({
        fallback: () => fallbackView("signal-wait"),
        children: () => LazyFinal({}),
      });
    }

    const controller = new AbortController();
    const stream = renderToStream(Page as unknown as AnyComponent, {
      signal: controller.signal,
    });
    const reader = stream.getReader();
    expect(await readChunk(reader)).toContain("signal-wait");

    controller.abort();
    await expect(readAll(reader)).rejects.toThrow("aborted");
    gate.resolve({ default: finalViewComponent("late") });
  });

  it("пробрасывает ошибку рендера до shell", async () => {
    function Broken(): Node {
      throw new Error("shell-boom");
    }
    const stream = renderToStream(Broken as unknown as AnyComponent);
    await expect(readAll(stream.getReader())).rejects.toThrow("shell-boom");
  });

  it("сохраняет строковый контракт renderToString для Suspense", async () => {
    function Page(): Node {
      return Suspense({
        fallback: () => fallbackView("nope"),
        children: () => finalView("ready"),
      });
    }
    const { html } = await renderToString(Page as unknown as AnyComponent);
    expect(html).toBe(
      '<article data-view="final">ready</article><!--silent-suspense-->',
    );
  });
});

function finalViewComponent(label: string): AnyComponent {
  return function FinalView(): Node {
    return finalView(label);
  } as unknown as AnyComponent;
}
