import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Suspense,
  createResource,
  lazy,
  text,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import {
  STREAM_REGION_END,
  STREAM_REGION_START,
} from "@ivlev-dev/silent-core/server-stream";
import { NodeImpl } from "../src/dom/node.js";
import type { DomNode } from "../src/dom/types.js";
import { renderToString } from "../src/render.js";
import { renderToStream } from "../src/stream.js";

/**
 * Счётчики дорогой settle-работы. Мокаем только обёртки: реальные функции
 * вызываются, поэтому поведение остальных тестов файла не меняется.
 */
const counters = vi.hoisted(() => ({ serializeBetween: 0, flushSync: 0 }));

vi.mock("../src/dom/serializer.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/dom/serializer.js")>();
  return {
    ...actual,
    serializeBetween(
      start: Parameters<typeof actual.serializeBetween>[0],
      end: Parameters<typeof actual.serializeBetween>[1],
      markers?: boolean,
    ): string {
      counters.serializeBetween += 1;
      return actual.serializeBetween(start, end, markers);
    },
  };
});

vi.mock("@ivlev-dev/silent-reactivity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@ivlev-dev/silent-reactivity")>();
  return {
    ...actual,
    flushSync(...args: Parameters<typeof actual.flushSync>): ReturnType<
      typeof actual.flushSync
    > {
      counters.flushSync += 1;
      return actual.flushSync(...args);
    },
  };
});

const originalRemoveChild = NodeImpl.prototype.removeChild;
let removedMarkers = 0;

beforeEach(() => {
  counters.serializeBetween = 0;
  counters.flushSync = 0;
  removedMarkers = 0;
  vi.spyOn(NodeImpl.prototype, "removeChild").mockImplementation(
    function (this: NodeImpl, node: DomNode): DomNode {
      const data = (node as unknown as { data?: unknown }).data;
      if (
        typeof data === "string" &&
        (data.startsWith(STREAM_REGION_START) ||
          data.startsWith(STREAM_REGION_END))
      ) {
        removedMarkers += 1;
      }
      return originalRemoveChild.call(this, node);
    } as unknown as typeof NodeImpl.prototype.removeChild,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

/** Ждёт промис, но не бесконечно: зависание — это провал теста, а не таймаут раннера. */
async function waitFor<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Рендер не завершился за ${ms} мс`));
    }, ms);
    (timer as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function hungView(gate: Promise<string>): AnyComponent {
  return function Hung(): Node {
    const resource = createResource(() => gate, { key: "stream-cancel" });
    const paragraph = document.createElement("p");
    const label = document.createTextNode("");
    paragraph.appendChild(label);
    text(label, () => resource.data() ?? "loading");
    return paragraph;
  } as unknown as AnyComponent;
}

function plainView(label: string): AnyComponent {
  return function Plain(): Node {
    const element = document.createElement("div");
    element.textContent = label;
    return element;
  } as unknown as AnyComponent;
}

function fallbackView(label: string): Node {
  const element = document.createElement("span");
  element.setAttribute("data-view", "fallback");
  element.textContent = label;
  return element;
}

function finalView(label: string): AnyComponent {
  return function Final(): Node {
    const element = document.createElement("article");
    element.setAttribute("data-view", "final");
    element.textContent = label;
    return element;
  } as unknown as AnyComponent;
}

/** Несколько независимых Suspense-регионов под общим shell. */
function multiRegionPage(
  gates: readonly Promise<{ default: AnyComponent }>[],
): AnyComponent {
  const lazies = gates.map((gate) => lazy(() => gate));
  return function Page(): Node {
    const root = document.createElement("div");
    lazies.forEach((Lazy, index) => {
      root.appendChild(
        Suspense({
          fallback: () => fallbackView(`wait-${index}`),
          children: () => Lazy({}),
        }),
      );
    });
    return root;
  } as unknown as AnyComponent;
}

function deferredGate(): Deferred<{ default: AnyComponent }> {
  return deferred<{ default: AnyComponent }>();
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

describe("renderToStream: отмена читателя", () => {
  it("прерывает зависший рендер и освобождает очередь", async () => {
    const gate = deferred<string>();
    let chunks = 0;
    const stream = renderToStream(hungView(gate.promise), {
      onChunk() {
        chunks += 1;
      },
    });
    const reader = stream.getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    const shell = first.done === true ? "" : first.value;
    expect(shell).toContain("loading");

    const beforeCancel = chunks;
    await reader.cancel();
    // Повторная отмена идемпотентна и не должна ничего ломать.
    await reader.cancel();

    const next = await waitFor(renderToString(plainView("after-cancel")));
    expect(next.html).toContain("after-cancel");

    // Поздний ответ зависшего ресурса не должен попасть в уже отменённый поток.
    expect(chunks).toBe(beforeCancel);
    gate.resolve("late");
    await Promise.resolve();
  });

  it("следующий renderToStream стартует после отмены предыдущего", async () => {
    const gate = deferred<string>();
    const first = renderToStream(hungView(gate.promise));
    const firstReader = first.getReader();
    expect((await firstReader.read()).done).toBe(false);
    await firstReader.cancel();

    const second = renderToStream(plainView("second-stream"));
    const secondReader = second.getReader();
    const chunks: string[] = [];
    for (;;) {
      const next = await waitFor(secondReader.read());
      if (next.done === true) {
        break;
      }
      chunks.push(next.value);
    }

    expect(chunks.join("")).toContain("second-stream");
    gate.resolve("late");
  });

  it("сохраняет AbortError по options.signal и освобождает очередь", async () => {
    const gate = deferred<string>();
    const controller = new AbortController();
    const stream = renderToStream(hungView(gate.promise), {
      signal: controller.signal,
    });
    const reader = stream.getReader();
    expect((await reader.read()).done).toBe(false);

    const rest = readAll(reader);
    controller.abort();
    await expect(rest).rejects.toThrow("aborted");

    const next = await waitFor(renderToString(plainView("after-signal")));
    expect(next.html).toContain("after-signal");
    gate.resolve("late");
  });

  it("патчит несколько Suspense-регионов без отмены", async () => {
    const stream = renderToStream(
      multiRegionPage([
        Promise.resolve({ default: finalView("final-0") }),
        Promise.resolve({ default: finalView("final-1") }),
        Promise.resolve({ default: finalView("final-2") }),
      ]),
    );
    const html = await readAll(stream.getReader());

    expect(html).toContain("final-0");
    expect(html).toContain("final-1");
    expect(html).toContain("final-2");
    expect(html).toContain("__silentStream.patch(");
    // Инструментарий действительно видит settle-работу каждого региона.
    expect(counters.serializeBetween).toBeGreaterThanOrEqual(3);
    expect(removedMarkers).toBeGreaterThanOrEqual(6);
  });

  it("не выполняет settle-работу после отмены при нескольких Suspense-регионах", async () => {
    const gates = [deferredGate(), deferredGate(), deferredGate()];
    let chunks = 0;
    const stream = renderToStream(
      multiRegionPage(gates.map((gate) => gate.promise)),
      {
        onChunk() {
          chunks += 1;
        },
      },
    );
    const reader = stream.getReader();

    const first = await waitFor(reader.read());
    expect(first.done).toBe(false);
    const shell = first.done === true ? "" : first.value;
    expect(shell).toContain("wait-0");
    expect(shell).toContain("wait-1");
    expect(shell).toContain("wait-2");

    await reader.cancel();
    // Повторная отмена идемпотентна.
    await reader.cancel();

    // Всё, что случилось до отмены, дальше не должно меняться.
    const before = {
      chunks,
      serializeBetween: counters.serializeBetween,
      flushSync: counters.flushSync,
      removedMarkers,
    };

    gates[0]?.resolve({ default: finalView("late-0") });
    gates[1]?.resolve({ default: finalView("late-1") });
    gates[2]?.resolve({ default: finalView("late-2") });
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Поздние резолвы не должны ни сериализовать, ни флашить, ни мутировать DOM.
    expect(counters.serializeBetween).toBe(before.serializeBetween);
    expect(counters.flushSync).toBe(before.flushSync);
    expect(removedMarkers).toBe(before.removedMarkers);
    expect(chunks).toBe(before.chunks);

    // Очередь рендеров освобождена: следующий рендер корректен.
    const next = await waitFor(renderToString(plainView("after-multi-cancel")));
    expect(next.html).toContain("after-multi-cancel");

    // Отмена после завершения потока — no-op.
    await reader.cancel();
  });

  it("не выполняет уже поставленную settle-задачу после отмены", async () => {
    const fastGate = deferredGate();
    const cancelGate = deferredGate();
    const LazyFast = lazy(() => fastGate.promise);
    const LazyCancel = lazy(() => cancelGate.promise);

    interface Snapshot {
      chunks: number;
      serializeBetween: number;
      flushSync: number;
      removedMarkers: number;
    }
    let chunks = 0;
    const snapshot = (): Snapshot => ({
      chunks,
      serializeBetween: counters.serializeBetween,
      flushSync: counters.flushSync,
      removedMarkers,
    });

    let cancelStream: () => void = () => {};
    const snapshotsAtCancel: Snapshot[] = [];
    let cancelCalls = 0;

    function Cancelling(): Node {
      cancelCalls += 1;
      cancelStream();
      snapshotsAtCancel.push(snapshot());
      const element = document.createElement("article");
      element.textContent = "cancel-final";
      return element;
    }

    function Page(): Node {
      const root = document.createElement("div");
      root.appendChild(
        Suspense({
          fallback: () => fallbackView("fast-wait"),
          children: () => LazyFast({}),
        }),
      );
      root.appendChild(
        Suspense({
          fallback: () => fallbackView("cancel-wait"),
          children: () => LazyCancel({}),
        }),
      );
      return root;
    }

    const stream = renderToStream(Page as unknown as AnyComponent, {
      onChunk() {
        chunks += 1;
      },
    });
    const reader = stream.getReader();
    cancelStream = () => {
      void reader.cancel();
    };

    const first = await waitFor(reader.read());
    expect(first.done).toBe(false);
    const shell = first.done === true ? "" : first.value;
    expect(shell).toContain("fast-wait");
    expect(shell).toContain("cancel-wait");

    // Обе границы резолвятся в одной волне микрозадач: settle первого региона
    // уже поставлен в очередь, когда второй регион отменяет поток.
    fastGate.resolve({ default: finalView("fast-final") });
    cancelGate.resolve({ default: Cancelling as unknown as AnyComponent });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(cancelCalls).toBe(1);
    const atCancel = snapshotsAtCancel[0];
    expect(atCancel).toBeDefined();
    if (atCancel === undefined) {
      throw new Error("Отмена не была зафиксирована");
    }
    // Отмена случилась до settle первого региона: после неё работы быть не должно.
    expect(chunks).toBe(atCancel.chunks);
    expect(counters.serializeBetween).toBe(atCancel.serializeBetween);
    expect(counters.flushSync).toBe(atCancel.flushSync);
    expect(removedMarkers).toBe(atCancel.removedMarkers);

    const next = await waitFor(
      renderToString(plainView("after-queued-cancel")),
    );
    expect(next.html).toContain("after-queued-cancel");

    await reader.cancel();
  });
});
