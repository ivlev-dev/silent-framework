import { describe, expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
  getReactivityStats,
} from "../src/index.js";

describe("getReactivityStats", () => {
  it("считает созданные сигналы, мемо и эффекты", () => {
    const before = getReactivityStats();
    const [value, setValue] = createSignal(0);
    createMemo(() => value() * 2, { name: "double" });
    createEffect(() => {
      value();
    });
    flushSync();

    const after = getReactivityStats();
    expect(after.signalsCreated).toBe(before.signalsCreated + 1);
    expect(after.memosCreated).toBe(before.memosCreated + 1);
    expect(after.effectsCreated).toBe(before.effectsCreated + 1);
    expect(after.effectRuns).toBeGreaterThan(before.effectRuns);
    expect(after.activeEffects).toBe(before.activeEffects + 1);
    expect(after.activeMemos).toBe(before.activeMemos + 1);

    setValue(1);
    flushSync();
    expect(getReactivityStats().effectRuns).toBeGreaterThan(after.effectRuns);
  });

  it("уменьшает активные счётчики при dispose корня", () => {
    const before = getReactivityStats();
    const [value] = createSignal(0);
    const dispose = createRoot((disposeRoot) => {
      createMemo(() => value() + 1);
      createEffect(() => {
        value();
      });
      flushSync();
      return disposeRoot;
    });
    const active = getReactivityStats();
    expect(active.activeEffects).toBe(before.activeEffects + 1);
    expect(active.activeMemos).toBe(before.activeMemos + 1);
    expect(active.activeOwners).toBeGreaterThan(before.activeOwners);

    dispose();
    const disposed = getReactivityStats();
    expect(disposed.activeEffects).toBe(before.activeEffects);
    expect(disposed.activeMemos).toBe(before.activeMemos);
    expect(disposed.activeOwners).toBe(before.activeOwners);
  });

  it("показывает ожидающие эффекты и глубину batch", () => {
    const stats = getReactivityStats();
    expect(stats.pendingEffects).toBeGreaterThanOrEqual(0);
    expect(stats.batchDepth).toBe(0);
  });
});
