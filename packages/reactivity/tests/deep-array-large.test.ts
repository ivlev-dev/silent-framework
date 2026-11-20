import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  deepReactive,
  flushSync,
} from "../src/index";

const CHUNK = 100000;

describe("большие наборы push/unshift", () => {
  it("push 200k элементов не переполняет стек", () => {
    const state = deepReactive<number[]>([]);
    const first = new Array<number>(CHUNK).fill(1);
    const second = new Array<number>(CHUNK).fill(2);

    expect(() => state.push(...first)).not.toThrow();
    expect(state.length).toBe(CHUNK);
    expect(() => state.push(...second)).not.toThrow();
    expect(state.length).toBe(200000);
    expect(state[0]).toBe(1);
    expect(state[CHUNK - 1]).toBe(1);
    expect(state[CHUNK]).toBe(2);
    expect(state[199999]).toBe(2);
  });

  it("unshift 200k элементов не переполняет стек", () => {
    const state = deepReactive<number[]>([]);
    const first = new Array<number>(CHUNK).fill(3);
    const second = new Array<number>(CHUNK).fill(4);

    expect(() => state.unshift(...first)).not.toThrow();
    expect(state.length).toBe(CHUNK);
    expect(() => state.unshift(...second)).not.toThrow();
    expect(state.length).toBe(200000);
    expect(state[0]).toBe(4);
    expect(state[CHUNK - 1]).toBe(4);
    expect(state[CHUNK]).toBe(3);
    expect(state[199999]).toBe(3);
  });

  it("разреженные массивы сохраняют дырки при unshift", () => {
    const state = deepReactive<number[]>([]);
    state.length = 2;
    state[1] = 1;

    state.unshift(0);
    expect(state.length).toBe(3);
    expect(Object.keys(state)).toEqual(["0", "2"]);
    expect(1 in state).toBe(false);
  });

  it("не падает на non-configurable элементах", () => {
    const state = deepReactive<number[]>([1, 2]);
    Object.defineProperty(state, "1", {
      configurable: false,
      writable: true,
    });

    expect(() => state.unshift(0)).not.toThrow();
    expect(state.length).toBe(3);
    expect([state[0], state[1], state[2]]).toEqual([0, 1, 2]);
  });

  it("уведомляет только затронутые индексы и length", () => {
    const state = deepReactive<number[]>([0]);
    let indexRuns = 0;
    let lengthRuns = 0;
    createRenderEffect(() => {
      state[0];
      indexRuns += 1;
    });
    createRenderEffect(() => {
      state.length;
      lengthRuns += 1;
    });

    state.push(1);
    flushSync();
    expect(indexRuns).toBe(1);
    expect(lengthRuns).toBe(2);

    state.unshift(-1);
    flushSync();
    expect(indexRuns).toBe(2);
    expect(lengthRuns).toBe(3);
  });
});
