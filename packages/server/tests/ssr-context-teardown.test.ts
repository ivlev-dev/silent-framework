import { describe, expect, it } from "vitest";
import { Container } from "@ivlev-dev/silent-di";
import {
  createId,
  createResource,
  getRuntimeOptions,
  getServerStreamCollector,
  isServerMode,
  text,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import {
  getRuntimeContextStore,
  type RuntimeContextStore,
} from "@ivlev-dev/silent-core/runtime-context-provider";
import { renderToString } from "../src/render.js";

interface LateObservation {
  container: Container | undefined;
  server: boolean | null;
  id: string | null;
  store: RuntimeContextStore | null;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function plainApp(label: string): AnyComponent {
  return function App(): Node {
    const element = document.createElement("div");
    element.textContent = label;
    return element;
  } as unknown as AnyComponent;
}

describe("SSR context: teardown", () => {
  it("таймаут закрывает контекст, поздний callback не влияет на следующий рендер", async () => {
    const gate = deferred();
    const observation: LateObservation = {
      container: undefined,
      server: null,
      id: null,
      store: null,
    };
    let ownStore: RuntimeContextStore | null = null;

    function Hanging(): Node {
      ownStore = getRuntimeContextStore();
      const resource = createResource(async () => {
        await gate.promise;
        observation.container = getRuntimeOptions().container;
        observation.server = isServerMode();
        observation.id = createId("late");
        observation.store = getRuntimeContextStore();
        return "late-data";
      });
      const element = document.createElement("section");
      const label = document.createTextNode("");
      element.appendChild(label);
      text(label, () => resource.data() ?? "loading");
      return element;
    }

    await expect(
      renderToString(Hanging as unknown as AnyComponent, { timeoutMs: 25 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });

    // Контекст закрыт сразу после reject.
    expect(ownStore).not.toBeNull();
    expect((ownStore as RuntimeContextStore | null)?.active).toBe(false);
    expect((ownStore as RuntimeContextStore | null)?.pending.size).toBe(0);
    expect((ownStore as RuntimeContextStore | null)?.options).toEqual({});
    expect((ownStore as RuntimeContextStore | null)?.metadata).toBeNull();
    expect((ownStore as RuntimeContextStore | null)?.stream).toBeNull();
    expect(getRuntimeContextStore()).toBeNull();
    expect(getRuntimeOptions()).toEqual({});
    expect(isServerMode()).toBe(false);
    expect(getServerStreamCollector()).toBeNull();

    // Поздний callback выполняется уже без store.
    gate.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    expect(observation.store).toBeNull();
    expect(observation.container).toBeUndefined();
    expect(observation.server).toBe(false);
    expect(observation.id).toMatch(/^late-\d+$/);

    // Следующий рендер стартует с чистого контекста.
    let nextContainer: Container | undefined;
    let nextId = "";
    let nextServer = false;
    function Next(): Node {
      nextContainer = getRuntimeOptions().container;
      nextId = createId("next");
      nextServer = isServerMode();
      return document.createElement("div");
    }

    const { html } = await renderToString(Next as unknown as AnyComponent);
    expect(html).toBe("<div></div>");
    expect(nextContainer?.name).toMatch(/^request:/);
    expect(nextId).toBe("next-1");
    expect(nextServer).toBe(true);
    expect(getRuntimeContextStore()).toBeNull();
  });

  it("abort незавершённого ресурса не оставляет контекст", async () => {
    const controller = new AbortController();
    let ownStore: RuntimeContextStore | null = null;

    function Hanging(): Node {
      ownStore = getRuntimeContextStore();
      const resource = createResource(async () => {
        await new Promise<void>(() => {});
        return "never";
      });
      const element = document.createElement("section");
      const label = document.createTextNode("");
      element.appendChild(label);
      text(label, () => resource.data() ?? "loading");
      controller.abort();
      return element;
    }

    await expect(
      renderToString(Hanging as unknown as AnyComponent, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(ownStore).not.toBeNull();
    expect((ownStore as RuntimeContextStore | null)?.active).toBe(false);
    expect((ownStore as RuntimeContextStore | null)?.pending.size).toBe(0);
    expect(getRuntimeContextStore()).toBeNull();
    expect(getRuntimeOptions()).toEqual({});
    expect(isServerMode()).toBe(false);
    expect(getServerStreamCollector()).toBeNull();

    // Очередь и контекст следующего рендера не сломаны.
    const { html } = await renderToString(plainApp("after-abort"));
    expect(html).toBe("<div>after-abort</div>");
    expect(getRuntimeContextStore()).toBeNull();
  });
});
