import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  createRoot,
  createSignal,
  deepReactive,
  flushSync,
  getReactivityStats,
} from "../src/index.js";

const SAMPLES = 5;
const ITERATIONS = 10_000;

const median = (samples: readonly number[]): number => {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const measure = (fn: () => void): number => {
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return median(samples);
};

const report = (label: string, ms: number): void => {
  console.log(`[bench] ${label}: ${ms.toFixed(2)} ms (median ${SAMPLES})`);
};

describe("микро-бенчмарки реактивности", () => {
  it("10 000 прогонов эффекта с 10 зависимостями", () => {
    const ms = measure(() => {
      createRoot((dispose) => {
        const entries = Array.from({ length: 10 }, () => createSignal(0));
        const setters = entries.map((entry) => entry[1]);
        createRenderEffect(() => {
          for (const [read] of entries) {
            read();
          }
        });
        for (let index = 0; index < ITERATIONS; index += 1) {
          setters[index % setters.length]?.(index);
          flushSync();
        }
        dispose();
      });
    });

    report("reconcile 10 зависимостей × 10k", ms);
    expect(ms).toBeLessThan(10_000);
  });

  it("10 000-элементный массив: reverse", () => {
    const size = 10_000;
    const state = deepReactive(Array.from({ length: size }, (_, index) => index));
    const ms = measure(() => {
      for (let round = 0; round < 50; round += 1) {
        state.reverse();
      }
    });

    report("reverse 10k × 50", ms);
    expect(ms).toBeLessThan(10_000);
  });

  it("10 000-элементный массив: fill", () => {
    const size = 10_000;
    const state = deepReactive(Array.from({ length: size }, (_, index) => index));
    const ms = measure(() => {
      for (let round = 0; round < 50; round += 1) {
        state.fill(round);
      }
    });

    report("fill 10k × 50", ms);
    expect(ms).toBeLessThan(10_000);
  });

  it("чтение методов массива не создаёт сигналов", () => {
    const state = deepReactive(Array.from({ length: 10_000 }, (_, index) => index));
    const before = getReactivityStats().signalsCreated;

    createRoot((dispose) => {
      createRenderEffect(() => {
        void state.map;
        void state.filter;
        void state.toString;
        void state[Symbol.iterator];
      });
      dispose();
    });

    const created = getReactivityStats().signalsCreated - before;
    report("сигналы от чтения методов 10k-массива", created);
    expect(created).toBe(0);
  });
});
