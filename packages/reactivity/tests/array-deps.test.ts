import { describe, expect, it } from "vitest";
import { createEffect, createRoot, createSignal, flushSync } from "../src/index";

const tick = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(resolve));

describe("array dependency tracking", () => {
  it("reruns on either signal and unsubscribes on dispose", async () => {
    const [first, setFirst] = createSignal(0);
    const [second, setSecond] = createSignal(0);
    let runs = 0;
    let total = 0;
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        total = first() + second();
        runs += 1;
      });
      return disposeRoot;
    });
    await tick();
    expect(runs).toBe(1);
    expect(total).toBe(0);

    setFirst(1);
    flushSync();
    expect(runs).toBe(2);
    expect(total).toBe(1);

    setSecond(2);
    flushSync();
    expect(runs).toBe(3);
    expect(total).toBe(3);

    dispose();
    setFirst(10);
    setSecond(20);
    flushSync();
    expect(runs).toBe(3);
  });

  it("does not rerun twice when the same signal is read twice", async () => {
    const [value, setValue] = createSignal(1);
    let runs = 0;
    let seen = 0;
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        seen = value() + value();
        runs += 1;
      });
      return disposeRoot;
    });
    await tick();
    expect(runs).toBe(1);
    expect(seen).toBe(2);

    setValue(2);
    flushSync();
    expect(runs).toBe(2);
    expect(seen).toBe(4);

    setValue(3);
    flushSync();
    expect(runs).toBe(3);
    expect(seen).toBe(6);

    dispose();
    setValue(4);
    flushSync();
    expect(runs).toBe(3);
  });
});
