import { container as rootContainer, type ContainerSnapshot } from "@ivlev-dev/silent-di";
import {
  getReactivityStats,
  type ReactivityStats,
} from "@ivlev-dev/silent-reactivity";
import { getAllViewInstances, getViewRegistryStats } from "./registry.js";
import { getHydrationStats } from "./hydration-state.js";
import { pending } from "./component-state.js";
import {
  DEVTOOLS_EVENT_LIMIT,
  clearDevtoolsEvents,
  clearDevtoolsSubscribers,
  emitDevtoolsNavigate,
  getDevtoolsEventStats,
  getDevtoolsEvents,
  isDevtoolsInstalled,
  resetDevtoolsEvents,
  setDevtoolsEventLimit,
  setDevtoolsInstalled,
  subscribeDevtoolsEvents,
  type DevtoolsEvent,
  type DevtoolsEventStats,
  type DevtoolsSubscriber,
} from "./devtools-events.js";

export {
  DEVTOOLS_EVENT_LIMIT,
  getDevtoolsEvents,
  type DevtoolsErrorEvent,
  type DevtoolsEvent,
  type DevtoolsEventBase,
  type DevtoolsEventStats,
  type DevtoolsEventType,
  type DevtoolsHmrEvent,
  type DevtoolsMountEvent,
  type DevtoolsNavigateEvent,
  type DevtoolsSubscriber,
  type DevtoolsUnmountEvent,
} from "./devtools-events.js";

export interface DevtoolsViewInfo {
  readonly id: number | null;
  readonly moduleId: string;
  readonly name: string;
  readonly hydrated: boolean;
}

export interface DevtoolsPendingSnapshot {
  readonly async: number;
}

export interface DevtoolsHydrationSnapshot {
  readonly active: boolean;
  readonly depth: number;
  readonly windows: number;
  readonly sessions: number;
  readonly mismatches: number;
}

export interface DevtoolsRegistrySnapshot {
  readonly modules: number;
  readonly views: number;
}

export interface DevtoolsSnapshot {
  readonly installed: boolean;
  readonly production: boolean;
  readonly timestamp: number;
  readonly views: readonly DevtoolsViewInfo[];
  readonly pending: DevtoolsPendingSnapshot;
  readonly di: ContainerSnapshot;
  readonly hydration: DevtoolsHydrationSnapshot;
  readonly registry: DevtoolsRegistrySnapshot;
  readonly listeners: DevtoolsEventStats;
  readonly reactivity: ReactivityStats;
}

export interface DevtoolsInstallOptions {
  readonly enabled?: boolean;
  readonly eventLimit?: number;
}

export interface DevtoolsGlobal {
  readonly version: 1;
  snapshot(): DevtoolsSnapshot;
  subscribe(listener: DevtoolsSubscriber): () => void;
  events(): readonly DevtoolsEvent[];
  clear(): void;
  uninstall(): void;
}

export interface DevtoolsHandle {
  readonly installed: boolean;
  readonly global: DevtoolsGlobal | null;
  snapshot(): DevtoolsSnapshot;
  subscribe(listener: DevtoolsSubscriber): () => void;
  events(): readonly DevtoolsEvent[];
  clear(): void;
  uninstall(): void;
}

interface DevtoolsHost {
  __SILENT_DEV__?: unknown;
  __SILENT_DEVTOOLS__?: unknown;
  process?: { env?: Record<string, string | undefined> };
}

const VERSION = 1 as const;

let installedGlobal: DevtoolsGlobal | null = null;

function host(): DevtoolsHost {
  return globalThis as unknown as DevtoolsHost;
}

function viteProduction(): boolean | null {
  const meta = import.meta as unknown as {
    env?: { PROD?: unknown; DEV?: unknown };
  };
  if (typeof meta.env?.PROD === "boolean") {
    return meta.env.PROD;
  }
  if (typeof meta.env?.DEV === "boolean") {
    return !meta.env.DEV;
  }
  return null;
}

export function isDevtoolsProduction(): boolean {
  const flag = host().__SILENT_DEV__;
  if (typeof flag === "boolean") {
    return !flag;
  }
  const vite = viteProduction();
  if (vite !== null) {
    return vite;
  }
  return host().process?.env?.["NODE_ENV"] === "production";
}

export function getDevtoolsSnapshot(): DevtoolsSnapshot {
  const views: DevtoolsViewInfo[] = [];
  for (const instance of getAllViewInstances()) {
    views.push({
      id: instance.id ?? null,
      moduleId: instance.moduleId,
      name: instance.name,
      hydrated: instance.hydrated === true,
    });
  }
  const hydration = getHydrationStats();
  const registry = getViewRegistryStats();
  return {
    installed: isDevtoolsInstalled(),
    production: isDevtoolsProduction(),
    timestamp: Date.now(),
    views,
    pending: { async: pending.size },
    di: rootContainer.snapshot(),
    hydration: {
      active: hydration.active,
      depth: hydration.depth,
      windows: hydration.windows,
      sessions: hydration.sessions,
      mismatches: hydration.mismatches,
    },
    registry: {
      modules: registry.modules,
      views: registry.views,
    },
    listeners: getDevtoolsEventStats(),
    reactivity: getReactivityStats(),
  };
}

export function subscribeDevtools(listener: DevtoolsSubscriber): () => void {
  if (typeof listener !== "function") {
    throw new TypeError("subscribeDevtools ожидает функцию-подписчик");
  }
  return subscribeDevtoolsEvents(listener);
}

export function devtoolsNavigate(to: string, from: string | null = null): void {
  emitDevtoolsNavigate({ to, from });
}

function noopHandle(): DevtoolsHandle {
  return {
    installed: false,
    global: null,
    snapshot: getDevtoolsSnapshot,
    subscribe: () => () => {},
    events: () => [],
    clear: () => {},
    uninstall: () => {},
  };
}

function createGlobal(): DevtoolsGlobal {
  const globalObject: DevtoolsGlobal = {
    version: VERSION,
    snapshot: getDevtoolsSnapshot,
    subscribe: subscribeDevtools,
    events: getDevtoolsEvents,
    clear: clearDevtoolsEvents,
    uninstall: uninstallDevtools,
  };
  return globalObject;
}

function handleFor(globalObject: DevtoolsGlobal): DevtoolsHandle {
  return {
    installed: true,
    global: globalObject,
    snapshot: globalObject.snapshot,
    subscribe: globalObject.subscribe,
    events: globalObject.events,
    clear: globalObject.clear,
    uninstall: globalObject.uninstall,
  };
}

export function installDevtools(
  options: DevtoolsInstallOptions = {},
): DevtoolsHandle {
  if (options.enabled === false) {
    return noopHandle();
  }
  if (options.enabled !== true && isDevtoolsProduction()) {
    return noopHandle();
  }
  if (installedGlobal !== null) {
    return handleFor(installedGlobal);
  }
  if (options.eventLimit !== undefined) {
    setDevtoolsEventLimit(options.eventLimit);
  } else {
    setDevtoolsEventLimit(DEVTOOLS_EVENT_LIMIT);
  }
  const globalObject = createGlobal();
  installedGlobal = globalObject;
  setDevtoolsInstalled(true);
  host().__SILENT_DEVTOOLS__ = globalObject;
  return handleFor(globalObject);
}

export function uninstallDevtools(): void {
  const globalObject = installedGlobal;
  installedGlobal = null;
  if (globalObject !== null && host().__SILENT_DEVTOOLS__ === globalObject) {
    delete host().__SILENT_DEVTOOLS__;
  }
  setDevtoolsInstalled(false);
  clearDevtoolsSubscribers();
  resetDevtoolsEvents();
  setDevtoolsEventLimit(DEVTOOLS_EVENT_LIMIT);
}
