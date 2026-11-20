import { describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
} from "../src/index";

describe("dev-предупреждения", () => {
  it("предупреждает об async-эффекте один раз", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const [value, setValue] = createSignal(0);
      let runs = 0;
      createEffect(async () => {
        value();
        runs += 1;
      });

      flushSync();
      expect(runs).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("async-эффект");

      setValue(1);
      flushSync();
      expect(runs).toBe(2);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("не предупреждает в production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nodeProcess = (
      globalThis as {
        process: { env: Record<string, string | undefined> };
      }
    ).process;
    const previous = nodeProcess.env["NODE_ENV"];
    nodeProcess.env["NODE_ENV"] = "production";
    try {
      createEffect(async () => {});
      flushSync();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete nodeProcess.env["NODE_ENV"];
      } else {
        nodeProcess.env["NODE_ENV"] = previous;
      }
      warn.mockRestore();
    }
  });

  it("предупреждает о чтении мемо после dispose один раз", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const [tick, setTick] = createSignal(0);
      const child = createRoot((disposeRoot) => {
        const memo = createMemo(() => tick() * 2, { name: "child" });
        return { read: memo, dispose: disposeRoot };
      });

      let runs = 0;
      let seen = -1;
      createEffect(() => {
        tick();
        seen = child.read();
        runs += 1;
      });

      flushSync();
      expect(runs).toBe(1);
      expect(seen).toBe(0);
      expect(warn).not.toHaveBeenCalled();

      child.dispose();
      setTick(1);
      flushSync();
      expect(runs).toBe(2);
      expect(seen).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("после dispose");

      setTick(2);
      flushSync();
      expect(runs).toBe(3);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
