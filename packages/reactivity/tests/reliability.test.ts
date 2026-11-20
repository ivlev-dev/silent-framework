import { describe, expect, it, vi } from "vitest";
import {
  batch,
  CircularComputationError,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  flushSync,
  on,
  setEffectErrorHandler,
} from "../src/index";

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

const isolateHandler = (): (() => void) => {
  const previous = setEffectErrorHandler(null);
  return () => {
    setEffectErrorHandler(previous);
  };
};

describe("effect error isolation", () => {
  it("routes an unhandled effect error to console.error and keeps the flush alive", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const [value, setValue] = createSignal(0);
      let secondRuns = 0;
      createEffect(() => {
        if (value() === 1) {
          throw new Error("first");
        }
      });
      createEffect(() => {
        value();
        secondRuns += 1;
      });

      expect(() => flushSync()).not.toThrow();
      expect(secondRuns).toBe(1);

      setValue(1);
      expect(() => flushSync()).not.toThrow();
      expect(secondRuns).toBe(2);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    } finally {
      spy.mockRestore();
    }
  });

  it("runs the remaining effects and every next flush after a failure", () => {
    const restore = isolateHandler();
    try {
      const [value, setValue] = createSignal(0);
      const errors: unknown[] = [];
      setEffectErrorHandler((error) => {
        errors.push(error);
      });
      let firstRuns = 0;
      let secondRuns = 0;
      createEffect(() => {
        const current = value();
        firstRuns += 1;
        if (current === 1) {
          throw new Error("boom");
        }
      });
      createEffect(() => {
        value();
        secondRuns += 1;
      });

      flushSync();
      expect(secondRuns).toBe(1);

      setValue(1);
      flushSync();
      expect(firstRuns).toBe(2);
      expect(secondRuns).toBe(2);
      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toBe("boom");

      setValue(2);
      flushSync();
      expect(firstRuns).toBe(3);
      expect(secondRuns).toBe(3);
      expect(errors).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("isolates a throwing initial effect", () => {
    const restore = isolateHandler();
    try {
      const errors: unknown[] = [];
      setEffectErrorHandler((error) => {
        errors.push(error);
      });
      let runs = 0;
      createEffect(() => {
        throw new Error("initial");
      });
      createEffect(() => {
        runs += 1;
      });

      expect(() => flushSync()).not.toThrow();
      expect(runs).toBe(1);
      expect(errors).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("isolates a throwing render effect update", () => {
    const restore = isolateHandler();
    try {
      const [value, setValue] = createSignal(0);
      const errors: unknown[] = [];
      setEffectErrorHandler((error) => {
        errors.push(error);
      });
      let secondRuns = 0;
      createRenderEffect(() => {
        if (value() === 1) {
          throw new Error("render");
        }
      });
      createRenderEffect(() => {
        value();
        secondRuns += 1;
      });

      setValue(1);
      expect(() => flushSync()).not.toThrow();
      expect(secondRuns).toBe(2);
      expect(errors).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("does not lose the remaining effects when the handler is disabled", () => {
    const restore = isolateHandler();
    try {
      const [value, setValue] = createSignal(0);
      let secondRuns = 0;
      createEffect(() => {
        if (value() === 1) {
          throw new Error("ignored");
        }
      });
      createEffect(() => {
        value();
        secondRuns += 1;
      });

      flushSync();
      setValue(1);
      expect(() => flushSync()).not.toThrow();
      expect(secondRuns).toBe(2);
    } finally {
      restore();
    }
  });

  it("survives a throwing handler", () => {
    const restore = isolateHandler();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const [value, setValue] = createSignal(0);
      setEffectErrorHandler(() => {
        throw new Error("handler");
      });
      let secondRuns = 0;
      createEffect(() => {
        if (value() === 1) {
          throw new Error("effect");
        }
      });
      createEffect(() => {
        value();
        secondRuns += 1;
      });

      flushSync();
      setValue(1);
      expect(() => flushSync()).not.toThrow();
      expect(secondRuns).toBe(2);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      restore();
    }
  });

  it("returns the previous handler when replacing it", () => {
    const restore = isolateHandler();
    try {
      const first = (): void => {};
      const second = (): void => {};
      setEffectErrorHandler(first);
      const replaced = setEffectErrorHandler(second);
      expect(replaced).toBe(first);
      expect(setEffectErrorHandler(first)).toBe(second);
      expect(setEffectErrorHandler(null)).toBe(first);
    } finally {
      restore();
    }
  });
});

describe("memo error recovery", () => {
  it("recomputes after a throw instead of caching the failure", () => {
    const [source] = createSignal(1);
    let shouldThrow = true;
    let computes = 0;
    const doubled = createMemo(
      (): number => {
        computes += 1;
        if (shouldThrow) {
          throw new Error("memo");
        }
        return source() * 2;
      },
      { name: "doubled" },
    );

    expect(() => doubled()).toThrow("memo");
    expect(computes).toBe(1);

    shouldThrow = false;
    expect(doubled()).toBe(2);
    expect(computes).toBe(2);
    expect(doubled()).toBe(2);
    expect(computes).toBe(2);
  });

  it("retries an observer after a failed memo when its dependency changes", () => {
    const restore = isolateHandler();
    try {
      const [source, setSource] = createSignal(0);
      const errors: unknown[] = [];
      setEffectErrorHandler((error) => {
        errors.push(error);
      });
      let shouldThrow = true;
      let runs = 0;
      let seen = -1;
      const guarded = createMemo(
        (): number => {
          const current = source();
          if (shouldThrow) {
            throw new Error("memo");
          }
          return current * 2;
        },
        { name: "guarded" },
      );
      createEffect(() => {
        seen = guarded();
        runs += 1;
      });

      flushSync();
      expect(runs).toBe(0);
      expect(seen).toBe(-1);
      expect(errors).toHaveLength(1);

      shouldThrow = false;
      setSource(1);
      flushSync();
      expect(runs).toBe(1);
      expect(seen).toBe(2);
      expect(errors).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe("circular memo computation", () => {
  it("reports a self-referencing memo with its name", () => {
    const self = createMemo((): number => self() + 1, { name: "self" });
    let error: unknown = null;
    try {
      self();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CircularComputationError);
    const circular = error as CircularComputationError;
    expect(circular.name).toBe("CircularComputationError");
    expect(circular.path).toEqual(["self", "self"]);
    expect(circular.message).toContain("self -> self");
  });

  it("reports a mutual memo cycle with the active path", () => {
    const first = createMemo((): number => second() + 1, { name: "first" });
    const second = createMemo((): number => first() + 1, { name: "second" });

    expect(() => first()).toThrow(CircularComputationError);
    try {
      first();
    } catch (caught) {
      expect((caught as CircularComputationError).path).toEqual([
        "first",
        "second",
        "first",
      ]);
    }
  });

  it("keeps healthy memo chains working", () => {
    const [value, setValue] = createSignal(1);
    const doubled = createMemo(() => value() * 2, { name: "doubled" });
    const plusOne = createMemo(() => doubled() + 1, { name: "plusOne" });
    expect(plusOne()).toBe(3);
    setValue(2);
    flushSync();
    expect(plusOne()).toBe(5);
  });
});

describe("batch during initial effects", () => {
  it("finishes initial effects before updates queued by a nested batch", () => {
    const [value, setValue] = createSignal(0);
    const log: string[] = [];
    createRenderEffect(() => {
      value();
      log.push(`render:${value()}`);
    });
    createEffect(() => {
      value();
      log.push("initial-a");
      batch(() => {
        setValue(1);
      });
    });
    createEffect(() => {
      value();
      log.push(`initial-b:${value()}`);
    });

    flushSync();
    // Первый прогон эффекта записал в сигнал, который сам же прочитал,
    // поэтому по завершении начальных эффектов он перезапускается —
    // так же, как это происходит на последующих прогонах.
    expect(log).toEqual([
      "render:0",
      "initial-a",
      "initial-b:1",
      "render:1",
      "initial-a",
    ]);
  });

  it("does not force a pending initial effect from batch", () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    createEffect(() => {
      value();
      runs += 1;
    });
    batch(() => {
      setValue(1);
    });
    expect(runs).toBe(0);
    flushSync();
    expect(runs).toBe(1);
  });
});

describe("on prev values", () => {
  it("passes undefined as both value and prev on the initial run", async () => {
    const [value, setValue] = createSignal<number | undefined>(undefined);
    const calls: [number | undefined, number | undefined][] = [];
    on(value, (next, prev) => {
      calls.push([next, prev]);
    });
    await tick();
    expect(calls).toEqual([[undefined, undefined]]);

    setValue(2);
    flushSync();
    expect(calls).toEqual([
      [undefined, undefined],
      [2, undefined],
    ]);
  });

  it("keeps the deferred initial value as prev", async () => {
    const [value, setValue] = createSignal<number | undefined>(undefined);
    const calls: [number | undefined, number | undefined][] = [];
    on(
      value,
      (next, prev) => {
        calls.push([next, prev]);
      },
      { defer: true },
    );
    await tick();
    expect(calls).toEqual([]);

    setValue(3);
    flushSync();
    expect(calls).toEqual([[3, undefined]]);
  });
});

describe("dependency deduplication", () => {
  it("handles repeated and nested reads of the same signal", () => {
    const [value, setValue] = createSignal(0);
    let outerRuns = 0;
    createRenderEffect(() => {
      value();
      value();
      createRenderEffect(() => {
        value();
      });
      value();
      outerRuns += 1;
    });
    expect(outerRuns).toBe(1);

    setValue(1);
    flushSync();
    expect(outerRuns).toBe(2);

    setValue(2);
    flushSync();
    expect(outerRuns).toBe(3);
  });
});
