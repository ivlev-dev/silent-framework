import { getOwner, onCleanup, runWithOwner, type Owner } from "@ivlev-dev/silent-reactivity";
import type { RuntimeOptions } from "./component-state.js";

interface OwnerNodeLink {
  readonly parent: OwnerNodeLink | null;
}

const ownerOptions = new WeakMap<object, RuntimeOptions>();
const trackedOwners = new WeakSet<object>();
const warnedDisposed = new WeakSet<object>();
let hasBoundOptions = false;

declare const __SILENT_DEV__: boolean | undefined;
const DEV = typeof __SILENT_DEV__ === "undefined" || __SILENT_DEV__;

function isDisposedContainer(container: unknown): boolean {
  return (
    typeof container === "object"
    && container !== null
    && (container as { disposed?: unknown }).disposed === true
  );
}

function warnDisposedContainer(container: object): void {
  if (!DEV || warnedDisposed.has(container)) {
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
  if (!trackedOwners.has(owner) && !owner.disposed) {
    trackedOwners.add(owner);
    // Удаляем owner-опции вместе с владельцем, иначе освобождённый
    // container остаётся достижимым и «протекает» в следующий рендер.
    runWithOwner(owner, () => {
      onCleanup(() => {
        ownerOptions.delete(owner);
        if (node !== null) {
          ownerOptions.delete(node);
        }
      });
    });
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
