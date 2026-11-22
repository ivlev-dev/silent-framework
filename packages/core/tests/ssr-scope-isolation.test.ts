// @vitest-environment jsdom
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEffect, createRoot, flushSync, runWithOwner, setEffectErrorHandler } from "@ivlev-dev/silent-reactivity";
import { Context } from "../src/context.js";
import { getCurrentBoundary, runWithBoundary, type AsyncBoundary } from "../src/boundary.js";
import { ErrorBoundary } from "../src/error-boundary.js";
import { setErrorHandler } from "../src/component-state.js";
import {
  createRuntimeContextStore,
  setRuntimeContextProvider,
  type RuntimeContextProvider,
  type RuntimeContextStore,
} from "../src/runtime-context-provider.js";

function createTestProvider(): RuntimeContextProvider {
  const storage = new AsyncLocalStorage<RuntimeContextStore>();
  return {
    name: "test-als-scope",
    getStore: () => storage.getStore() ?? null,
    run: (store, fn) => storage.run(store, fn),
  };
}

function boundary(): AsyncBoundary {
  return { register: () => {} };
}

afterEach(() => {
  setRuntimeContextProvider(null);
  document.body.replaceChildren();
});

describe("per-render изоляция context/boundary по store", () => {
  it("provide-фреймы не видны соседнему store", () => {
    const provider = createTestProvider();
    setRuntimeContextProvider(provider);
    const storeA = createRuntimeContextStore({ server: true });
    const storeB = createRuntimeContextStore({ server: true });
    const Theme = new Context<string>({ name: "Theme" });

    provider.run(storeA, () => {
      Theme.provide("A", () => {
        expect(Theme.get()).toBe("A");
        provider.run(storeB, () => {
          // Свой owner-корень без родителя: проверяем именно стек фреймов,
          // а не легитимный lookup по owner-цепочке внешнего provide.
          runWithOwner(null, () => {
            expect(Theme.tryGet()).toBeUndefined();
            Theme.provide("B", () => {
              expect(Theme.get()).toBe("B");
            });
            expect(Theme.tryGet()).toBeUndefined();
          });
        });
        expect(Theme.get()).toBe("A");
      });
    });
  });

  it("runWithBoundary не протекает между store", () => {
    const provider = createTestProvider();
    setRuntimeContextProvider(provider);
    const storeA = createRuntimeContextStore({ server: true });
    const storeB = createRuntimeContextStore({ server: true });
    const boundaryA = boundary();
    const boundaryB = boundary();

    expect(getCurrentBoundary()).toBeNull();
    provider.run(storeA, () => {
      runWithBoundary(boundaryA, () => {
        expect(getCurrentBoundary()).toBe(boundaryA);
        provider.run(storeB, () => {
          expect(getCurrentBoundary()).toBeNull();
          runWithBoundary(boundaryB, () => {
            expect(getCurrentBoundary()).toBe(boundaryB);
          });
        });
        expect(getCurrentBoundary()).toBe(boundaryA);
      });
    });
    expect(getCurrentBoundary()).toBeNull();

    // Клиентский fallback: без провайдера модульная переменная работает.
    setRuntimeContextProvider(null);
    runWithBoundary(boundaryA, () => {
      expect(getCurrentBoundary()).toBe(boundaryA);
    });
    expect(getCurrentBoundary()).toBeNull();
  });

  it("активные ErrorBoundary одного store не перехватывают ошибки другого", () => {
    const provider = createTestProvider();
    setRuntimeContextProvider(provider);
    const storeA = createRuntimeContextStore({ server: false });
    const storeB = createRuntimeContextStore({ server: false });
    const fallback = vi.fn(() => document.createTextNode("fallback"));
    const reported: unknown[] = [];
    setErrorHandler((error) => {
      reported.push(error);
    });
    const previousEffectHandler = setEffectErrorHandler(null);

    let disposeA: (() => void) | null = null;
    try {
      provider.run(storeA, () => {
        disposeA = createRoot((dispose) => {
          ErrorBoundary({
            fallback,
            children: () => document.createTextNode("ok"),
          });
          return dispose;
        });
      });

      const b = { dispose: null as (() => void) | null };
      provider.run(storeB, () => {
        b.dispose = createRoot((dispose) => {
          createEffect(() => {
            throw new Error("store-b-effect");
          });
          return dispose;
        });
        flushSync();
        (b.dispose as (() => void) | null)?.();
      });

      expect(fallback).not.toHaveBeenCalled();
      expect(
        reported.some((error) => String(error).includes("store-b-effect")),
      ).toBe(true);
    } finally {
      (disposeA as (() => void) | null)?.();
      setErrorHandler(null);
      setEffectErrorHandler(previousEffectHandler);
    }
  });
});
