import { describe, expect, it } from "vitest";
import {
  createEffect,
  createRoot,
  createSignal,
  flushSync,
  setEffectErrorHandler,
  type Owner,
} from "../src/index";

interface ErrorCapture {
  readonly errors: unknown[];
  readonly owners: (Owner | null)[];
  restore(): void;
}

const captureErrors = (): ErrorCapture => {
  const errors: unknown[] = [];
  const owners: (Owner | null)[] = [];
  const previous = setEffectErrorHandler((error, owner) => {
    errors.push(error);
    owners.push(owner);
  });
  return {
    errors,
    owners,
    restore() {
      setEffectErrorHandler(previous);
    },
  };
};

describe("owner в обработчике ошибок эффектов", () => {
  it("передаёт owner эффекта, созданного внутри createRoot", () => {
    const capture = captureErrors();
    try {
      const [value, setValue] = createSignal(0);
      let independentRuns = 0;
      const dispose = createRoot((disposeRoot) => {
        createEffect(() => {
          if (value() === 1) {
            throw new Error("boom");
          }
        });
        createEffect(() => {
          value();
          independentRuns += 1;
        });
        return disposeRoot;
      });

      flushSync();
      setValue(1);
      expect(() => flushSync()).not.toThrow();

      expect(capture.errors).toHaveLength(1);
      expect(capture.owners).toHaveLength(1);
      const owner = capture.owners[0];
      expect(owner).not.toBeNull();
      expect(owner?.disposed).toBe(false);
      expect(independentRuns).toBe(2);

      dispose();
      expect(owner?.disposed).toBe(true);
    } finally {
      capture.restore();
    }
  });

  it("передаёт null для эффекта без owner", () => {
    const capture = captureErrors();
    try {
      const [value, setValue] = createSignal(0);
      createEffect(() => {
        if (value() === 1) {
          throw new Error("root boom");
        }
      });

      flushSync();
      setValue(1);
      expect(() => flushSync()).not.toThrow();

      expect(capture.errors).toHaveLength(1);
      expect(capture.owners).toEqual([null]);
    } finally {
      capture.restore();
    }
  });

  it("сохраняет обратную совместимость обработчика с одной сигнатурой", () => {
    const errors: unknown[] = [];
    const previous = setEffectErrorHandler((error) => {
      errors.push(error);
    });
    try {
      const [value, setValue] = createSignal(0);
      createEffect(() => {
        if (value() === 1) {
          throw new Error("legacy");
        }
      });
      flushSync();
      setValue(1);
      expect(() => flushSync()).not.toThrow();
      expect(errors).toHaveLength(1);
    } finally {
      setEffectErrorHandler(previous);
    }
  });
});
