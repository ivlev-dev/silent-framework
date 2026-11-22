import { describe, expect, it } from "vitest";
import { Container, createToken } from "@ivlev-dev/silent-di";
import {
  Head,
  Suspense,
  createId,
  createResource,
  getRuntimeOptions,
  getServerStreamCollector,
  hasPendingWork,
  isServerMode,
  lazy,
  text,
  trackAsyncWork,
  whenIdle,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import {
  createRuntimeContextStore,
  getRuntimeContextProvider,
  getRuntimeContextStore,
  type RuntimeContextStore,
} from "@ivlev-dev/silent-core/runtime-context-provider";
import { ensureRuntimeContext } from "../src/runtime-context.js";
import { renderToString } from "../src/render.js";
import { renderToStream } from "../src/stream.js";

interface AsyncCapture {
  readonly outer: Container | undefined;
  readonly probeId: string;
  readonly before: { container: Container | undefined; server: boolean; id: string };
  readonly after: { container: Container | undefined; server: boolean; id: string };
  readonly request: string;
  readonly store: RuntimeContextStore | null;
}

const requestToken = createToken<string>("RequestLabel");

function createAsyncApp(label: string, capture: AsyncCapture[]): AnyComponent {
  return function App(): Node {
    const outer = getRuntimeOptions().container;
    const probeId = createId("probe");
    Head({ title: label });

    const resource = createResource(async () => {
      const before = {
        container: getRuntimeOptions().container,
        server: isServerMode(),
        id: createId("inside"),
      };
      await Promise.resolve();
      const container = getRuntimeOptions().container;
      const request = container === undefined ? "" : await container.resolve<string>(requestToken);
      capture.push({
        outer,
        probeId,
        before,
        after: {
          container,
          server: isServerMode(),
          id: createId("inside"),
        },
        request,
        store: getRuntimeContextStore(),
      });
      return `${label}:${request}`;
    });

    const element = document.createElement("p");
    const labelNode = document.createTextNode("");
    element.appendChild(labelNode);
    text(labelNode, () => resource.data() ?? "loading");
    return element;
  } as unknown as AnyComponent;
}

function plainApp(label: string): AnyComponent {
  return function App(): Node {
    const element = document.createElement("div");
    element.textContent = label;
    return element;
  } as unknown as AnyComponent;
}

describe("SSR context: AsyncLocalStorage", () => {
  it("изолирует опции, id и head двух последовательных рендеров", async () => {
    await ensureRuntimeContext();
    expect(getRuntimeContextProvider()).not.toBeNull();

    const capturesA: AsyncCapture[] = [];
    const capturesB: AsyncCapture[] = [];

    const baseA = new Container("als-base-a");
    baseA.bind(requestToken, () => "alpha").inScopedScope();
    const baseB = new Container("als-base-b");
    baseB.bind(requestToken, () => "beta").inScopedScope();

    const first = await renderToString(createAsyncApp("Alpha", capturesA), {
      container: baseA,
    });
    const second = await renderToString(createAsyncApp("Beta", capturesB), {
      container: baseB,
    });

    expect(capturesA).toHaveLength(1);
    expect(capturesB).toHaveLength(1);
    const a = capturesA[0];
    const b = capturesB[0];
    if (a === undefined || b === undefined) {
      throw new Error("ресурс не выполнился");
    }

    // Контейнер своего рендера виден и до, и после await внутри ресурса.
    expect(a.before.container).toBe(a.outer);
    expect(a.after.container).toBe(a.outer);
    expect(b.before.container).toBe(b.outer);
    expect(b.after.container).toBe(b.outer);
    expect(a.outer).not.toBe(b.outer);

    // scoped-сервис резолвится из request scope своего рендера.
    expect(a.request).toBe("alpha");
    expect(b.request).toBe("beta");

    // Счётчик id у каждого рендера начинается заново.
    expect(a.probeId).toBe("probe-1");
    expect(b.probeId).toBe("probe-1");
    expect(a.before.id).toBe(b.before.id);
    expect(a.after.id).toBe(b.after.id);
    expect(a.before.id).not.toBe(a.probeId);

    expect(a.before.server).toBe(true);
    expect(a.after.server).toBe(true);
    expect(b.before.server).toBe(true);
    expect(b.after.server).toBe(true);

    // Store своего рендера и закрытие после dispose.
    expect(a.store).not.toBeNull();
    expect(b.store).not.toBeNull();
    expect(a.store).not.toBe(b.store);
    expect(a.store?.active).toBe(false);
    expect(b.store?.active).toBe(false);

    // Head не смешивается.
    expect(first.head).toContain("<title>Alpha</title>");
    expect(first.head).not.toContain("Beta");
    expect(second.head).toContain("<title>Beta</title>");
    expect(second.head).not.toContain("Alpha");
    expect(first.html).toContain("Alpha:alpha");
    expect(second.html).toContain("Beta:beta");
    expect(first.html).not.toContain("Beta");
    expect(second.html).not.toContain("Alpha");
  });

  it("whenIdle внутри рендера не ждёт pending другого контекста", async () => {
    await ensureRuntimeContext();
    const provider = getRuntimeContextProvider();
    if (provider === null) {
      throw new Error("провайдер не зарегистрирован");
    }

    const foreignStore = createRuntimeContextStore({ server: true });
    const never = new Promise<void>(() => {});
    provider.run(foreignStore, () => {
      trackAsyncWork(never);
    });
    expect(foreignStore.pending.size).toBe(1);

    let ownStore: RuntimeContextStore | null = null;
    let pendingAtStart = -1;
    let idleAtStart = true;

    function View(): Node {
      ownStore = getRuntimeContextStore();
      pendingAtStart = ownStore === null ? -1 : ownStore.pending.size;
      idleAtStart = hasPendingWork();

      const resource = createResource(async () => {
        // Если whenIdle смотрит в чужой/legacy-набор, этот рендер повиснет.
        await whenIdle();
        return "idle-ok";
      });
      const element = document.createElement("p");
      const label = document.createTextNode("");
      element.appendChild(label);
      text(label, () => resource.data() ?? "loading");
      return element;
    }

    try {
      const { html } = await renderToString(View as unknown as AnyComponent, {
        timeoutMs: 1000,
      });

      expect(html).toBe("<p>idle-ok</p>");
      expect(idleAtStart).toBe(false);
      expect(pendingAtStart).toBe(0);
      expect(ownStore).not.toBeNull();
      expect(ownStore).not.toBe(foreignStore);
      expect((ownStore as RuntimeContextStore | null)?.active).toBe(false);
    } finally {
      foreignStore.pending.clear();
    }
  });

  it("после рендера не остаётся контекста и коллекторов", async () => {
    await ensureRuntimeContext();

    let store: RuntimeContextStore | null = null;
    function View(): Node {
      store = getRuntimeContextStore();
      return document.createElement("div");
    }

    await renderToString(View as unknown as AnyComponent);
    await renderToString(View as unknown as AnyComponent);

    expect((store as RuntimeContextStore | null)?.active).toBe(false);
    expect((store as RuntimeContextStore | null)?.metadata).toBeNull();
    expect((store as RuntimeContextStore | null)?.stream).toBeNull();
    expect((store as RuntimeContextStore | null)?.pending.size).toBe(0);
    expect((store as RuntimeContextStore | null)?.idCount).toBe(0);

    expect(getRuntimeContextStore()).toBeNull();
    expect(getRuntimeOptions().container).toBeUndefined();
    expect(getRuntimeOptions()).toEqual({});
    expect(isServerMode()).toBe(false);
    expect(getServerStreamCollector()).toBeNull();
  });

  it("renderToStream не смешивает регионы и head с предыдущим рендером", async () => {
    await ensureRuntimeContext();

    const before = await renderToString(plainApp("render-to-string-body"));
    expect(before.html).toContain("render-to-string-body");

    let release: (value: { default: AnyComponent }) => void = () => {};
    const gate = new Promise<{ default: AnyComponent }>((resolve) => {
      release = resolve;
    });
    const LazyFinal = lazy(() => gate);

    const heads: string[] = [];
    function Page(): Node {
      Head({ title: "Streaming" });
      return Suspense({
        fallback: () => {
          const span = document.createElement("span");
          span.textContent = "stream-loading";
          return span;
        },
        children: () => LazyFinal({}),
      });
    }

    const stream = renderToStream(Page as unknown as AnyComponent, {
      chunkSize: 64,
      onHead: (head) => {
        heads.push(head);
      },
    });
    const reader = stream.getReader();
    let html = "";

    const first = await reader.read();
    html += first.done === true ? "" : first.value;
    expect(html).toContain("stream-loading");

    release({
      default: () => {
        const article = document.createElement("article");
        article.textContent = "stream-final";
        return article;
      },
    });

    for (;;) {
      const next = await reader.read();
      if (next.done === true) {
        break;
      }
      html += next.value;
    }

    const head = heads.join("");
    expect(html).toContain("stream-final");
    expect(html).toContain("silent-stream:");
    expect(html).not.toContain("render-to-string-body");
    expect(head).toContain("<title>Streaming</title>");
    expect(head).not.toContain("render-to-string-body");

    expect(getRuntimeContextStore()).toBeNull();
    expect(getRuntimeOptions().container).toBeUndefined();
    expect(isServerMode()).toBe(false);
    expect(getServerStreamCollector()).toBeNull();
  });
});
