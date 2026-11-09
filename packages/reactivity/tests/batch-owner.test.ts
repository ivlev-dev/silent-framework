import { describe, expect, it } from "vitest";
import {
  batch,
  createEffect,
  createRenderEffect,
  createRoot,
  createSignal,
  flushSync,
  getOwner,
  onCleanup,
  runWithOwner,
  type Owner,
} from "../src/index";

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe("batch", () => {
  it("defers a flush until the outermost batch is finished", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    let runs = 0;
    createRenderEffect(() => {
      a();
      b();
      runs += 1;
    });
    expect(runs).toBe(1);
    batch(() => {
      setA(1);
      setB(1);
      expect(runs).toBe(1);
    });
    expect(runs).toBe(2);
  });

  it("handles nested batches", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    let runs = 0;
    createRenderEffect(() => {
      a();
      b();
      runs += 1;
    });
    expect(runs).toBe(1);
    batch(() => {
      setA(1);
      batch(() => {
        setB(1);
      });
      expect(runs).toBe(1);
    });
    expect(runs).toBe(2);
  });

  it("returns the callback result and survives errors", () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    createRenderEffect(() => {
      value();
      runs += 1;
    });
    expect(batch(() => 42)).toBe(42);
    expect(() =>
      batch(() => {
        setValue(1);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(runs).toBe(2);
  });

  it("does not force the first createEffect run", async () => {
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
    await tick();
    expect(runs).toBe(1);
    expect(value()).toBe(1);
  });
});

describe("flushSync", () => {
  it("flushes queued effects immediately", () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    createRenderEffect(() => {
      value();
      runs += 1;
    });
    setValue(1);
    expect(runs).toBe(1);
    flushSync();
    expect(runs).toBe(2);
    flushSync();
    expect(runs).toBe(2);
  });

  it("runs a pending initial effect", () => {
    let runs = 0;
    createEffect(() => {
      runs += 1;
    });
    expect(runs).toBe(0);
    flushSync();
    expect(runs).toBe(1);
  });
});

describe("owner", () => {
  it("reports the current owner and restores it", () => {
    expect(getOwner()).toBeNull();
    let inner: Owner | null = null;
    const dispose = createRoot((disposeRoot) => {
      inner = getOwner();
      expect(inner).not.toBeNull();
      return disposeRoot;
    });
    expect(getOwner()).toBeNull();
    expect(inner?.disposed).toBe(false);
    dispose();
    expect(inner?.disposed).toBe(true);
  });

  it("runs cleanup before rerun and on dispose", async () => {
    const [value, setValue] = createSignal(0);
    const log: string[] = [];
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        const current = value();
        log.push(`run:${current}`);
        onCleanup(() => {
          log.push(`cleanup:${current}`);
        });
      });
      return disposeRoot;
    });
    await tick();
    expect(log).toEqual(["run:0"]);
    setValue(1);
    flushSync();
    expect(log).toEqual(["run:0", "cleanup:0", "run:1"]);
    dispose();
    expect(log).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1"]);
    setValue(2);
    flushSync();
    expect(log).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1"]);
  });

  it("disposes nested effects and cleanups once", async () => {
    const [value, setValue] = createSignal(0);
    const log: string[] = [];
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        value();
        log.push("outer");
        onCleanup(() => log.push("outer-cleanup"));
        createEffect(() => {
          log.push("inner");
          onCleanup(() => log.push("inner-cleanup"));
        });
      });
      return disposeRoot;
    });
    await tick();
    await tick();
    expect(log).toEqual(["outer", "inner"]);
    setValue(1);
    flushSync();
    await tick();
    expect(log).toEqual([
      "outer",
      "inner",
      "outer-cleanup",
      "inner-cleanup",
      "outer",
      "inner",
    ]);
    dispose();
    dispose();
    await tick();
    expect(log.at(-1)).toBe("inner-cleanup");
    const snapshot = [...log];
    setValue(2);
    flushSync();
    await tick();
    expect(log).toEqual(snapshot);
  });

  it("runs effects created with runWithOwner inside the target owner", () => {
    let owner: Owner | null = null;
    const dispose = createRoot((disposeRoot) => {
      owner = getOwner();
      return disposeRoot;
    });
    expect(owner).not.toBeNull();
    let runs = 0;
    if (owner !== null) {
      runWithOwner(owner, () => {
        createEffect(() => {
          runs += 1;
        });
      });
    }
    flushSync();
    expect(runs).toBe(1);
    dispose();
    const before = runs;
    flushSync();
    expect(runs).toBe(before);
  });
});
