import { describe, expect, it } from "vitest";
import {
  createEffect,
  createRoot,
  createSignal,
  flushSync,
  getOwner,
  onCleanup,
  setEffectErrorHandler,
  type Owner,
} from "../src/index";

interface ErrorCapture {
  readonly errors: unknown[];
  restore(): void;
}

const captureErrors = (): ErrorCapture => {
  const errors: unknown[] = [];
  const previous = setEffectErrorHandler((error) => {
    errors.push(error);
  });
  return {
    errors,
    restore() {
      setEffectErrorHandler(previous);
    },
  };
};

const disposeCatching = (dispose: () => void): unknown => {
  try {
    dispose();
  } catch (error) {
    return error;
  }
  return null;
};

describe("исключения в cleanup не рвут каскад dispose", () => {
  it("выполняет остальные cleanup'ы и освобождает детей", () => {
    const log: string[] = [];
    let childOwner: Owner | null = null;

    const dispose = createRoot((disposeRoot) => {
      onCleanup(() => {
        log.push("first");
      });
      onCleanup(() => {
        log.push("second");
        throw new Error("cleanup boom");
      });
      createEffect(() => {
        childOwner = getOwner();
        onCleanup(() => {
          log.push("child");
        });
      });
      return disposeRoot;
    });

    flushSync();
    expect(log).toEqual([]);

    const caught = disposeCatching(dispose);

    expect((caught as Error).message).toBe("cleanup boom");
    // LIFO: сначала второй (бросающий), потом первый, затем дети.
    expect(log).toEqual(["second", "first", "child"]);
    expect((childOwner as Owner | null)?.disposed).toBe(true);

    // Повторный dispose идемпотентен и не повторяет ошибки.
    expect(() => dispose()).not.toThrow();
    expect(log).toEqual(["second", "first", "child"]);
  });

  it("собирает несколько ошибок cleanup в AggregateError, сохраняя исходные", () => {
    const first = new Error("first");
    const second = new Error("second");

    const dispose = createRoot((disposeRoot) => {
      onCleanup(() => {
        throw first;
      });
      onCleanup(() => {
        throw second;
      });
      return disposeRoot;
    });

    const caught = disposeCatching(dispose);

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregated = caught as AggregateError;
    expect(aggregated.errors).toHaveLength(2);
    expect(aggregated.errors).toContain(first);
    expect(aggregated.errors).toContain(second);
    expect(() => dispose()).not.toThrow();
  });

  it("rerun эффекта переживает бросающий cleanup и освобождает детей", () => {
    const capture = captureErrors();
    try {
      const [value, setValue] = createSignal(0);
      const log: string[] = [];
      let runs = 0;

      const dispose = createRoot((disposeRoot) => {
        createEffect(() => {
          runs += 1;
          value();
          onCleanup(() => {
            log.push("cleanup");
            throw new Error("rerun cleanup boom");
          });
          createEffect(() => {
            onCleanup(() => {
              log.push("child cleanup");
            });
          });
        });
        return disposeRoot;
      });

      flushSync();
      // Дочерний эффект создаётся во время прогона родителя.
      flushSync();
      expect(runs).toBe(1);

      setValue(1);
      expect(() => flushSync()).not.toThrow();
      // Новый дочерний эффект создан во время rerun — даём ему выполниться.
      flushSync();

      expect(runs).toBe(2);
      expect(log).toContain("child cleanup");
      expect(log.filter((entry) => entry === "cleanup")).toHaveLength(1);
      expect(capture.errors).toHaveLength(1);
      expect((capture.errors[0] as Error).message).toBe("rerun cleanup boom");

      // При полном dispose ошибка снова уходит вызывающему, а не в handler.
      const caught = disposeCatching(dispose);
      expect((caught as Error).message).toBe("rerun cleanup boom");
      expect(log.filter((entry) => entry === "child cleanup")).toHaveLength(2);
      expect(capture.errors).toHaveLength(1);
    } finally {
      capture.restore();
    }
  });
});
