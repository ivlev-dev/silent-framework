import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  deepReactive,
  flushSync,
  isRaw,
  isReactive,
  isReadonly,
  markRaw,
  readonly,
  ReadonlyMutationError,
  unwrap,
} from "../src/index";

function collect<T>(iterable: Iterable<T>): T[] {
  return Array.from(iterable);
}

describe("deepReactive Map", () => {
  it("tracks get, has and size independently per key", () => {
    const map = deepReactive(new Map<string, number>([["a", 1]]));
    let aRuns = 0;
    let bRuns = 0;
    let hasBRuns = 0;
    let sizeRuns = 0;
    createRenderEffect(() => {
      map.get("a");
      aRuns += 1;
    });
    createRenderEffect(() => {
      map.get("b");
      bRuns += 1;
    });
    createRenderEffect(() => {
      map.has("b");
      hasBRuns += 1;
    });
    createRenderEffect(() => {
      map.size;
      sizeRuns += 1;
    });
    expect([aRuns, bRuns, hasBRuns, sizeRuns]).toEqual([1, 1, 1, 1]);

    map.set("a", 2);
    flushSync();
    expect([aRuns, bRuns, hasBRuns, sizeRuns]).toEqual([2, 1, 1, 1]);

    map.set("b", 3);
    flushSync();
    expect([aRuns, bRuns, hasBRuns, sizeRuns]).toEqual([2, 2, 2, 2]);

    map.delete("a");
    flushSync();
    expect([aRuns, bRuns, hasBRuns, sizeRuns]).toEqual([3, 2, 2, 3]);
    expect(map.has("a")).toBe(false);
    expect(map.get("a")).toBeUndefined();

    map.clear();
    flushSync();
    expect(map.size).toBe(0);
    expect([aRuns, bRuns, hasBRuns, sizeRuns]).toEqual([3, 3, 3, 4]);
  });

  it("does not notify when setting the same value", () => {
    const map = deepReactive(new Map<string, number>([["a", 1]]));
    let runs = 0;
    createRenderEffect(() => {
      map.get("a");
      runs += 1;
    });
    expect(runs).toBe(1);
    map.set("a", 1);
    flushSync();
    expect(runs).toBe(1);
    map.set("a", 2);
    flushSync();
    expect(runs).toBe(2);
  });

  it("tracks value iteration and keeps key iteration stable", () => {
    const map = deepReactive(
      new Map<string, number>([
        ["a", 1],
        ["b", 2],
      ]),
    );
    const valueSnapshots: number[][] = [];
    const keySnapshots: string[][] = [];
    createRenderEffect(() => {
      valueSnapshots.push(collect(map.values()) as number[]);
    });
    createRenderEffect(() => {
      keySnapshots.push(collect(map.keys()) as string[]);
    });
    expect(valueSnapshots).toEqual([[1, 2]]);
    expect(keySnapshots).toEqual([["a", "b"]]);

    map.set("a", 10);
    flushSync();
    expect(valueSnapshots.at(-1)).toEqual([10, 2]);
    expect(keySnapshots).toEqual([["a", "b"]]);

    map.set("c", 3);
    flushSync();
    expect(valueSnapshots.at(-1)).toEqual([10, 2, 3]);
    expect(keySnapshots.at(-1)).toEqual(["a", "b", "c"]);

    map.delete("b");
    flushSync();
    expect(valueSnapshots.at(-1)).toEqual([10, 3]);
    expect(keySnapshots.at(-1)).toEqual(["a", "c"]);
  });

  it("supports entries, default iteration and forEach", () => {
    const map = deepReactive(new Map<string, number>([["a", 1]]));
    const entrySnapshots: [string, number][][] = [];
    const forEachSnapshots: [string, number][][] = [];
    createRenderEffect(() => {
      entrySnapshots.push(collect(map.entries()) as [string, number][]);
    });
    createRenderEffect(() => {
      const seen: [string, number][] = [];
      map.forEach((value, key) => {
        seen.push([key, value]);
      });
      forEachSnapshots.push(seen);
    });
    expect(entrySnapshots).toEqual([[["a", 1]]]);
    expect(forEachSnapshots).toEqual([[["a", 1]]]);
    expect(collect(map)).toEqual([["a", 1]]);

    map.set("b", 2);
    flushSync();
    expect(entrySnapshots.at(-1)).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(forEachSnapshots.at(-1)).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("wraps nested values and unwraps keys for lookup", () => {
    const raw = {
      map: new Map<string, { value: number }>([["item", { value: 1 }]]),
    };
    const state = deepReactive(raw);
    const nested = state.map.get("item");
    expect(nested).toBeDefined();
    expect(isReactive(nested)).toBe(true);
    expect(unwrap(state.map)).toBe(raw.map);
    expect(nested === undefined ? undefined : unwrap(nested)).toBe(
      raw.map.get("item"),
    );

    let runs = 0;
    createRenderEffect(() => {
      state.map.get("item")?.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    nested!.value = 2;
    flushSync();
    expect(runs).toBe(2);
    expect(raw.map.get("item")?.value).toBe(2);

    state.map.set("item", { value: 5 });
    flushSync();
    expect(runs).toBe(3);
    expect(state.map.get("item")?.value).toBe(5);
  });

  it("supports object keys and wraps them on iteration", () => {
    const key = { id: 1 };
    const map = deepReactive(new Map<object, string>());
    map.set(key, "value");
    expect(map.get(key)).toBe("value");
    expect(map.has(key)).toBe(true);

    const [reactiveKey] = collect(map.keys());
    expect(reactiveKey).toBeDefined();
    expect(isReactive(reactiveKey)).toBe(true);
    expect(map.get(reactiveKey!)).toBe("value");

    const [entry] = collect(map.entries()) as [unknown, string][];
    expect(entry?.[0]).toBe(reactiveKey);

    expect(() => map.set({ id: 2 }, "other")).not.toThrow();
    expect(map.size).toBe(2);
  });
});

describe("deepReactive Set", () => {
  it("tracks has, size, add, delete and clear", () => {
    const set = deepReactive(new Set<string>(["a"]));
    let aRuns = 0;
    let bRuns = 0;
    let sizeRuns = 0;
    createRenderEffect(() => {
      set.has("a");
      aRuns += 1;
    });
    createRenderEffect(() => {
      set.has("b");
      bRuns += 1;
    });
    createRenderEffect(() => {
      set.size;
      sizeRuns += 1;
    });
    expect([aRuns, bRuns, sizeRuns]).toEqual([1, 1, 1]);

    set.add("a");
    flushSync();
    expect([aRuns, bRuns, sizeRuns]).toEqual([1, 1, 1]);

    set.add("b");
    flushSync();
    expect([aRuns, bRuns, sizeRuns]).toEqual([1, 2, 2]);

    set.delete("a");
    flushSync();
    expect([aRuns, bRuns, sizeRuns]).toEqual([2, 2, 3]);

    set.clear();
    flushSync();
    expect(set.size).toBe(0);
    expect([aRuns, bRuns, sizeRuns]).toEqual([2, 3, 4]);
  });

  it("tracks iteration and forEach", () => {
    const set = deepReactive(new Set<number>([1, 2]));
    const valueSnapshots: number[][] = [];
    const entrySnapshots: [number, number][][] = [];
    createRenderEffect(() => {
      valueSnapshots.push(collect(set.values()) as number[]);
    });
    createRenderEffect(() => {
      entrySnapshots.push(collect(set.entries()) as [number, number][]);
    });
    expect(valueSnapshots).toEqual([[1, 2]]);
    expect(entrySnapshots).toEqual([
      [
        [1, 1],
        [2, 2],
      ],
    ]);

    set.add(3);
    flushSync();
    expect(valueSnapshots.at(-1)).toEqual([1, 2, 3]);
    expect(entrySnapshots.at(-1)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);

    set.delete(1);
    flushSync();
    expect(valueSnapshots.at(-1)).toEqual([2, 3]);
    expect(collect(set)).toEqual([2, 3]);
  });

  it("wraps nested Set values", () => {
    const raw = new Set<{ value: number }>();
    raw.add({ value: 1 });
    const set = deepReactive(raw);
    const [item] = collect(set.values()) as { value: number }[];
    expect(item).toBeDefined();
    expect(isReactive(item)).toBe(true);
    let runs = 0;
    createRenderEffect(() => {
      item!.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    item!.value = 2;
    flushSync();
    expect(runs).toBe(2);
    expect(collect(raw)[0]?.value).toBe(2);
  });

  it("keeps collections reactive when nested inside objects and arrays", () => {
    const state = deepReactive({
      map: new Map<string, number>(),
      set: new Set<number>(),
      list: [new Map<string, number>()],
    });
    expect(isReactive(state.map)).toBe(true);
    expect(isReactive(state.set)).toBe(true);
    expect(isReactive(state.list[0])).toBe(true);

    let runs = 0;
    createRenderEffect(() => {
      state.map.get("x");
      state.set.has(1);
      state.list[0]?.get("y");
      runs += 1;
    });
    expect(runs).toBe(1);
    state.map.set("x", 1);
    state.set.add(1);
    state.list[0]?.set("y", 2);
    flushSync();
    expect(runs).toBe(2);
  });
});

describe("markRaw", () => {
  it("prevents wrapping and preserves identity", () => {
    const object = markRaw({ value: 1 });
    const map = markRaw(new Map<string, number>());
    const set = markRaw(new Set<number>());
    expect(isRaw(object)).toBe(true);
    expect(isRaw(map)).toBe(true);
    expect(isRaw(set)).toBe(true);
    expect(deepReactive(object)).toBe(object);
    expect(deepReactive(map)).toBe(map);
    expect(deepReactive(set)).toBe(set);
    expect(isReactive(object)).toBe(false);
    expect(isReactive(map)).toBe(false);
    expect(isReactive(set)).toBe(false);
  });

  it("keeps raw values raw when nested", () => {
    const raw = markRaw({ value: 1 });
    const state = deepReactive({ nested: raw, list: [raw] });
    expect(state.nested).toBe(raw);
    expect(state.list[0]).toBe(raw);
    expect(isRaw(state.nested)).toBe(true);
    expect(isReactive(state.nested)).toBe(false);
    expect(isReadonly(readonly(state).nested)).toBe(false);
    expect(readonly(state).nested).toBe(raw);
  });

  it("prevents wrapping instances of marked classes", () => {
    class Marked {
      value = 1;
    }
    markRaw(Marked);
    const instance = new Marked();
    expect(isRaw(Marked)).toBe(true);
    expect(isRaw(instance)).toBe(true);
    expect(deepReactive(instance)).toBe(instance);
    expect(isReactive(instance)).toBe(false);
  });

  it("keeps isRaw and isReactive consistent", () => {
    const raw = markRaw({ a: 1 });
    const reactive = deepReactive({ a: 1 });
    expect(isRaw(raw)).toBe(true);
    expect(isReactive(raw)).toBe(false);
    expect(isRaw(reactive)).toBe(false);
    expect(isReactive(reactive)).toBe(true);
    expect(isRaw(readonly({ a: 1 }))).toBe(false);
  });
});

describe("readonly", () => {
  it("wraps objects, arrays and collections", () => {
    const raw = {
      count: 0,
      nested: { value: 1 },
      list: [1, 2],
      map: new Map<string, { value: number }>([["a", { value: 1 }]]),
      set: new Set<number>([1]),
    };
    const state = deepReactive(raw);
    const frozen = readonly(state);

    expect(isReadonly(frozen)).toBe(true);
    expect(isReactive(frozen)).toBe(false);
    expect(isReadonly(frozen.nested)).toBe(true);
    expect(isReactive(frozen.nested)).toBe(false);
    expect(frozen.count).toBe(0);
    expect(frozen.list[1]).toBe(2);
    expect(frozen.map.get("a")?.value).toBe(1);
    expect(isReadonly(frozen.map.get("a"))).toBe(true);
    expect(unwrap(frozen)).toBe(raw);
    expect(readonly(frozen)).toBe(frozen);
    expect(readonly(state)).toBe(frozen);
    expect(readonly(raw)).toBe(frozen);
  });

  it("tracks reads through the readonly wrapper", () => {
    const state = deepReactive({ count: 0, nested: { value: 1 } });
    const frozen = readonly(state);
    let runs = 0;
    let seen = 0;
    createRenderEffect(() => {
      seen = frozen.nested.value;
      runs += 1;
    });
    expect([seen, runs]).toEqual([1, 1]);
    state.nested.value = 2;
    flushSync();
    expect([seen, runs]).toEqual([2, 2]);
  });

  it("throws on any mutation attempt", () => {
    const state = deepReactive({
      count: 0,
      nested: { value: 1 },
      list: [1, 2],
      map: new Map<string, number>([["a", 1]]),
      set: new Set<number>([1]),
    });
    const frozen = readonly(state);

    expect(() => {
      frozen.count = 2;
    }).toThrow(ReadonlyMutationError);
    expect(() => {
      frozen.nested.value = 2;
    }).toThrow(ReadonlyMutationError);
    expect(() => {
      delete (frozen as { count?: number }).count;
    }).toThrow(ReadonlyMutationError);
    expect(() => frozen.list.push(3)).toThrow(ReadonlyMutationError);
    expect(() => frozen.list.splice(0, 1)).toThrow(ReadonlyMutationError);
    expect(() => frozen.map.set("b", 2)).toThrow(ReadonlyMutationError);
    expect(() => frozen.map.delete("a")).toThrow(ReadonlyMutationError);
    expect(() => frozen.map.clear()).toThrow(ReadonlyMutationError);
    expect(() => frozen.set.add(2)).toThrow(ReadonlyMutationError);
    expect(() => {
      Object.defineProperty(frozen, "count", { value: 3 });
    }).toThrow(ReadonlyMutationError);

    expect(state.count).toBe(0);
    expect(state.list).toEqual([1, 2]);
    expect(state.map.size).toBe(1);
    expect(state.set.size).toBe(1);
  });

  it("не разворачивает readonly при записи в реактивное поле", () => {
    const source = deepReactive({ count: 0 });
    const frozen = readonly(source);
    const holder = deepReactive<{ child: unknown }>({ child: null });
    holder.child = frozen;

    expect(holder.child).toBe(frozen);
    expect(isReadonly(holder.child)).toBe(true);
    expect(() => {
      (holder.child as { count: number }).count = 2;
    }).toThrow(ReadonlyMutationError);
    expect(source.count).toBe(0);
  });

  it("reports a descriptive mutation error", () => {
    const frozen = readonly({ value: 1 });
    expect(() => {
      frozen.value = 2;
    }).toThrowError(/readonly object "value"/);
  });

  it("keeps readonly collection iteration and helpers usable", () => {
    const map = readonly(
      new Map<string, { value: number }>([["a", { value: 1 }]]),
    );
    const set = readonly(new Set<number>([1]));
    expect(map.size).toBe(1);
    expect(map.has("a")).toBe(true);
    expect(collect(map.keys())).toEqual(["a"]);
    const [entry] = collect(map.entries()) as [string, { value: number }][];
    expect(entry?.[0]).toBe("a");
    expect(isReadonly(entry?.[1])).toBe(true);
    expect(collect(map)).toHaveLength(1);
    const seen: [string, number][] = [];
    map.forEach((value, key) => {
      seen.push([key, value.value]);
    });
    expect(seen).toEqual([["a", 1]]);

    expect(set.size).toBe(1);
    expect(set.has(1)).toBe(true);
    expect(collect(set.values())).toEqual([1]);
    expect(collect(set.entries())).toEqual([[1, 1]]);
    expect(collect(set)).toEqual([1]);
  });

  it("returns non-wrappable values as-is", () => {
    const date = new Date();
    expect(readonly(date)).toBe(date);
    expect(isReadonly(date)).toBe(false);
    expect(readonly(5)).toBe(5);
    expect(readonly("text")).toBe("text");
  });

  it("keeps readonly arrays compatible with structural operations", () => {
    const frozen = readonly({ list: [3, 1, 2] });
    expect(frozen.list.length).toBe(3);
    expect(Array.isArray(frozen.list)).toBe(true);
    expect(frozen.list.slice().sort()).toEqual([1, 2, 3]);
    expect(frozen.list.map((item) => item * 2)).toEqual([6, 2, 4]);
    expect(JSON.stringify(frozen)).toBe('{"list":[3,1,2]}');
  });
});

describe("delete and field churn", () => {
  it("keeps deleted keys reactive and allows re-adding them", () => {
    const state = deepReactive<Record<string, number>>({ a: 1 });
    let runs = 0;
    createRenderEffect(() => {
      state.a;
      runs += 1;
    });
    expect(runs).toBe(1);
    delete state.a;
    flushSync();
    expect(runs).toBe(2);
    expect(state.a).toBeUndefined();
    state.a = 5;
    flushSync();
    expect(runs).toBe(3);
    expect(state.a).toBe(5);
  });

  it("drops unobserved fields without leaking notifications", () => {
    const state = deepReactive<Record<string, number>>({ a: 1, b: 2 });
    let aRuns = 0;
    let bRuns = 0;
    createRenderEffect(() => {
      state.a;
      aRuns += 1;
    });
    createRenderEffect(() => {
      state.b;
      bRuns += 1;
    });
    expect([aRuns, bRuns]).toEqual([1, 1]);

    expect(state.a).toBe(1);
    delete state.a;
    flushSync();
    expect([aRuns, bRuns]).toEqual([2, 1]);
    expect(state.a).toBeUndefined();

    state.a = 7;
    flushSync();
    expect([aRuns, bRuns]).toEqual([3, 1]);
    expect(state.a).toBe(7);
  });

  it("keeps a field deleted during the same effect run observable", () => {
    const state = deepReactive<Record<string, number>>({});
    const seen: (number | undefined)[] = [];
    createRenderEffect(() => {
      seen.push(state.b);
      delete state.b;
    });
    expect(seen).toEqual([undefined]);

    state.b = 3;
    flushSync();
    expect(seen).toContain(3);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("keeps a collection slot deleted during the same effect run observable", () => {
    const map = deepReactive(new Map<string, number>());
    const seen: boolean[] = [];
    createRenderEffect(() => {
      seen.push(map.has("x"));
      map.delete("x");
    });
    expect(seen).toEqual([false]);

    map.set("x", 1);
    flushSync();
    expect(seen).toContain(true);
  });

  it("stays correct under key churn", () => {
    const state = deepReactive<Record<string, number>>({});
    let runs = 0;
    createRenderEffect(() => {
      state.a;
      runs += 1;
    });
    expect(runs).toBe(1);
    for (let index = 0; index < 100; index += 1) {
      state[`key${index}`] = index;
      if (index % 2 === 0) {
        delete state[`key${index}`];
      }
    }
    flushSync();
    expect(runs).toBe(1);
    expect(Object.keys(state)).toHaveLength(50);
    state.a = 1;
    flushSync();
    expect(runs).toBe(2);
    delete state.a;
    flushSync();
    expect(runs).toBe(3);
  });
});

describe("arrays and structural operations after changes", () => {
  it("stays consistent after array mutations", () => {
    const state = deepReactive({ list: [1, 2, 3] });
    const snapshots: number[][] = [];
    createRenderEffect(() => {
      snapshots.push([...state.list]);
    });
    expect(snapshots).toEqual([[1, 2, 3]]);

    state.list.push(4);
    flushSync();
    expect(snapshots.at(-1)).toEqual([1, 2, 3, 4]);

    state.list.splice(1, 1);
    flushSync();
    expect(snapshots.at(-1)).toEqual([1, 3, 4]);

    state.list[0] = 10;
    flushSync();
    expect(snapshots.at(-1)).toEqual([10, 3, 4]);

    delete (state.list as unknown as Record<string, unknown>)[1];
    flushSync();
    expect(state.list.length).toBe(3);
    expect(state.list[1]).toBeUndefined();
  });

  it("supports JSON and structural operations", () => {
    const state = deepReactive({
      user: { name: "Ann", tags: ["a"] as string[] },
      meta: { count: 1 },
    });
    state.user.tags.push("b");
    state.meta.count = 2;
    flushSync();

    expect(JSON.stringify(state)).toBe(
      '{"user":{"name":"Ann","tags":["a","b"]},"meta":{"count":2}}',
    );
    expect(JSON.parse(JSON.stringify(unwrap(state)))).toEqual({
      user: { name: "Ann", tags: ["a", "b"] },
      meta: { count: 2 },
    });
    expect(structuredClone(unwrap(state))).toEqual({
      user: { name: "Ann", tags: ["a", "b"] },
      meta: { count: 2 },
    });
    expect(Object.keys(state.user)).toEqual(["name", "tags"]);
    expect(Object.entries(state.meta)).toEqual([["count", 2]]);
    expect([...state.user.tags]).toEqual(["a", "b"]);
  });

  it("serializes nested objects stored in collections", () => {
    const map = deepReactive(new Map<string, { value: number }>());
    map.set("item", { value: 1 });
    const value = map.get("item");
    expect(value).toBeDefined();
    if (value !== undefined) {
      value.value = 2;
    }
    flushSync();
    expect(JSON.stringify(map.get("item"))).toBe('{"value":2}');
    expect(JSON.parse(JSON.stringify(unwrap(map).get("item")))).toEqual({
      value: 2,
    });
  });
});
