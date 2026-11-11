import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createSignal,
  deepReactive,
  flushSync,
} from "../src/index";

describe("dependency reconciliation", () => {
  it("keeps dynamic dependencies correct across many reruns", () => {
    const [useFirst, setUseFirst] = createSignal(true);
    const [first, setFirst] = createSignal(0);
    const [second, setSecond] = createSignal(0);
    let runs = 0;
    let seen = 0;
    createRenderEffect(() => {
      seen = useFirst() ? first() : second();
      runs += 1;
    });
    expect(runs).toBe(1);
    for (let index = 1; index <= 5; index += 1) {
      setFirst(index);
      flushSync();
    }
    expect(seen).toBe(5);
    expect(runs).toBe(6);
    setUseFirst(false);
    flushSync();
    const idleRuns = runs;
    for (let index = 10; index < 15; index += 1) {
      setFirst(index);
      flushSync();
    }
    expect(runs).toBe(idleRuns);
    for (let index = 1; index <= 3; index += 1) {
      setSecond(index);
      flushSync();
    }
    expect(seen).toBe(3);
    expect(runs).toBe(idleRuns + 3);
  });

  it("keeps memo chains consistent across many updates", () => {
    const [base, setBase] = createSignal(0);
    const doubled = createMemo(() => base() * 2);
    const plusOne = createMemo(() => doubled() + 1);
    let seen = 0;
    let runs = 0;
    createRenderEffect(() => {
      seen = plusOne();
      runs += 1;
    });
    expect(seen).toBe(1);
    for (let index = 1; index <= 10; index += 1) {
      setBase(index);
      flushSync();
    }
    expect(seen).toBe(21);
    expect(runs).toBe(11);
  });

  it("processes effects queued during a flush", () => {
    const [trigger, setTrigger] = createSignal(0);
    const [value, setValue] = createSignal(0);
    let observedRuns = 0;
    createRenderEffect(() => {
      value();
      observedRuns += 1;
    });
    createRenderEffect(() => {
      if (trigger() === 1) {
        setValue(1);
      }
    });
    expect(observedRuns).toBe(1);
    setTrigger(1);
    flushSync();
    expect(observedRuns).toBe(2);
  });
});

describe("deep proxy fast paths", () => {
  it("reads array indices and methods", () => {
    const array = deepReactive([1, 2]);
    expect(array[0]).toBe(1);
    const push = array.push;
    expect(push.call(array, 3)).toBe(3);
    expect(array[2]).toBe(3);
    expect(array.length).toBe(3);
  });

  it("supports inherited accessors", () => {
    const proto = {
      get doubled(): number {
        return this.value * 2;
      },
      set doubled(next: number) {
        this.value = next / 2;
      },
    };
    type Model = { value: number; doubled: number };
    const raw = Object.create(proto) as Model;
    raw.value = 2;
    const state = deepReactive(raw);
    expect(state.doubled).toBe(4);
    state.doubled = 10;
    expect(state.value).toBe(5);
  });

  it("tracks an inherited getter dependency", () => {
    const proto = {
      get doubled(): number {
        return this.value * 2;
      },
    };
    type Model = { value: number; readonly doubled: number };
    const raw = Object.create(proto) as Model;
    raw.value = 2;
    const state = deepReactive(raw);
    let seen = 0;
    let runs = 0;
    createRenderEffect(() => {
      seen = state.doubled;
      runs += 1;
    });
    expect([seen, runs]).toEqual([4, 1]);
    state.value = 3;
    flushSync();
    expect([seen, runs]).toEqual([6, 2]);
  });

  it("keeps non-writable non-configurable properties intact", () => {
    const raw: { fixed: number } = { fixed: 1 };
    Object.defineProperty(raw, "fixed", {
      value: 1,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    const state = deepReactive(raw);
    expect(state.fixed).toBe(1);
    expect(() => {
      state.fixed = 2;
    }).toThrow(TypeError);
    expect(state.fixed).toBe(1);
  });
});
