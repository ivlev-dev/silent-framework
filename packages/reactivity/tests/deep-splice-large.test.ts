import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  deepReactive,
  flushSync,
} from "../src/index";

const CHUNK = 100000;

describe("splice с большими вставками", () => {
  it("вставляет 200k элементов двумя вызовами без RangeError", () => {
    const state = deepReactive<number[]>([]);
    const first = new Array<number>(CHUNK).fill(1);
    const second = new Array<number>(CHUNK).fill(2);

    expect(() => state.splice(0, 0, ...first)).not.toThrow();
    expect(state.length).toBe(CHUNK);
    expect(state[0]).toBe(1);
    expect(state[CHUNK - 1]).toBe(1);

    expect(() => state.splice(0, 0, ...second)).not.toThrow();
    expect(state.length).toBe(CHUNK * 2);
    expect(state[0]).toBe(2);
    expect(state[CHUNK - 1]).toBe(2);
    expect(state[CHUNK]).toBe(1);
    expect(state[199999]).toBe(1);
  });

  it("вставляет большой набор в середину и возвращает удалённые по порядку", () => {
    const state = deepReactive<number[]>([1, 2, 3, 4]);
    const inserted = new Array<number>(CHUNK).fill(7);

    const removed = state.splice(1, 2, ...inserted);

    expect(removed).toEqual([2, 3]);
    expect(state.length).toBe(2 + CHUNK);
    expect(state[0]).toBe(1);
    expect(state[1]).toBe(7);
    expect(state[CHUNK]).toBe(7);
    expect(state[CHUNK + 1]).toBe(4);
  });

  it("уведомляет только затронутые индексы, length и ключи", () => {
    const state = deepReactive<number[]>([1, 2, 3, 4]);
    let zeroRuns = 0;
    let lengthRuns = 0;
    let zeroValue = -1;
    createRenderEffect(() => {
      zeroValue = state[0] ?? -1;
      zeroRuns += 1;
    });
    createRenderEffect(() => {
      state.length;
      lengthRuns += 1;
    });

    state.splice(1, 2, ...new Array<number>(CHUNK).fill(7));
    flushSync();

    expect(zeroValue).toBe(1);
    expect(zeroRuns).toBe(1);
    expect(lengthRuns).toBe(2);
  });

  it("соблюдает спецификацию индексов, дырок и non-configurable", () => {
    const ordered = deepReactive<number[]>([1, 2, 3, 4, 5]);
    expect(ordered.splice(1, 3, 9, 8)).toEqual([2, 3, 4]);
    expect([...ordered]).toEqual([1, 9, 8, 5]);

    // @ts-expect-error splice() без аргументов допустим по спецификации ECMAScript,
    // но типы lib требуют обязательный start.
    expect(ordered.splice()).toEqual([]);
    expect([...ordered]).toEqual([1, 9, 8, 5]);

    expect(ordered.splice(2)).toEqual([8, 5]);
    expect([...ordered]).toEqual([1, 9]);

    const indices = deepReactive<number[]>([1, 2, 3, 4]);
    expect(indices.splice(-2, 1)).toEqual([3]);
    expect([indices[0], indices[1], indices[2]]).toEqual([1, 2, 4]);
    indices.splice(100, 0, 5);
    expect(indices.length).toBe(4);
    expect(indices[3]).toBe(5);
    indices.splice(-100, 1);
    expect(indices.length).toBe(3);
    expect([indices[0], indices[1], indices[2]]).toEqual([2, 4, 5]);

    const sparse = deepReactive<number[]>([]);
    sparse.length = 3;
    sparse[1] = 1;
    const removed = sparse.splice(0, 2, 9);
    expect(removed.length).toBe(2);
    expect(0 in removed).toBe(false);
    expect(removed[1]).toBe(1);
    expect(sparse.length).toBe(2);
    expect(sparse[0]).toBe(9);
    expect(1 in sparse).toBe(false);

    const guarded = deepReactive<number[]>([1, 2, 3]);
    Object.defineProperty(guarded, "1", {
      configurable: false,
      writable: true,
    });
    expect(guarded.splice(0, 1)).toEqual([1]);
    expect([guarded[0], guarded[1]]).toEqual([2, 3]);
    expect(guarded.length).toBe(2);

    const locked = deepReactive<number[]>([1, 2, 3]);
    Object.defineProperty(locked, "2", { configurable: false });
    expect(() => locked.splice(2, 1)).toThrow(TypeError);
    expect(() => ordered.splice(1n as unknown as number, 1)).toThrow(TypeError);
  });
});
