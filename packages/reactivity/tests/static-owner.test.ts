import { describe, expect, it } from "vitest";
import {
  createEffect,
  createRenderEffect,
  createRoot,
  createSignal,
  flushSync,
  onCleanup,
} from "../src/index";

type EffectUnlessStatic = (fn: () => void) => (() => void) | null;

const UNLESS_STATIC_EFFECT = Symbol.for("silent.effectUnlessStatic");

const registry = createRoot as typeof createRoot &
  Record<symbol, EffectUnlessStatic | undefined>;

const readUnlessStatic = (): EffectUnlessStatic => {
  const candidate = registry[UNLESS_STATIC_EFFECT];
  if (candidate === undefined) {
    throw new Error("createEffectUnlessStatic не экспортируется");
  }
  return candidate;
};

const createEffectUnlessStatic = readUnlessStatic();

describe("createEffectUnlessStatic без собственных зависимостей", () => {
  it("возвращает dispose при наличии вложенного эффекта", () => {
    const [value, setValue] = createSignal(0);
    const seen: number[] = [];
    const dispose = createEffectUnlessStatic(() => {
      createRenderEffect(() => {
        seen.push(value());
      });
    });
    expect(typeof dispose).toBe("function");
    expect(seen).toEqual([0]);
    setValue(1);
    flushSync();
    expect(seen).toEqual([0, 1]);
    dispose?.();
    setValue(2);
    flushSync();
    expect(seen).toEqual([0, 1]);
  });

  it("очищает вложенный эффект ровно один раз", () => {
    const [value, setValue] = createSignal(0);
    let cleanups = 0;
    const dispose = createEffectUnlessStatic(() => {
      createRenderEffect(() => {
        value();
        onCleanup(() => {
          cleanups += 1;
        });
      });
    });
    expect(dispose).not.toBeNull();
    expect(cleanups).toBe(0);
    setValue(1);
    flushSync();
    expect(cleanups).toBe(1);
    dispose?.();
    expect(cleanups).toBe(2);
    dispose?.();
    expect(cleanups).toBe(2);
    setValue(2);
    flushSync();
    expect(cleanups).toBe(2);
  });

  it("возвращает null без вложенной работы", () => {
    let calls = 0;
    const dispose = createEffectUnlessStatic(() => {
      calls += 1;
    });
    expect(dispose).toBeNull();
    expect(calls).toBe(1);
  });

  it("не оставляет вложенные эффекты в пуле владельцев", () => {
    const [value, setValue] = createSignal(0);
    const seen: number[] = [];
    const dispose = createEffectUnlessStatic(() => {
      createRenderEffect(() => {
        seen.push(value());
      });
    });
    expect(dispose).not.toBeNull();
    const staticDispose = createEffectUnlessStatic(() => {
      seen.push(-1);
    });
    expect(staticDispose).toBeNull();
    setValue(1);
    flushSync();
    expect(seen).toEqual([0, -1, 1]);
    dispose?.();
    setValue(2);
    flushSync();
    expect(seen).toEqual([0, -1, 1]);
  });

  it("не запускает отложенный вложенный эффект после dispose", () => {
    let runs = 0;
    const dispose = createEffectUnlessStatic(() => {
      createEffect(() => {
        runs += 1;
      });
    });
    expect(dispose).not.toBeNull();
    dispose?.();
    flushSync();
    expect(runs).toBe(0);
  });

  it("удаляет строки вместе с владельцем в For-подобной структуре", () => {
    const [items, setItems] = createSignal([1, 2, 3]);
    const [multiplier, setMultiplier] = createSignal(1);
    const seen: number[] = [];
    const rowDisposers: (() => void)[] = [];
    let cleanups = 0;
    const disposeApp = createRoot((disposeRoot) => {
      createRenderEffect(() => {
        for (const rowDisposer of rowDisposers.splice(0)) {
          rowDisposer();
        }
        for (const item of items()) {
          const disposeRow = createEffectUnlessStatic(() => {
            createRoot((disposeRowRoot) => {
              createRenderEffect(() => {
                seen.push(item * multiplier());
                onCleanup(() => {
                  cleanups += 1;
                });
              });
              return disposeRowRoot;
            });
          });
          if (disposeRow !== null) {
            rowDisposers.push(disposeRow);
          }
        }
      });
      return disposeRoot;
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(cleanups).toBe(0);
    setMultiplier(10);
    flushSync();
    expect(seen).toEqual([1, 2, 3, 10, 20, 30]);
    expect(cleanups).toBe(3);
    setItems([4]);
    flushSync();
    expect(seen).toEqual([1, 2, 3, 10, 20, 30, 40]);
    expect(cleanups).toBe(6);
    disposeApp();
    expect(cleanups).toBe(7);
    const snapshot = [...seen];
    setMultiplier(100);
    flushSync();
    expect(seen).toEqual(snapshot);
  });
});
