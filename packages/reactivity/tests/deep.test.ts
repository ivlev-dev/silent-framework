import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  deepReactive,
  flushSync,
  isReactive,
  isReactiveClass,
  markReactiveClass,
  unwrap,
} from "../src/index";

describe("deepReactive", () => {
  it("tracks each property independently", () => {
    const state = deepReactive({ a: 1, b: 2 });
    let runsA = 0;
    let runsB = 0;
    createRenderEffect(() => {
      state.a;
      runsA += 1;
    });
    createRenderEffect(() => {
      state.b;
      runsB += 1;
    });
    expect(runsA).toBe(1);
    expect(runsB).toBe(1);
    state.a = 10;
    flushSync();
    expect(runsA).toBe(2);
    expect(runsB).toBe(1);
    state.b = 20;
    flushSync();
    expect(runsA).toBe(2);
    expect(runsB).toBe(2);
  });

  it("wraps nested objects lazily and preserves identity", () => {
    const raw = { nested: { value: 1 } };
    const state = deepReactive(raw);
    expect(isReactive(state)).toBe(true);
    expect(isReactive(raw)).toBe(false);
    expect(deepReactive(state)).toBe(state);
    expect(state.nested).toBe(state.nested);
    expect(unwrap(state)).toBe(raw);
    expect(unwrap(state.nested)).toBe(raw.nested);
    let runs = 0;
    createRenderEffect(() => {
      state.nested.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    state.nested.value = 2;
    flushSync();
    expect(runs).toBe(2);
    expect(raw.nested.value).toBe(2);
  });

  it("tracks arrays by index and length", () => {
    const array = deepReactive<number[]>([1, 2, 3]);
    let indexRuns = 0;
    let lengthRuns = 0;
    let keyRuns = 0;
    createRenderEffect(() => {
      array[0];
      indexRuns += 1;
    });
    createRenderEffect(() => {
      array.length;
      lengthRuns += 1;
    });
    createRenderEffect(() => {
      Object.keys(array);
      keyRuns += 1;
    });
    expect(indexRuns).toBe(1);
    expect(lengthRuns).toBe(1);
    expect(keyRuns).toBe(1);
    array.push(4);
    flushSync();
    expect(array.length).toBe(4);
    expect(array[3]).toBe(4);
    expect(indexRuns).toBe(1);
    expect(lengthRuns).toBe(2);
    expect(keyRuns).toBe(2);
    array[0] = 9;
    flushSync();
    expect(indexRuns).toBe(2);
    expect(lengthRuns).toBe(2);
    expect(keyRuns).toBe(2);
  });

  it("notifies only affected indices on splice", () => {
    const array = deepReactive([1, 2, 3, 4]);
    let first = 0;
    let third = 0;
    let length = 0;
    createRenderEffect(() => {
      array[0];
      first += 1;
    });
    createRenderEffect(() => {
      array[2];
      third += 1;
    });
    createRenderEffect(() => {
      array.length;
      length += 1;
    });
    expect([first, third, length]).toEqual([1, 1, 1]);
    array.splice(1, 1);
    flushSync();
    expect(array).toEqual([1, 3, 4]);
    expect(first).toBe(1);
    expect(third).toBe(2);
    expect(length).toBe(2);
  });

  it("supports push, pop, shift and unshift", () => {
    const array = deepReactive<number[]>([]);
    let lengthRuns = 0;
    let indexZeroRuns = 0;
    createRenderEffect(() => {
      array.length;
      lengthRuns += 1;
    });
    createRenderEffect(() => {
      array[0];
      indexZeroRuns += 1;
    });
    expect(array.push(1, 2)).toBe(2);
    flushSync();
    expect(lengthRuns).toBe(2);
    expect(indexZeroRuns).toBe(2);
    expect(array.pop()).toBe(2);
    flushSync();
    expect(array).toEqual([1]);
    expect(array.shift()).toBe(1);
    flushSync();
    expect(array).toEqual([]);
    expect(array.unshift(5, 6)).toBe(2);
    flushSync();
    expect(array).toEqual([5, 6]);
  });

  it("supports sort, reverse, fill and copyWithin", () => {
    const array = deepReactive([3, 1, 2]);
    const seen: number[][] = [];
    createRenderEffect(() => {
      seen.push([array[0] as number, array[1] as number, array[2] as number]);
    });
    expect(seen).toEqual([[3, 1, 2]]);
    array.sort();
    flushSync();
    expect(seen).toEqual([
      [3, 1, 2],
      [1, 2, 3],
    ]);
    array.reverse();
    flushSync();
    expect(seen.at(-1)).toEqual([3, 2, 1]);
    array.fill(7);
    flushSync();
    expect(seen.at(-1)).toEqual([7, 7, 7]);
    array[0] = 1;
    array[1] = 2;
    flushSync();
    array.copyWithin(1, 0);
    flushSync();
    expect(seen.at(-1)).toEqual([1, 1, 2]);
  });

  it("reacts to length assignment", () => {
    const array = deepReactive([1, 2, 3]);
    let lengthRuns = 0;
    let lastRuns = 0;
    createRenderEffect(() => {
      array.length;
      lengthRuns += 1;
    });
    createRenderEffect(() => {
      array[2];
      lastRuns += 1;
    });
    expect([lengthRuns, lastRuns]).toEqual([1, 1]);
    array.length = 1;
    flushSync();
    expect(array.length).toBe(1);
    expect(lengthRuns).toBe(2);
    expect(lastRuns).toBe(2);
    expect(array[2]).toBeUndefined();
  });

  it("tracks the key set for Object.keys, for-in, delete and spread", () => {
    const state = deepReactive<Record<string, number>>({ a: 1 });
    const keySnapshots: string[][] = [];
    const spreadSnapshots: Record<string, number>[] = [];
    let inRuns = 0;
    createRenderEffect(() => {
      keySnapshots.push(Object.keys(state));
    });
    createRenderEffect(() => {
      spreadSnapshots.push({ ...state });
    });
    createRenderEffect(() => {
      "b" in state;
      inRuns += 1;
    });
    expect(keySnapshots).toEqual([["a"]]);
    state.b = 2;
    flushSync();
    expect(keySnapshots.at(-1)).toEqual(["a", "b"]);
    expect(spreadSnapshots.at(-1)).toEqual({ a: 1, b: 2 });
    expect(inRuns).toBe(2);
    delete state.a;
    flushSync();
    expect(keySnapshots.at(-1)).toEqual(["b"]);
    expect(spreadSnapshots.at(-1)).toEqual({ b: 2 });
    expect("a" in state).toBe(false);
  });

  it("updates spread when an existing property changes", () => {
    const state = deepReactive({ a: 1 });
    const snapshots: Record<string, number>[] = [];
    createRenderEffect(() => {
      snapshots.push({ ...state });
    });
    expect(snapshots).toEqual([{ a: 1 }]);
    state.a = 2;
    flushSync();
    expect(snapshots.at(-1)).toEqual({ a: 2 });
  });

  it("notifies an index on delete and keeps for-in reactive", () => {
    const array = deepReactive<number[]>([1, 2]);
    let runs = 0;
    createRenderEffect(() => {
      array[0];
      runs += 1;
    });
    expect(runs).toBe(1);
    delete array[0];
    flushSync();
    expect(runs).toBe(2);
    expect(array[0]).toBeUndefined();
    expect(array.length).toBe(2);

    const state = deepReactive<Record<string, number>>({ a: 1 });
    const snapshots: string[][] = [];
    createRenderEffect(() => {
      const keys: string[] = [];
      for (const key in state) {
        keys.push(key);
      }
      snapshots.push(keys);
    });
    expect(snapshots).toEqual([["a"]]);
    state.b = 2;
    flushSync();
    expect(snapshots.at(-1)).toEqual(["a", "b"]);
    delete state.a;
    flushSync();
    expect(snapshots.at(-1)).toEqual(["b"]);
  });

  it("does not wrap built-in objects or DOM-like values", () => {
    const date = new Date();
    const map = new Map<string, number>();
    const set = new Set<number>();
    const promise = Promise.resolve(1);
    const weak = new WeakMap<object, number>();
    expect(deepReactive(date)).toBe(date);
    expect(deepReactive(map)).toBe(map);
    expect(deepReactive(set)).toBe(set);
    expect(deepReactive(promise)).toBe(promise);
    expect(deepReactive(weak)).toBe(weak);
    expect(isReactive(date)).toBe(false);
  });

  it("does not rewrap instances of reactive classes", () => {
    class ReactiveModel {
      value = 1;
    }
    class PlainModel {
      value = 1;
    }
    markReactiveClass(ReactiveModel);
    expect(isReactiveClass(ReactiveModel)).toBe(true);
    expect(isReactiveClass(PlainModel)).toBe(false);
    const reactive = new ReactiveModel();
    expect(deepReactive(reactive)).toBe(reactive);
    const plain = new PlainModel();
    expect(isReactive(deepReactive(plain))).toBe(true);
    const nested = deepReactive([reactive, new PlainModel()]);
    expect(nested[0]).toBe(reactive);
    expect(isReactive(nested[1])).toBe(true);
  });

  it("keeps class instances deeply reactive until marked", () => {
    class Model {
      value = 1;
    }
    const model = deepReactive(new Model());
    let runs = 0;
    createRenderEffect(() => {
      model.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    model.value = 2;
    flushSync();
    expect(runs).toBe(2);
  });
});
