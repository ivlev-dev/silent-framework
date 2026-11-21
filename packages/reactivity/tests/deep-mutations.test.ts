import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  deepReactive,
  flushSync,
  getReactivityStats,
} from "../src/index.js";

describe("Уведомления deep-мутаторов только по изменённым индексам", () => {
  it("reverse не перезапускает эффект неизменившегося среднего индекса", () => {
    const array = deepReactive([1, 2, 3, 4, 5]);
    const runs = [0, 0, 0, 0, 0];
    for (let index = 0; index < 5; index += 1) {
      createRenderEffect(() => {
        array[index];
        runs[index] = (runs[index] ?? 0) + 1;
      });
    }

    array.reverse();
    flushSync();

    expect(array).toEqual([5, 4, 3, 2, 1]);
    expect(runs).toEqual([2, 2, 1, 2, 2]);
  });

  it("fill уведомляет только индексы из указанного диапазона", () => {
    const array = deepReactive([1, 2, 3, 4, 5]);
    const runs = [0, 0, 0, 0, 0];
    for (let index = 0; index < 5; index += 1) {
      createRenderEffect(() => {
        array[index];
        runs[index] = (runs[index] ?? 0) + 1;
      });
    }

    array.fill(9, 1, 3);
    flushSync();

    expect(array).toEqual([1, 9, 9, 4, 5]);
    expect(runs).toEqual([1, 2, 2, 1, 1]);
  });

  it("copyWithin уведомляет только целевую область", () => {
    const array = deepReactive([1, 2, 3, 4, 5]);
    const runs = [0, 0, 0, 0, 0];
    for (let index = 0; index < 5; index += 1) {
      createRenderEffect(() => {
        array[index];
        runs[index] = (runs[index] ?? 0) + 1;
      });
    }

    array.copyWithin(1, 0, 3);
    flushSync();

    expect(array).toEqual([1, 1, 2, 3, 5]);
    expect(runs).toEqual([1, 2, 2, 2, 1]);
  });

  it("copyWithin совпадает с нативным на отрицательных и выходящих индексах", () => {
    const cases: Array<{ state: number[]; args: [number, number?, number?] }> = [
      { state: [1, 2, 3, 4, 5], args: [-2, 0] },
      { state: [1, 2, 3, 4, 5], args: [0, -2] },
      { state: [1, 2, 3], args: [1, 0, 100] },
      { state: [1, 2, 3], args: [-100, 100, -1] },
    ];
    for (const { state, args } of cases) {
      const expected = [...state];
      expected.copyWithin(...args);
      const reactive = deepReactive([...state]);
      reactive.copyWithin(...args);
      expect([...reactive]).toEqual(expected);
    }
  });

  it("fill совпадает с нативным на отрицательных и выходящих индексах", () => {
    const cases: Array<{ state: number[]; args: [number, number?, number?] }> = [
      { state: [1, 2, 3], args: [7] },
      { state: [1, 2, 3, 4], args: [7, -2] },
      { state: [1, 2, 3, 4], args: [7, 1, -1] },
      { state: [1, 2, 3], args: [7, 100] },
    ];
    for (const { state, args } of cases) {
      const expected = [...state];
      expected.fill(...args);
      const reactive = deepReactive([...state]);
      reactive.fill(...args);
      expect([...reactive]).toEqual(expected);
    }
  });

  it("copyWithin сохраняет дырки разреженного массива как нативный", () => {
    const state = deepReactive<number[]>([]);
    state.length = 4;
    state[0] = 1;
    state[2] = 3;
    const expected: number[] = [];
    expected.length = 4;
    expected[0] = 1;
    expected[2] = 3;

    state.copyWithin(1, 0, 3);
    expected.copyWithin(1, 0, 3);

    expect(Object.keys(state)).toEqual(Object.keys(expected));
    expect(state.length).toBe(expected.length);
  });

  it("fill по разреженному массиву создаёт ключи", () => {
    const state = deepReactive<number[]>([]);
    state.length = 3;
    state.fill(5);
    expect(Object.keys(state)).toEqual(["0", "1", "2"]);
    expect(state).toEqual([5, 5, 5]);
  });
});

describe("Методы прототипа не создают сигналы", () => {
  it("10k-массив: чтение map/filter/toString не добавляет полей, индексы реактивны", () => {
    const array = deepReactive(Array.from({ length: 10_000 }, (_, index) => index));
    const before = getReactivityStats().signalsCreated;

    let methodReads = 0;
    createRenderEffect(() => {
      void array.map;
      void array.filter;
      void array.toString;
      void array[Symbol.iterator];
      methodReads += 1;
    });

    expect(getReactivityStats().signalsCreated).toBe(before);
    expect(methodReads).toBe(1);

    let observed = -1;
    createRenderEffect(() => {
      observed = array[0] as number;
    });
    array[0] = 42;
    flushSync();
    expect(observed).toBe(42);
  });
});
