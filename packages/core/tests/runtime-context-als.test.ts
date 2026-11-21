// @vitest-environment jsdom
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { Container } from "@ivlev-dev/silent-di";
import {
  getRuntimeOptions,
  hasPendingWork,
  resetRuntimeOptions,
  trackPending,
  whenIdle,
  withRuntimeOptions,
} from "../src/component-state.js";
import { isServerMode, setServerMode } from "../src/dom.js";
import { createId, currentIdCount, resetIds, withIdScope } from "../src/id.js";
import { getMetadataCollector, setMetadataCollector } from "../src/metadata.js";
import {
  getServerStreamCollector,
  openServerStreamRegion,
  setServerStreamCollector,
  type ServerStreamCollector,
  type ServerStreamRegion,
} from "../src/server-stream.js";
import {
  createRuntimeContextStore,
  getRuntimeContextProvider,
  getRuntimeContextStore,
  hasRuntimeContextProvider,
  setRuntimeContextProvider,
  type RuntimeContextProvider,
  type RuntimeContextStore,
} from "../src/runtime-context-provider.js";

/**
 * Тестовый провайдер повторяет контракт AsyncLocalStorage: серверный пакет
 * регистрирует реальный ALS, а core работает только с абстракцией. Собственная
 * stack-обёртка здесь не подходит — продолжение async-функции после `await`
 * выполняется вне синхронного `run`, и store пришлось бы восстанавливать вручную
 * в каждом тесте, что перестало бы проверять изоляцию async-цепочек.
 * Node API используется только в тесте; core его не импортирует.
 */
function createTestProvider(): RuntimeContextProvider {
  const storage = new AsyncLocalStorage<RuntimeContextStore>();
  return {
    name: "test-als",
    getStore: () => storage.getStore() ?? null,
    run: (store, fn) => storage.run(store, fn),
  };
}

interface Gate {
  readonly promise: Promise<void>;
  release(): void;
}

function createGate(): Gate {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface TestStreamCollector extends ServerStreamCollector {
  readonly opened: number[];
}

function createStreamCollector(id: number): TestStreamCollector {
  const opened: number[] = [];
  return {
    opened,
    openRegion(): ServerStreamRegion {
      opened.push(id);
      return {
        id,
        start: document.createComment(`stream-start-${id}`),
        end: document.createComment(`stream-end-${id}`),
        resolve(): void {},
      };
    },
  };
}

function collectInto(target: Element[]): (node: Element) => void {
  return (node) => {
    target.push(node);
  };
}

afterEach(() => {
  setRuntimeContextProvider(null);
  setServerMode(false);
  resetRuntimeOptions();
  resetIds();
  setMetadataCollector(null);
  setServerStreamCollector(null);
  document.body.replaceChildren();
});

describe("runtime context provider: изоляция async-цепочек", () => {
  it("держит свои опции, server-флаг, id, metadata и stream для store A/B", async () => {
    const provider = createTestProvider();
    setRuntimeContextProvider(provider);

    const containerA = new Container("als-A");
    const containerB = new Container("als-B");
    const collectedA: Element[] = [];
    const collectedB: Element[] = [];
    const metadataA = collectInto(collectedA);
    const metadataB = collectInto(collectedB);
    const streamA = createStreamCollector(1);
    const streamB = createStreamCollector(2);

    const storeA = createRuntimeContextStore({
      server: true,
      options: { container: containerA },
      metadata: metadataA,
      stream: streamA,
    });
    const storeB = createRuntimeContextStore({
      server: false,
      options: { container: containerB },
      metadata: metadataB,
      stream: streamB,
    });

    const gateA = createGate();
    const gateB = createGate();

    const chainA = provider.run(storeA, async () => {
      expect(getRuntimeContextStore()).toBe(storeA);
      expect(getRuntimeOptions().container).toBe(containerA);
      expect(isServerMode()).toBe(true);
      expect(getMetadataCollector()).toBe(metadataA);
      expect(getServerStreamCollector()).toBe(streamA);
      expect(openServerStreamRegion()?.id).toBe(1);
      expect(createId("field")).toBe("field-1");
      expect(currentIdCount()).toBe(1);

      await gateA.promise;

      expect(getRuntimeContextStore()).toBe(storeA);
      expect(getRuntimeOptions().container).toBe(containerA);
      expect(isServerMode()).toBe(true);
      expect(getMetadataCollector()).toBe(metadataA);
      expect(getServerStreamCollector()).toBe(streamA);
      expect(openServerStreamRegion()?.id).toBe(1);
      expect(createId("field")).toBe("field-2");
      expect(withIdScope(() => [createId("field"), createId("field")])).toEqual([
        "field-1",
        "field-2",
      ]);
      expect(currentIdCount()).toBe(2);
      getMetadataCollector()?.(document.createElement("meta"));
      expect(collectedA).toHaveLength(1);
      expect(collectedB).toHaveLength(1);
    });

    const chainB = provider.run(storeB, async () => {
      expect(getRuntimeContextStore()).toBe(storeB);
      expect(getRuntimeOptions().container).toBe(containerB);
      expect(isServerMode()).toBe(false);
      expect(getMetadataCollector()).toBe(metadataB);
      expect(getServerStreamCollector()).toBe(streamB);
      expect(openServerStreamRegion()?.id).toBe(2);
      expect(createId("field")).toBe("field-1");
      expect(currentIdCount()).toBe(1);

      await gateB.promise;

      expect(getRuntimeContextStore()).toBe(storeB);
      expect(getRuntimeOptions().container).toBe(containerB);
      expect(isServerMode()).toBe(false);
      expect(getMetadataCollector()).toBe(metadataB);
      expect(getServerStreamCollector()).toBe(streamB);
      expect(openServerStreamRegion()?.id).toBe(2);
      expect(createId("field")).toBe("field-2");
      expect(withIdScope(() => [createId("field"), createId("field")])).toEqual([
        "field-1",
        "field-2",
      ]);
      expect(currentIdCount()).toBe(2);
      getMetadataCollector()?.(document.createElement("meta"));
      expect(collectedB).toHaveLength(1);
      expect(collectedA).toHaveLength(0);
    });

    // Гейты разрешаются в обратном порядке: B завершается раньше A.
    gateB.release();
    await chainB;
    expect(collectedB).toHaveLength(1);
    expect(collectedA).toHaveLength(0);
    gateA.release();
    await chainA;

    expect(collectedA).toHaveLength(1);
    expect(collectedB).toHaveLength(1);

    expect(streamA.opened).toEqual([1, 1]);
    expect(streamB.opened).toEqual([2, 2]);
    expect(getRuntimeContextStore()).toBeNull();
    expect(getRuntimeOptions().container).toBeUndefined();
    expect(isServerMode()).toBe(false);
  });

  it("withRuntimeOptions внутри store не пишет legacy и восстанавливает опции", () => {
    const provider = createTestProvider();
    setRuntimeContextProvider(provider);

    const containerA = new Container("als-with-A");
    const containerB = new Container("als-with-B");
    const store = createRuntimeContextStore({ options: { container: containerA } });

    provider.run(store, () => {
      expect(getRuntimeOptions().container).toBe(containerA);

      const result = withRuntimeOptions({ container: containerB }, () => {
        expect(store.options.container).toBe(containerB);
        expect(getRuntimeOptions().container).toBe(containerB);
        return "value";
      });

      expect(result).toBe("value");
      expect(store.options.container).toBe(containerA);
      expect(getRuntimeOptions().container).toBe(containerA);
    });

    setRuntimeContextProvider(null);
    expect(getRuntimeOptions().container).toBeUndefined();

    withRuntimeOptions({ container: containerB }, () => {
      expect(getRuntimeOptions().container).toBe(containerB);
    });
    expect(getRuntimeOptions().container).toBeUndefined();
  });

  it("resetRuntimeOptions очищает и store, и legacy-опции", () => {
    const provider = createTestProvider();
    setRuntimeContextProvider(provider);

    const container = new Container("als-reset");
    const store = createRuntimeContextStore({ options: { container } });

    withRuntimeOptions({ container }, () => {
      provider.run(store, () => {
        resetRuntimeOptions();
        expect(store.options).toEqual({});
        expect(getRuntimeOptions()).toEqual({});
      });
      // legacy-переменная тоже очищена
      expect(getRuntimeOptions().container).toBeUndefined();
    });
  });

  it("закрытый store не виден, чтение падает в legacy", () => {
    const provider = createTestProvider();
    setRuntimeContextProvider(provider);

    const store = createRuntimeContextStore({
      server: true,
      options: { container: new Container("als-closed") },
    });
    store.active = false;

    expect(provider.run(store, () => getRuntimeContextStore())).toBeNull();

    provider.run(store, () => {
      expect(createId("field")).toBe("field-1");
      expect(currentIdCount()).toBe(1);
      expect(getRuntimeOptions().container).toBeUndefined();
      expect(isServerMode()).toBe(false);
      expect(getMetadataCollector()).toBeNull();
      expect(getServerStreamCollector()).toBeNull();
    });

    expect(store.idCount).toBe(0);
  });
});

describe("runtime context provider: клиентский fallback", () => {
  it("без провайдера поведение прежнее", () => {
    setRuntimeContextProvider(null);

    expect(hasRuntimeContextProvider()).toBe(false);
    expect(getRuntimeContextProvider()).toBeNull();
    expect(getRuntimeContextStore()).toBeNull();

    const container = new Container("als-client");
    withRuntimeOptions({ container }, () => {
      expect(getRuntimeOptions().container).toBe(container);
    });
    expect(getRuntimeOptions().container).toBeUndefined();

    setServerMode(true);
    try {
      expect(isServerMode()).toBe(true);
    } finally {
      setServerMode(false);
    }
    expect(isServerMode()).toBe(false);

    expect(createId("field")).toBe("field-1");
    expect(currentIdCount()).toBe(1);
  });
});

describe("runtime context provider: pending", () => {
  it("pending store A не виден в whenIdle store B, legacy-набор общий", async () => {
    const provider = createTestProvider();
    setRuntimeContextProvider(provider);

    const storeA = createRuntimeContextStore();
    const storeB = createRuntimeContextStore();
    const gateA = createGate();

    provider.run(storeA, () => {
      trackPending(gateA.promise);
      expect(hasPendingWork()).toBe(true);
    });

    provider.run(storeB, () => {
      expect(hasPendingWork()).toBe(false);
    });

    await provider.run(storeB, () => whenIdle());

    provider.run(storeA, () => {
      expect(hasPendingWork()).toBe(true);
      expect(storeB.pending.size).toBe(0);
    });
    expect(hasPendingWork()).toBe(false);

    gateA.release();
    await provider.run(storeA, () => whenIdle());
    expect(storeA.pending.size).toBe(0);

    // legacy-режим: один общий набор вне store
    const legacyGate = createGate();
    trackPending(legacyGate.promise);
    expect(hasPendingWork()).toBe(true);
    legacyGate.release();
    await whenIdle();
    expect(hasPendingWork()).toBe(false);
  });
});
