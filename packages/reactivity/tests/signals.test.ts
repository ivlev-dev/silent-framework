import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flushSync,
  on,
  untrack,
} from "../src/index";

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe("signals", () => {
  it("reads and writes values", () => {
    const [count, setCount] = createSignal(0);
    expect(count()).toBe(0);
    expect(setCount(5)).toBe(5);
    expect(count()).toBe(5);
    expect(setCount((value) => value + 1)).toBe(6);
    expect(count()).toBe(6);
  });

  it("does not notify when custom equals matches", () => {
    const [value, setValue] = createSignal(
      { id: 1, label: "a" },
      { equals: (a, b) => a.id === b.id },
    );
    let runs = 0;
    createRenderEffect(() => {
      value();
      runs += 1;
    });
    expect(runs).toBe(1);
    setValue({ id: 1, label: "b" });
    flushSync();
    expect(runs).toBe(1);
    expect(value().label).toBe("a");
    setValue({ id: 2, label: "c" });
    flushSync();
    expect(runs).toBe(2);
    expect(value().label).toBe("c");
  });
});

describe("memo", () => {
  it("is lazy and caches values", () => {
    const [source, setSource] = createSignal(2);
    let computes = 0;
    const doubled = createMemo(() => {
      computes += 1;
      return source() * 2;
    });
    expect(computes).toBe(0);
    expect(doubled()).toBe(4);
    expect(computes).toBe(1);
    expect(doubled()).toBe(4);
    expect(computes).toBe(1);
    setSource(3);
    expect(computes).toBe(1);
    expect(doubled()).toBe(6);
    expect(computes).toBe(2);
  });

  it("does not notify dependent effects when the value is unchanged", () => {
    const [source, setSource] = createSignal(1);
    const parity = createMemo(() => source() % 2);
    let effectRuns = 0;
    let observed = -1;
    createRenderEffect(() => {
      effectRuns += 1;
      observed = parity();
    });
    expect(effectRuns).toBe(1);
    setSource(3);
    flushSync();
    expect(effectRuns).toBe(1);
    expect(observed).toBe(1);
    setSource(4);
    flushSync();
    expect(effectRuns).toBe(2);
    expect(observed).toBe(0);
  });

  it("supports custom equals", () => {
    const [source, setSource] = createSignal({ id: 1 });
    let computes = 0;
    const memo = createMemo(
      () => {
        computes += 1;
        return source();
      },
      { equals: (a, b) => a.id === b.id },
    );
    expect(memo()).toEqual({ id: 1 });
    expect(computes).toBe(1);
    setSource({ id: 1 });
    expect(memo()).toEqual({ id: 1 });
    expect(computes).toBe(2);
    let runs = 0;
    createRenderEffect(() => {
      memo();
      runs += 1;
    });
    setSource({ id: 1 });
    flushSync();
    expect(runs).toBe(1);
    setSource({ id: 2 });
    flushSync();
    expect(runs).toBe(2);
  });

  it("tracks only the properties that were read", () => {
    const [first, setFirst] = createSignal(1);
    const [second, setSecond] = createSignal(2);
    let firstRuns = 0;
    let secondRuns = 0;
    createRenderEffect(() => {
      first();
      firstRuns += 1;
    });
    createRenderEffect(() => {
      second();
      secondRuns += 1;
    });
    expect(firstRuns).toBe(1);
    expect(secondRuns).toBe(1);
    setFirst(10);
    flushSync();
    expect(firstRuns).toBe(2);
    expect(secondRuns).toBe(1);
    setSecond(20);
    flushSync();
    expect(firstRuns).toBe(2);
    expect(secondRuns).toBe(2);
  });

  it("drops dependencies that are no longer read", async () => {
    const [enabled, setEnabled] = createSignal(true);
    const [value, setValue] = createSignal(1);
    let runs = 0;
    createEffect(() => {
      if (enabled()) {
        value();
      }
      runs += 1;
    });
    await tick();
    expect(runs).toBe(1);
    setValue(2);
    flushSync();
    expect(runs).toBe(2);
    setEnabled(false);
    flushSync();
    expect(runs).toBe(3);
    setValue(3);
    flushSync();
    expect(runs).toBe(3);
  });
});

describe("effects", () => {
  it("runs createEffect on a microtask and then on changes", async () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    createEffect(() => {
      value();
      runs += 1;
    });
    expect(runs).toBe(0);
    await tick();
    expect(runs).toBe(1);
    setValue(1);
    expect(runs).toBe(1);
    flushSync();
    expect(runs).toBe(2);
    setValue(1);
    flushSync();
    expect(runs).toBe(2);
  });

  it("runs createRenderEffect synchronously and updates in a shared flush", () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    createRenderEffect(() => {
      value();
      runs += 1;
    });
    expect(runs).toBe(1);
    setValue(1);
    expect(runs).toBe(1);
    flushSync();
    expect(runs).toBe(2);
  });

  it("untrack prevents a dependency from being tracked", () => {
    const [tracked, setTracked] = createSignal(0);
    const [untracked, setUntracked] = createSignal(0);
    let runs = 0;
    createRenderEffect(() => {
      tracked();
      untrack(() => untracked());
      runs += 1;
    });
    expect(runs).toBe(1);
    setUntracked(1);
    flushSync();
    expect(runs).toBe(1);
    setTracked(1);
    flushSync();
    expect(runs).toBe(2);
    expect(untracked()).toBe(1);
  });

  it("on reacts to dependencies and supports defer", async () => {
    const [value, setValue] = createSignal(1);
    const calls: [number, number][] = [];
    on(value, (next, prev) => {
      calls.push([next, prev]);
    });
    expect(calls).toEqual([]);
    await tick();
    expect(calls).toEqual([[1, 1]]);
    setValue(2);
    flushSync();
    expect(calls).toEqual([
      [1, 1],
      [2, 1],
    ]);

    const deferred: [number, number][] = [];
    const second = createSignal(5);
    on(second[0], (next, prev) => {
      deferred.push([next, prev]);
    }, { defer: true });
    await tick();
    expect(deferred).toEqual([]);
    second[1](6);
    flushSync();
    expect(deferred).toEqual([[6, 5]]);
  });

  it("disposes effects with the owner", async () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    let disposed = false;
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        value();
        runs += 1;
        if (disposed) {
          throw new Error("effect ran after dispose");
        }
      });
      return disposeRoot;
    });
    await tick();
    expect(runs).toBe(1);
    disposed = true;
    dispose();
    setValue(1);
    flushSync();
    expect(runs).toBe(1);
  });
});
