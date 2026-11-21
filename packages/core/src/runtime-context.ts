import { getOwner, onCleanup, runWithOwner, type Owner } from "@ivlev-dev/silent-reactivity";
import type { RuntimeOptions } from "./component-state.js";

interface OwnerNodeLink {
  readonly parent: OwnerNodeLink | null;
}

const ownerOptions = new WeakMap<object, RuntimeOptions>();
const trackedOwners = new WeakSet<object>();
const trackedContainers = new WeakMap<object, WeakSet<object>>();
const warnedDisposed = new WeakSet<object>();
let hasBoundOptions = false;

declare const __SILENT_DEV__: boolean | undefined;
const DEV = typeof __SILENT_DEV__ === "undefined" || __SILENT_DEV__;

function diagnosticsEnabled(): boolean {
  if (!DEV) {
    return false;
  }
  const host = globalThis as { __SILENT_DEBUG_RUNTIME__?: unknown };
  if (host.__SILENT_DEBUG_RUNTIME__ === true) {
    return true;
  }
  const env = (globalThis as {
    process?: { env?: Readonly<Record<string, string | undefined>> };
  }).process?.env;
  return env?.SILENT_DEBUG_RUNTIME === "1";
}

function isDisposedContainer(container: unknown): boolean {
  return (
    typeof container === "object"
    && container !== null
    && (container as { disposed?: unknown }).disposed === true
  );
}

function warnDisposedContainer(container: object): void {
  if (!diagnosticsEnabled() || warnedDisposed.has(container)) {
    return;
  }
  warnedDisposed.add(container);
  const name = (container as { name?: unknown }).name;
  console.warn(
    `[silent] runtime options: контейнер "${typeof name === "string" ? name : "?"}" освобождён; опции отброшены`,
  );
}

function readOwnerOptions(key: object): RuntimeOptions | undefined {
  const found = ownerOptions.get(key);
  if (found === undefined) {
    return undefined;
  }
  if (isDisposedContainer(found.container)) {
    ownerOptions.delete(key);
    warnDisposedContainer(found.container as object);
    return undefined;
  }
  return found;
}

function nodeOf(owner: Owner): OwnerNodeLink | null {
  const candidate = (owner as unknown as { node?: unknown }).node;
  if (candidate === null || typeof candidate !== "object") {
    return null;
  }
  if (!("parent" in candidate)) {
    return null;
  }
  return candidate as OwnerNodeLink;
}

export function bindOwnerRuntimeOptions(
  owner: Owner | null,
  options: RuntimeOptions,
): void {
  if (owner === null || owner.disposed) {
    return;
  }
  hasBoundOptions = true;
  ownerOptions.set(owner, options);
  const node = nodeOf(owner);
  if (node !== null) {
    ownerOptions.set(node, options);
  }
  if (!owner.disposed) {
    const boundContainer = options.container;
    const forget = (): void => {
      if (boundContainer !== undefined) {
        const current = ownerOptions.get(owner);
        if (current !== undefined && current.container !== boundContainer) {
          return;
        }
      }
      ownerOptions.delete(owner);
      if (node !== null) {
        ownerOptions.delete(node);
      }
    };
    // Освобождённый container не должен оставлять достижимые owner-опции:
    // чистим их и при dispose владельца, и при dispose самого контейнера.
    if (options.container !== undefined) {
      let containers = trackedContainers.get(owner);
      if (containers === undefined) {
        containers = new WeakSet<object>();
        trackedContainers.set(owner, containers);
      }
      if (!containers.has(options.container)) {
        containers.add(options.container);
        options.container.onDispose(forget);
      }
    } else if (!trackedOwners.has(owner)) {
      trackedOwners.add(owner);
      runWithOwner(owner, () => {
        onCleanup(forget);
      });
    }
  }
}

export function findOwnerRuntimeOptions(
  owner: Owner | null,
): RuntimeOptions | undefined {
  if (!hasBoundOptions || owner === null) {
    return undefined;
  }
  const direct = readOwnerOptions(owner);
  if (direct !== undefined) {
    return direct;
  }
  let node = nodeOf(owner);
  while (node !== null) {
    const found = readOwnerOptions(node);
    if (found !== undefined) {
      return found;
    }
    node = node.parent;
  }
  return undefined;
}

export function currentOwnerRuntimeOptions(): RuntimeOptions | undefined {
  return findOwnerRuntimeOptions(getOwner());
}

/**
 * Ищет ближайший к owner обработчик onError по цепочке owner-узлов.
 * Возвращает null, если обработчик не найден.
 *
 * Обработчик вызывается только с ошибкой: компонент-источник на этом уровне
 * неизвестен, а привязанные через withRuntimeOptions обработчики (например,
 * fallback ErrorBoundary) второй аргумент не используют.
 */
export function findOwnerErrorHandler(
  owner: Owner | null,
): ((error: unknown) => void) | null {
  if (!hasBoundOptions || owner === null) {
    return null;
  }
  const direct = readOwnerOptions(owner)?.onError;
  if (direct !== undefined) {
    return direct as (error: unknown) => void;
  }
  let node = nodeOf(owner);
  while (node !== null) {
    const found = readOwnerOptions(node)?.onError;
    if (found !== undefined) {
      return found as (error: unknown) => void;
    }
    node = node.parent;
  }
  return null;
}
