import { getOwner, type Owner } from "@ivlev-dev/silent-reactivity";
import type { RuntimeOptions } from "./component-state.js";

interface OwnerNodeLink {
  readonly parent: OwnerNodeLink | null;
}

const ownerOptions = new WeakMap<object, RuntimeOptions>();
let hasBoundOptions = false;

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
}

export function findOwnerRuntimeOptions(
  owner: Owner | null,
): RuntimeOptions | undefined {
  if (!hasBoundOptions || owner === null) {
    return undefined;
  }
  const direct = ownerOptions.get(owner);
  if (direct !== undefined) {
    return direct;
  }
  let node = nodeOf(owner);
  while (node !== null) {
    const found = ownerOptions.get(node);
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
  const direct = ownerOptions.get(owner)?.onError;
  if (direct !== undefined) {
    return direct as (error: unknown) => void;
  }
  let node = nodeOf(owner);
  while (node !== null) {
    const found = ownerOptions.get(node)?.onError;
    if (found !== undefined) {
      return found as (error: unknown) => void;
    }
    node = node.parent;
  }
  return null;
}
