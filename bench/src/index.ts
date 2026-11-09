import { JSDOM } from "jsdom";
import { Bench } from "tinybench";
import {
  batch,
  createMemo,
  createSignal,
  flushSync,
} from "@silent/reactivity";
import { For } from "@silent/core";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const documentRef = dom.window.document;
Object.defineProperty(globalThis, "document", {
  value: documentRef,
  configurable: true,
});
Object.defineProperty(globalThis, "Node", {
  value: dom.window.Node,
  configurable: true,
});
Object.defineProperty(globalThis, "Element", {
  value: dom.window.Element,
  configurable: true,
});
Object.defineProperty(globalThis, "DocumentFragment", {
  value: dom.window.DocumentFragment,
  configurable: true,
});
Object.defineProperty(globalThis, "SVGElement", {
  value: dom.window.SVGElement,
  configurable: true,
});
Object.defineProperty(globalThis, "NodeFilter", {
  value: dom.window.NodeFilter,
  configurable: true,
});

const bench = new Bench({ time: 500, warmupTime: 100 });

bench.add("signal write + flush", () => {
  const [value, setValue] = createSignal(0);
  for (let index = 0; index < 1000; index += 1) {
    setValue(index);
    flushSync();
    void value();
  }
});

bench.add("computed chain", () => {
  const [value, setValue] = createSignal(1);
  const double = createMemo(() => value() * 2);
  const quadruple = createMemo(() => double() * 2);
  batch(() => {
    for (let index = 0; index < 1000; index += 1) {
      setValue(index);
      void quadruple();
    }
  });
});

bench.add("keyed For 1000 rows", () => {
  const host = documentRef.createElement("div");
  const [items] = createSignal(
    Array.from({ length: 1000 }, (_, index) => ({ id: index })),
  );
  host.appendChild(
    For({
      each: items,
      children: (item: { id: number }) => {
        const row = documentRef.createElement("div");
        row.textContent = String(item.id);
        return row;
      },
    }),
  );
  flushSync();
});

await bench.run();
console.table(bench.table());
