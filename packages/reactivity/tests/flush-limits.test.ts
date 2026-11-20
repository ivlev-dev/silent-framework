import { describe, expect, it } from "vitest";
import {
  createEffect,
  createRenderEffect,
  createSignal,
  flushSync,
  setEffectErrorHandler,
} from "../src/index";

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

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

describe("лимит итераций flush", () => {
  it("изолирует runaway-эффект и продолжает обрабатывать остальную очередь", () => {
    const capture = captureErrors();
    try {
      const [value, setValue] = createSignal(0);
      const [independent, setIndependent] = createSignal(0);
      let runawayRuns = 0;
      createRenderEffect(() => {
        const current = value();
        runawayRuns += 1;
        setValue(current + 1);
      });
      let observed = -1;
      createRenderEffect(() => {
        observed = value();
      });
      let independentRuns = 0;
      createRenderEffect(() => {
        independent();
        independentRuns += 1;
      });

      expect(() => flushSync()).not.toThrow();
      expect(runawayRuns).toBeGreaterThan(1);
      expect(observed).toBe(value());
      expect(independentRuns).toBe(1);
      expect(capture.errors).toHaveLength(1);
      expect((capture.errors[0] as Error).message).toContain(
        "iteration limit",
      );

      // Сбойный узел снят с очереди и больше не запускается сам.
      const runsAfterLimit = runawayRuns;
      setValue(1000);
      expect(() => flushSync()).not.toThrow();
      expect(runawayRuns).toBe(runsAfterLimit);
      expect(capture.errors).toHaveLength(1);

      // Независимые эффекты после сбоя работают как обычно.
      setIndependent(1);
      expect(() => flushSync()).not.toThrow();
      expect(independentRuns).toBe(2);
      expect(capture.errors).toHaveLength(1);

      expect(() => flushSync()).not.toThrow();
      expect(independentRuns).toBe(2);
    } finally {
      capture.restore();
    }
  });

  it("не бросает ошибку из микротаски при runaway-эффекте", async () => {
    const capture = captureErrors();
    try {
      const [value, setValue] = createSignal(0);
      createEffect(() => {
        const current = value();
        setValue(current + 1);
      });

      await tick();
      await tick();

      expect(capture.errors.length).toBeGreaterThanOrEqual(1);
      expect(() => flushSync()).not.toThrow();

      // Повторный flush не крутит сбойный узел заново.
      const errorsAfterFirstFlush = capture.errors.length;
      expect(() => flushSync()).not.toThrow();
      expect(capture.errors).toHaveLength(errorsAfterFirstFlush);
    } finally {
      capture.restore();
    }
  });

  it("не срывает flushSync и последующие обновления после лимита", () => {
    const capture = captureErrors();
    try {
      const [value, setValue] = createSignal(0);
      let runs = 0;
      createEffect(() => {
        const current = value();
        runs += 1;
        if (current < 10000) {
          setValue(current + 1);
        }
      });

      expect(() => flushSync()).not.toThrow();
      expect(capture.errors).toHaveLength(1);
      const limitedRuns = runs;

      const [independent, setIndependent] = createSignal(0);
      let independentRuns = 0;
      createRenderEffect(() => {
        independent();
        independentRuns += 1;
      });

      setIndependent(1);
      expect(() => flushSync()).not.toThrow();
      expect(independentRuns).toBe(2);
      expect(runs).toBe(limitedRuns);
    } finally {
      capture.restore();
    }
  });
});
