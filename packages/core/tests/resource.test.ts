import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRoot,
  createSignal,
  flushSync,
} from "@ivlev-dev/silent-reactivity";
import { hasPendingWork, whenIdle } from "../src/component.js";
import { text } from "../src/dom.js";
import { mount } from "../src/mount.js";
import { Suspense } from "../src/suspense.js";
import {
  clearResourceCache,
  createResource,
  createResourceCache,
  type Resource,
} from "../src/resource.js";
import type { AnyComponent } from "../src/types.js";

const hosts: HTMLElement[] = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

afterEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
  clearResourceCache();
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve(value);
    },
    reject: (error: unknown) => {
      reject(error);
    },
  };
}

function inRoot<T>(fn: () => T): { readonly value: T; dispose(): void } {
  let dispose: () => void = () => {};
  const value = createRoot((rootDispose) => {
    dispose = rootDispose;
    return fn();
  });
  return {
    value,
    dispose: () => {
      dispose();
    },
  };
}

describe("createResource: состояние", () => {
  it("проходит путь idle → pending → success", async () => {
    const gate = deferred<string>();
    const resource = createResource(() => gate.promise);

    expect(resource.status()).toBe("pending");
    expect(resource.pending()).toBe(true);
    expect(resource.data()).toBeUndefined();

    gate.resolve("payload");
    await resource.ready;

    expect(resource.status()).toBe("success");
    expect(resource.pending()).toBe(false);
    expect(resource.data()).toBe("payload");
    expect(resource.error()).toBeUndefined();
    expect(resource.read()).toBe("payload");
  });

  it("использует initialValue до завершения запроса", async () => {
    const gate = deferred<string>();
    const resource = createResource(() => gate.promise, { initialValue: "seed" });

    expect(resource.data()).toBe("seed");
    expect(resource.status()).toBe("pending");

    gate.resolve("ready");
    await resource.ready;
    expect(resource.data()).toBe("ready");
  });

  it("поддерживает синхронный fetcher", async () => {
    const resource = createResource(() => 42);

    await resource.ready;

    expect(resource.data()).toBe(42);
    expect(resource.status()).toBe("success");
  });

  it("set и mutate обновляют данные и сбрасывают ошибку", async () => {
    const resource = createResource(async () => {
      throw new Error("boom");
    });

    await resource.ready;
    expect(resource.status()).toBe("error");

    resource.set("manual");
    expect(resource.data()).toBe("manual");
    expect(resource.error()).toBeUndefined();
    expect(resource.status()).toBe("success");

    resource.mutate((previous) => `${String(previous)}!`);
    expect(resource.data()).toBe("manual!");
  });

  it("отдаёт reactive accessors", async () => {
    const gate = deferred<string>();
    const resource = createResource(() => gate.promise);
    const node = document.createTextNode("");
    inRoot(() => {
      text(node, () => resource.data() ?? "…");
    });

    expect(node.data).toBe("…");

    gate.resolve("done");
    await resource.ready;
    flushSync();

    expect(node.data).toBe("done");
  });
});

describe("createResource: ошибки", () => {
  it("сохраняет ошибку и вызывает onError", async () => {
    const onError = vi.fn();
    const failure = new Error("fail");
    const resource = createResource(async () => {
      throw failure;
    }, { onError });

    await resource.ready;

    expect(resource.error()).toBe(failure);
    expect(resource.status()).toBe("error");
    expect(resource.pending()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("read не бросает по умолчанию", async () => {
    const resource = createResource(async () => {
      throw new Error("soft");
    });

    await resource.ready;

    expect(() => resource.read()).not.toThrow();
    expect(resource.read()).toBeUndefined();
  });

  it("read бросает при throwOnError", async () => {
    const failure = new Error("hard");
    const resource = createResource(async () => {
      throw failure;
    }, { throwOnError: true });

    await resource.ready;

    expect(() => resource.read()).toThrow(failure);
  });

  it("не перезаписывает последние данные при ошибке refetch", async () => {
    let shouldFail = false;
    const resource = createResource(async () => {
      if (shouldFail) {
        throw new Error("late");
      }
      return "ok";
    });

    await resource.ready;
    shouldFail = true;
    await resource.refetch();

    expect(resource.data()).toBe("ok");
    expect(resource.status()).toBe("error");
  });
});

describe("createResource: dedupe и кэш", () => {
  it("дедуплицирует параллельные refetch", async () => {
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);
    const resource = createResource(fetcher);
    const first = resource.refetch();
    const second = resource.refetch();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    gate.resolve("value");
    await first;

    expect(resource.data()).toBe("value");
  });

  it("читает кэш по ключу синхронно", async () => {
    const cache = createResourceCache();
    const key = { id: 7 };
    const first = createResource(async () => "cached", { key, cache });

    await first.ready;

    const second = createResource(async () => {
      throw new Error("не должен вызываться");
    }, { key, cache });

    expect(second.data()).toBe("cached");
    expect(second.status()).toBe("success");
    expect(second.pending()).toBe(false);
  });

  it("дедуплицирует in-flight между ресурсами с общим ключом", async () => {
    const cache = createResourceCache();
    const gate = deferred<string>();
    const ownerFetcher = vi.fn(() => gate.promise);
    const adopterFetcher = vi.fn(async () => "own");

    const owner = createResource(ownerFetcher, { key: "shared", cache });
    const adopter = createResource(adopterFetcher, { key: "shared", cache });

    expect(ownerFetcher).toHaveBeenCalledTimes(1);
    expect(adopterFetcher).not.toHaveBeenCalled();

    gate.resolve("shared-value");
    await owner.ready;
    await adopter.ready;

    expect(adopter.data()).toBe("shared-value");
    expect(adopterFetcher).not.toHaveBeenCalled();
  });

  it("не кэширует при cache: false и при cacheTime: 0", async () => {
    const cache = createResourceCache();
    const plain = createResource(async () => "plain", {
      key: "plain",
      cache: false,
    });
    await plain.ready;
    expect(cache.has("plain")).toBe(false);

    const zero = createResource(async () => "zero", {
      key: "zero",
      cache,
      cacheTime: 0,
    });
    await zero.ready;
    expect(cache.has("zero")).toBe(false);
  });

  it("уважает истечение cacheTime", async () => {
    const cache = createResourceCache();
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000);
      const first = createResource(async () => "fresh", {
        key: "ttl",
        cache,
        cacheTime: 100,
      });
      await first.ready;
      now.mockReturnValue(1_200);

      const fetcher = vi.fn(async () => "stale");
      const second = createResource(fetcher, {
        key: "ttl",
        cache,
        cacheTime: 100,
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
      await second.ready;
      expect(second.data()).toBe("stale");
    } finally {
      now.mockRestore();
    }
  });
});

describe("createResource: ключи, abort и dispose", () => {
  it("перезапрашивает при изменении реактивного ключа", async () => {
    const [key, setKey] = createSignal("a");
    const calls: string[] = [];
    const cache = createResourceCache();
    const root = inRoot(() => {
      return createResource(async (context) => {
        const value = String(context.key);
        calls.push(value);
        return value;
      }, { key: () => key(), cache });
    });

    await root.value.ready;
    expect(root.value.data()).toBe("a");

    setKey("b");
    flushSync();
    await root.value.ready;

    expect(calls).toEqual(["a", "b"]);
    expect(root.value.data()).toBe("b");
    expect(root.value.key()).toBe("b");

    root.dispose();
  });

  it("abort отменяет запрос без ошибки", async () => {
    const gate = deferred<string>();
    let captured: AbortSignal | null = null;
    const resource: Resource<string> = createResource((context) => {
      captured = context.signal;
      return gate.promise;
    }, { immediate: false });

    const pending = resource.refetch();
    expect(captured).not.toBeNull();
    expect(resource.pending()).toBe(true);

    resource.abort();
    expect((captured as unknown as AbortSignal).aborted).toBe(true);
    gate.reject(new DOMException("Aborted", "AbortError"));
    await pending;

    expect(resource.pending()).toBe(false);
    expect(resource.error()).toBeUndefined();
    expect(resource.status()).toBe("idle");
  });

  it("не применяет результат после abort", async () => {
    const gate = deferred<string>();
    const resource = createResource(() => gate.promise, { immediate: false });
    const pending = resource.refetch();

    resource.abort();
    gate.resolve("late");
    await pending;

    expect(resource.data()).toBeUndefined();
  });

  it("dispose отменяет запрос и регистрируется в owner", async () => {
    const gate = deferred<string>();
    let captured: AbortSignal | null = null;
    const root = inRoot(() =>
      createResource((context) => {
        captured = context.signal;
        return gate.promise;
      }),
    );

    root.dispose();

    expect((captured as unknown as AbortSignal).aborted).toBe(true);
    expect(root.value.pending()).toBe(false);

    gate.resolve("ignored");
    await root.value.ready;
    expect(root.value.data()).toBeUndefined();
  });
});

describe("createResource: интеграция с рантаймом", () => {
  it("регистрирует работу в whenIdle", async () => {
    const gate = deferred<number>();
    const resource = createResource(() => gate.promise);

    expect(hasPendingWork()).toBe(true);

    gate.resolve(7);
    await whenIdle();

    expect(hasPendingWork()).toBe(false);
    expect(resource.data()).toBe(7);
    resource.dispose();
  });

  it("Suspense ждёт ресурс и показывает fallback", async () => {
    const gate = deferred<string>();
    function View(): Node {
      const resource = createResource(() => gate.promise);
      const node = document.createTextNode("");
      text(node, () => resource.data() ?? "empty");
      const paragraph = document.createElement("p");
      paragraph.appendChild(node);
      return paragraph;
    }
    function Loading(): Node {
      return document.createTextNode("waiting");
    }

    const target = host();
    await mount(target, Suspense as unknown as AnyComponent, {
      props: {
        fallback: Loading(),
        children: () => View(),
      },
    });

    expect(target.textContent).toBe("waiting");

    gate.resolve("resolved");
    await whenIdle();
    flushSync();

    expect(target.textContent).toBe("resolved");
  });

  it("отменяет ресурс при уничтожении Suspense", async () => {
    const gate = deferred<string>();
    let captured: AbortSignal | null = null;
    function View(): Node {
      createResource((context) => {
        captured = context.signal;
        return gate.promise;
      });
      return document.createTextNode("");
    }
    function Loading(): Node {
      return document.createTextNode("waiting");
    }

    const target = host();
    const handle = await mount(target, Suspense as unknown as AnyComponent, {
      props: {
        fallback: Loading(),
        children: () => View(),
      },
    });

    handle.dispose();
    gate.resolve("late");
    await whenIdle();

    expect((captured as unknown as AbortSignal).aborted).toBe(true);
    expect(target.textContent).toBe("");
  });
});
