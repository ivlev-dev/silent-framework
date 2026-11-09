import { describe, expect, it } from "vitest";
import {
  createReactiveStore,
  createRenderEffect,
  createSignal,
  deepReactive,
  flushSync,
  getComputed,
  isReactive,
  readField,
  registerCleanup,
  storeFor,
  unwrap,
  writeField,
} from "../src/index";

class Counter {
  private rawCount = 0;
  private rawData: { nested: { value: number } } = { nested: { value: 1 } };

  get count(): number {
    return readField(this, "count", () => this.rawCount);
  }

  set count(value: number) {
    writeField(this, "count", value, (raw) => {
      this.rawCount = raw;
    });
  }

  get data(): { nested: { value: number } } {
    return readField(this, "data", () => this.rawData);
  }

  set data(value: { nested: { value: number } }) {
    writeField(this, "data", value, (raw) => {
      this.rawData = raw;
    });
  }

  get doubled(): number {
    return getComputed(this, "doubled", () => this.count * 2);
  }
}

describe("reactive store", () => {
  it("creates one store per instance", () => {
    const instance = {};
    expect(storeFor(instance)).toBe(storeFor(instance));
    expect(storeFor(instance).disposed).toBe(false);
    const standalone = createReactiveStore();
    expect(standalone.disposed).toBe(false);
  });

  it("reads and writes fields reactively", () => {
    const counter = new Counter();
    let runs = 0;
    let seen = 0;
    createRenderEffect(() => {
      seen = counter.count;
      runs += 1;
    });
    expect(runs).toBe(1);
    expect(seen).toBe(0);
    counter.count = 5;
    flushSync();
    expect(runs).toBe(2);
    expect(seen).toBe(5);
    counter.count = 5;
    flushSync();
    expect(runs).toBe(2);
  });

  it("returns a deep proxy for object fields and unwraps writes", () => {
    const counter = new Counter();
    let runs = 0;
    createRenderEffect(() => {
      counter.data.nested.value;
      runs += 1;
    });
    expect(runs).toBe(1);
    expect(isReactive(counter.data)).toBe(true);
    counter.data.nested.value = 2;
    flushSync();
    expect(runs).toBe(2);
    const replacement = deepReactive({ nested: { value: 3 } });
    counter.data = replacement;
    flushSync();
    expect(runs).toBe(3);
    expect(unwrap(counter.data)).toEqual({ nested: { value: 3 } });
    expect(counter.data).toBe(replacement);
  });

  it("creates a memo per computed key and disposes it with the store", () => {
    const counter = new Counter();
    let computes = 0;
    const first = getComputed(counter, "custom", () => {
      computes += 1;
      return counter.count + 1;
    });
    expect(first).toBe(1);
    expect(computes).toBe(1);
    expect(getComputed(counter, "custom", () => 100)).toBe(1);
    expect(computes).toBe(1);
    counter.count = 2;
    expect(getComputed(counter, "custom", () => 100)).toBe(3);
    expect(computes).toBe(2);
    expect(counter.doubled).toBe(4);
    const store = storeFor(counter);
    store.dispose();
    expect(store.disposed).toBe(true);
    let fresh = 0;
    expect(
      getComputed(counter, "fresh", () => {
        fresh += 1;
        return fresh;
      }),
    ).toBe(1);
    expect(
      getComputed(counter, "fresh", () => {
        fresh += 1;
        return fresh;
      }),
    ).toBe(2);
    counter.count = 7;
    expect(counter.count).toBe(7);
  });

  it("keeps a computed alive when the reading effect reruns", () => {
    const counter = new Counter();
    const [tick, setTick] = createSignal(0);
    let observed = 0;
    createRenderEffect(() => {
      tick();
      observed = counter.doubled;
    });
    expect(observed).toBe(0);
    setTick(1);
    flushSync();
    counter.count = 3;
    flushSync();
    expect(observed).toBe(6);
    setTick(2);
    flushSync();
    counter.count = 4;
    flushSync();
    expect(observed).toBe(8);
  });

  it("runs registered cleanups in reverse order", () => {
    const store = createReactiveStore();
    const log: string[] = [];
    registerCleanup(store, () => log.push("first"));
    registerCleanup(store, () => log.push("second"));
    store.dispose();
    expect(log).toEqual(["second", "first"]);
    registerCleanup(store, () => log.push("late"));
    expect(log).toEqual(["second", "first", "late"]);
  });

  it("stops tracking effects after store disposal", () => {
    const counter = new Counter();
    let runs = 0;
    createRenderEffect(() => {
      counter.count;
      runs += 1;
    });
    expect(runs).toBe(1);
    storeFor(counter).dispose();
    counter.count = 9;
    flushSync();
    expect(runs).toBe(1);
    expect(counter.count).toBe(9);
  });
});
