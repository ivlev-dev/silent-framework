import { describe, expect, it } from "vitest";
import { Container, createToken } from "../src/index.js";

const SAMPLES = 5;

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

describe("микро-бенчмарки DI", () => {
  it("bindValue: 100 000 resolve", () => {
    const root = new Container("bench-value");
    const token = createToken<{ id: number }>("value");
    root.bindValue(token, { id: 1 });

    const ms = measure(() => {
      for (let index = 0; index < 100_000; index += 1) {
        void root.resolve(token);
      }
    });

    report("bindValue resolve × 100k", ms);
    expect(ms).toBeLessThan(10_000);
  });

  it("transient: 20 000 resolve с чтением методов контейнера", () => {
    const root = new Container("bench-transient");
    const token = createToken<string>("transient");
    root.bindFactory(token, (container) => `${container.name}:${container.has(token)}`).inTransientScope();

    const ms = measure(() => {
      for (let index = 0; index < 20_000; index += 1) {
        void root.resolve(token);
      }
    });

    report("transient resolve × 20k", ms);
    expect(ms).toBeLessThan(10_000);
  });

  it("clearCache(token): 10 000 rebind в дереве из 200 скоупов", () => {
    const root = new Container("bench-scopes");
    for (let index = 0; index < 200; index += 1) {
      root.createScope(`scope-${index}`);
    }
    const token = createToken<string>("rebind");
    root.bind(token, () => "first");
    void root.resolve(token);

    let counter = 0;
    const ms = measure(() => {
      for (let index = 0; index < 10_000; index += 1) {
        counter += 1;
        root.bind(token, () => `value-${counter}`);
      }
    });

    report("rebind + clearCache × 10k, 200 скоупов", ms);
    expect(ms).toBeLessThan(10_000);
  });
});
