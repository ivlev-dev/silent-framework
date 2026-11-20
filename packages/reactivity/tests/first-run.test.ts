import { describe, expect, it } from "vitest";
import {
  batch,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  flushSync,
  untrack,
} from "../src/index";

describe("согласованность первого прогона", () => {
  it("перезапускает эффект, если прочитанный источник изменился в теле", () => {
    const [value, setValue] = createSignal(0);
    const runs: number[] = [];
    createRenderEffect(() => {
      const current = value();
      runs.push(current);
      if (runs.length === 1) {
        setValue(1);
      }
    });

    flushSync();
    expect(runs).toEqual([0, 1]);
  });

  it("ведёт себя одинаково на первом и последующих прогонах", () => {
    const [value, setValue] = createSignal(0);
    const runs: number[] = [];
    let budget = 1;
    createRenderEffect(() => {
      const current = value();
      runs.push(current);
      if (budget > 0) {
        budget -= 1;
        setValue(current + 1);
      }
    });

    flushSync();
    expect(runs).toEqual([0, 1]);

    budget = 1;
    setValue(10);
    flushSync();
    expect(runs).toEqual([0, 1, 10, 11]);
  });

  it("перезапускается после батча, в котором изменил свой источник", () => {
    const [value, setValue] = createSignal(0);
    const runs: number[] = [];
    createEffect(() => {
      const current = value();
      runs.push(current);
      if (runs.length === 1) {
        batch(() => {
          setValue(1);
        });
      }
    });

    flushSync();
    expect(runs).toEqual([0, 1]);
  });

  it("учитывает мемо, инвалидированный во время первого прогона", () => {
    const [value, setValue] = createSignal(0);
    const doubled = createMemo(() => value() * 2);
    const runs: number[] = [];
    createRenderEffect(() => {
      const current = doubled();
      runs.push(current);
      if (runs.length === 1) {
        setValue(1);
      }
    });

    flushSync();
    expect(runs).toEqual([0, 2]);
  });

  it("не добавляет зависимости, прочитанные внутри untrack", () => {
    const [value, setValue] = createSignal(0);
    const [other, setOther] = createSignal(0);
    let runs = 0;
    createRenderEffect(() => {
      value();
      untrack(() => other());
      runs += 1;
    });

    flushSync();
    expect(runs).toBe(1);

    setOther(1);
    flushSync();
    expect(runs).toBe(1);

    setValue(1);
    flushSync();
    expect(runs).toBe(2);
  });

  it("не перезапускается, если запись не изменила значение", () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    createRenderEffect(() => {
      value();
      runs += 1;
      setValue(0);
    });

    flushSync();
    expect(runs).toBe(1);
  });

  it("не перезапускает мемо и зависимые эффекты без реальных изменений", () => {
    const [value, setValue] = createSignal(0);
    let memoRuns = 0;
    const doubled = createMemo(() => {
      memoRuns += 1;
      return value() * 2;
    });
    let seen = 0;
    let effectRuns = 0;
    createRenderEffect(() => {
      seen = doubled();
      effectRuns += 1;
      if (effectRuns === 1) {
        setValue(0);
      }
    });

    flushSync();
    expect(seen).toBe(0);
    expect(effectRuns).toBe(1);
    expect(memoRuns).toBe(1);
  });
});
