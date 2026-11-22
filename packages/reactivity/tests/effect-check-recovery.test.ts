import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
  setEffectErrorHandler,
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

describe("выход из CHECK после исключения в depsChanged", () => {
  it("child-мемо бросает при проверке, sibling-мемо снова будит эффект", () => {
    const capture = captureErrors();
    try {
      const [shouldThrow, setShouldThrow] = createSignal(false);
      const [source, setSource] = createSignal(0);
      const [sibling, setSibling] = createSignal(0);
      let runs = 0;

      const boom = createMemo(
        (): number => {
          const current = source();
          if (shouldThrow()) {
            throw new Error("boom");
          }
          return current;
        },
        { name: "boom" },
      );
      const doubled = createMemo(() => sibling() * 2, { name: "doubled" });

      const dispose = createRoot((disposeRoot) => {
        createEffect(() => {
          runs += 1;
          doubled();
          boom();
        });
        return disposeRoot;
      });

      // Первый прогон успешен и подписывает эффект на обе мемо.
      flushSync();
      expect(runs).toBe(1);

      // Эффект уходит в CHECK; при проверке зависимостей boom
      // пересчитывается и бросает.
      setShouldThrow(true);
      setSource(1);
      flushSync();
      expect(runs).toBe(1);
      expect(capture.errors).toHaveLength(1);

      // До фикса эффект оставался в CHECK, и markCheck игнорировал sibling.
      setSibling(1);
      flushSync();
      expect(runs).toBe(2);
      expect(capture.errors).toHaveLength(2);

      // Пустой flush не повторяет неудачную попытку.
      flushSync();
      expect(runs).toBe(2);
      expect(capture.errors).toHaveLength(2);

      // Смена зависимости упавшей мемо сбрасывает failed и будит цепочку.
      setShouldThrow(false);
      flushSync();
      expect(runs).toBe(3);
      expect(capture.errors).toHaveLength(2);

      setSibling(2);
      flushSync();
      expect(runs).toBe(4);
      expect(capture.errors).toHaveLength(2);

      dispose();
    } finally {
      capture.restore();
    }
  });

  it("прямой сигнал-sibling снова будит эффект", () => {
    const capture = captureErrors();
    try {
      const [shouldThrow, setShouldThrow] = createSignal(false);
      const [source, setSource] = createSignal(0);
      const [sibling, setSibling] = createSignal(0);
      let runs = 0;

      const boom = createMemo(
        (): number => {
          const current = source();
          if (shouldThrow()) {
            throw new Error("boom");
          }
          return current;
        },
        { name: "boom" },
      );

      const dispose = createRoot((disposeRoot) => {
        createEffect(() => {
          runs += 1;
          sibling();
          boom();
        });
        return disposeRoot;
      });

      flushSync();
      expect(runs).toBe(1);

      setShouldThrow(true);
      setSource(1);
      flushSync();
      expect(runs).toBe(1);
      expect(capture.errors).toHaveLength(1);

      setSibling(1);
      flushSync();
      expect(runs).toBe(2);
      expect(capture.errors).toHaveLength(2);

      // Ровно одна доставка за попытку: повторный flush ничего не добавляет.
      flushSync();
      expect(runs).toBe(2);
      expect(capture.errors).toHaveLength(2);

      setShouldThrow(false);
      flushSync();
      expect(runs).toBe(3);
      expect(capture.errors).toHaveLength(2);

      setSibling(2);
      flushSync();
      expect(runs).toBe(4);
      expect(capture.errors).toHaveLength(2);

      dispose();
    } finally {
      capture.restore();
    }
  });

  it("CHECK-мемо, упавшая при проверке, восстанавливается по цепочке", () => {
    const capture = captureErrors();
    try {
      const [shouldThrow, setShouldThrow] = createSignal(false);
      const [source, setSource] = createSignal(0);
      const [siblingSource, setSiblingSource] = createSignal(0);
      let runs = 0;

      const sibling = createMemo(() => siblingSource() * 2, {
        name: "sibling",
      });
      const inner = createMemo(
        (): number => {
          const current = source();
          if (shouldThrow()) {
            throw new Error("inner");
          }
          return current;
        },
        { name: "inner" },
      );
      const outer = createMemo(() => inner() + 1, { name: "outer" });

      const dispose = createRoot((disposeRoot) => {
        createEffect(() => {
          runs += 1;
          sibling();
          outer();
        });
        return disposeRoot;
      });

      flushSync();
      expect(runs).toBe(1);

      // outer и эффект уходят в CHECK, проверка inner падает на пересчёте.
      setShouldThrow(true);
      setSource(1);
      flushSync();
      expect(runs).toBe(1);
      expect(capture.errors).toHaveLength(1);

      // Sibling-мемо должно снова разбудить эффект, несмотря на CHECK-сбой.
      setSiblingSource(1);
      flushSync();
      expect(runs).toBe(2);
      expect(capture.errors).toHaveLength(2);

      flushSync();
      expect(runs).toBe(2);
      expect(capture.errors).toHaveLength(2);

      // Восстановление после смены упавшей зависимости.
      setShouldThrow(false);
      flushSync();
      expect(runs).toBe(3);
      expect(capture.errors).toHaveLength(2);

      dispose();
    } finally {
      capture.restore();
    }
  });
});
