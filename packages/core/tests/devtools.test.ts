import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEVTOOLS_EVENT_LIMIT,
  createComponent,
  devtoolsNavigate,
  getDevtoolsEvents,
  getDevtoolsSnapshot,
  installDevtools,
  subscribeDevtools,
  uninstallDevtools,
  type DevtoolsEvent,
  type DevtoolsHandle,
} from "../src/index";
import { hmrUpdate } from "../src/hmr";
import type { AnyComponent } from "../src/types";

const VIEW = Symbol.for("silent.view");
const DI_CREATE = Symbol.for("silent.di.create");

interface DevProps {
  readonly label?: string;
  readonly marker?: object;
}

class DevVM {
  label = "ready";
}

function attachMeta(
  component: unknown,
  vm: unknown,
  moduleId: string,
  name: string,
): void {
  (component as Record<PropertyKey, unknown>)[VIEW] = {
    vm,
    name,
    moduleId,
  };
}

function DevView(this: { vm: DevVM }, props: DevProps): Node {
  const element = document.createElement("span");
  element.textContent = `${this.vm.label}:${props.label ?? ""}`;
  return element;
}

const handles: DevtoolsHandle[] = [];

function install(options: Parameters<typeof installDevtools>[0] = {}): DevtoolsHandle {
  const handle = installDevtools(options);
  handles.push(handle);
  return handle;
}

function ofType<T extends DevtoolsEvent["type"]>(
  events: readonly DevtoolsEvent[],
  type: T,
): Extract<DevtoolsEvent, { type: T }>[] {
  return events.filter(
    (event): event is Extract<DevtoolsEvent, { type: T }> => event.type === type,
  );
}

beforeEach(() => {
  attachMeta(DevView, DevVM, "/app/dev-view.tsx", "DevView");
});

afterEach(() => {
  uninstallDevtools();
  handles.length = 0;
  delete (globalThis as { __SILENT_DEV__?: boolean }).__SILENT_DEV__;
});

describe("DevTools snapshot", () => {
  it("собирает view, DI, hydration и reactivity без ссылок на инстансы", async () => {
    install();
    const result = createComponent(DevView as AnyComponent, { label: "x" });
    await result.ready;

    const snapshot = getDevtoolsSnapshot();
    expect(snapshot.installed).toBe(true);
    expect(snapshot.views).toHaveLength(1);
    expect(snapshot.views[0]).toEqual({
      id: expect.any(Number),
      moduleId: "/app/dev-view.tsx",
      name: "DevView",
      hydrated: false,
    });
    expect(snapshot.registry).toEqual({ modules: 1, views: 1 });
    expect(snapshot.pending.async).toBeGreaterThanOrEqual(0);
    expect(snapshot.di.scopes).toBeGreaterThanOrEqual(1);
    expect(snapshot.hydration.active).toBe(false);
    expect(snapshot.reactivity.signalsCreated).toBeGreaterThanOrEqual(0);
    expect(snapshot.listeners.active).toBe(true);
    expect(Object.keys(snapshot.views[0] ?? {})).not.toContain("props");
    expect(Object.keys(snapshot.views[0] ?? {})).not.toContain("component");
    result.dispose();
  });

  it("обновляет pending async во время резолва ViewModel", async () => {
    class DelayedVM {
      static [DI_CREATE] = async (): Promise<DelayedVM> => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new DelayedVM();
      };
    }
    function DelayedView(this: { vm: DelayedVM }): Node {
      const element = document.createElement("b");
      void this.vm;
      return element;
    }
    attachMeta(DelayedView, DelayedVM, "/app/delayed.tsx", "DelayedView");
    const result = createComponent(DelayedView as AnyComponent, {});
    expect(getDevtoolsSnapshot().pending.async).toBeGreaterThan(0);
    await result.ready;
    expect(getDevtoolsSnapshot().pending.async).toBe(0);
    result.dispose();
  });
});

describe("события DevTools", () => {
  it("доставляет mount и unmount с очисткой реестра", async () => {
    install();
    const received: DevtoolsEvent[] = [];
    subscribeDevtools((event) => received.push(event));

    const result = createComponent(DevView as AnyComponent, { label: "a" });
    await result.ready;
    expect(ofType(received, "mount")).toHaveLength(1);
    const mount = ofType(received, "mount")[0];
    expect(mount?.name).toBe("DevView");
    expect(mount?.moduleId).toBe("/app/dev-view.tsx");
    expect(mount?.props).toEqual(["label"]);

    result.dispose();
    expect(ofType(received, "unmount")).toHaveLength(1);
    expect(getDevtoolsSnapshot().views).toHaveLength(0);
    expect(getDevtoolsSnapshot().registry).toEqual({ modules: 0, views: 0 });
  });

  it("публикует ошибку резолва ViewModel", async () => {
    class BrokenVM {
      static [DI_CREATE] = (): never => {
        throw new Error("boom");
      };
    }
    function BrokenView(this: { vm: BrokenVM }): Node {
      const element = document.createElement("b");
      void this.vm;
      return element;
    }
    attachMeta(BrokenView, BrokenVM, "/app/broken.tsx", "BrokenView");
    install();
    const events: DevtoolsEvent[] = [];
    subscribeDevtools((event) => events.push(event));

    const result = createComponent(BrokenView as AnyComponent, {});
    await result.ready;

    const errors = ofType(events, "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("boom");
    expect(errors[0]?.phase).toBe("resolve");
    expect(errors[0]?.name).toBe("BrokenView");
    expect(getDevtoolsSnapshot().listeners.errors).toBe(1);
    result.dispose();
  });

  it("публикует hmr при обновлении модуля", async () => {
    install();
    const events: DevtoolsEvent[] = [];
    subscribeDevtools((event) => events.push(event));
    const result = createComponent(DevView as AnyComponent, {});
    await result.ready;
    hmrUpdate("/app/dev-view.tsx", { DevView });
    expect(ofType(events, "hmr")).toEqual([
      expect.objectContaining({
        moduleId: "/app/dev-view.tsx",
        kind: "update",
        views: 1,
      }),
    ]);
    result.dispose();
  });

  it("публикует navigate через публичный помощник", () => {
    install();
    const events: DevtoolsEvent[] = [];
    subscribeDevtools((event) => events.push(event));
    devtoolsNavigate("/next", "/prev");
    expect(ofType(events, "navigate")).toEqual([
      expect.objectContaining({ to: "/next", from: "/prev" }),
    ]);
  });

  it("отписывает подписчика и не вызывает его после отписки", async () => {
    install();
    const events: DevtoolsEvent[] = [];
    const unsubscribe = subscribeDevtools((event) => events.push(event));
    unsubscribe();
    unsubscribe();
    const result = createComponent(DevView as AnyComponent, {});
    await result.ready;
    result.dispose();
    expect(events).toHaveLength(0);
  });

  it("ограничивает буфер событий", async () => {
    install({ eventLimit: 1 });
    const result = createComponent(DevView as AnyComponent, {});
    await result.ready;
    result.dispose();
    const events = getDevtoolsEvents();
    expect(events.length).toBeLessThanOrEqual(1);
    expect(getDevtoolsSnapshot().listeners.dropped).toBeGreaterThan(0);
  });
});

describe("жизненный цикл установки", () => {
  it("устанавливает и удаляет глобальный объект", () => {
    const handle = install();
    const host = globalThis as { __SILENT_DEVTOOLS__?: unknown };
    expect(handle.installed).toBe(true);
    expect(host.__SILENT_DEVTOOLS__).toBe(handle.global);
    handle.uninstall();
    expect(host.__SILENT_DEVTOOLS__).toBeUndefined();
    expect(getDevtoolsSnapshot().installed).toBe(false);
  });

  it("не имеет побочных эффектов в production-режиме", () => {
    (globalThis as { __SILENT_DEV__?: boolean }).__SILENT_DEV__ = false;
    const handle = install();
    const host = globalThis as { __SILENT_DEVTOOLS__?: unknown };
    expect(handle.installed).toBe(false);
    expect(handle.global).toBeNull();
    expect(host.__SILENT_DEVTOOLS__).toBeUndefined();
    const events: DevtoolsEvent[] = [];
    handle.subscribe((event) => events.push(event));
    devtoolsNavigate("/prod");
    expect(events).toHaveLength(0);
    expect(getDevtoolsEvents()).toHaveLength(0);
  });

  it("сбрасывает подписчиков и буфер при uninstall", () => {
    install({ eventLimit: DEVTOOLS_EVENT_LIMIT });
    const events: DevtoolsEvent[] = [];
    subscribeDevtools((event) => events.push(event));
    devtoolsNavigate("/one");
    uninstallDevtools();
    devtoolsNavigate("/two");
    expect(events.map((event) => event.type)).toEqual(["navigate"]);
    expect(getDevtoolsEvents()).toHaveLength(0);
  });
});

const gc = (globalThis as { gc?: (options?: { type?: string; execution?: string }) => void }).gc;

describe("утечки DevTools", () => {
  it("не удерживает props через события и snapshot", async () => {
    let markerRef: WeakRef<object> | null = null;
    {
      const marker = { payload: "x".repeat(1024) };
      markerRef = new WeakRef(marker);
      const result = createComponent(DevView as AnyComponent, { label: "gc", marker });
      await result.ready;
      getDevtoolsSnapshot();
      getDevtoolsEvents();
      result.dispose();
    }
    for (const event of getDevtoolsEvents()) {
      expect(JSON.stringify(event)).not.toContain("payload");
    }
    expect(markerRef?.deref()).toBeDefined();
  });

  it.skipIf(gc === undefined)("освобождает props после dispose при доступном gc", async () => {
    let markerRef: WeakRef<object> | null = null;
    async function mountAndDispose(): Promise<void> {
      const marker = { payload: "leak" };
      markerRef = new WeakRef(marker);
      const result = createComponent(DevView as AnyComponent, { marker });
      await result.ready;
      result.dispose();
    }
    await mountAndDispose();
    for (let attempt = 0; attempt < 30 && (markerRef as WeakRef<object> | null)?.deref() !== undefined; attempt += 1) {
      gc?.({ type: "major", execution: "async" });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect((markerRef as WeakRef<object> | null)?.deref()).toBeUndefined();
  });
});
