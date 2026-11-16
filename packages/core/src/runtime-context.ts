import { getOwner, type Owner } from "@ivlev-dev/silent-reactivity";
import type { RuntimeOptions } from "./component-state.js";

interface OwnerNodeLink {
  readonly parent: OwnerNodeLink | null;
}

const ownerOptions = new WeakMap<object, RuntimeOptions>();

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
  ownerOptions.set(owner, options);
  const node = nodeOf(owner);
  if (node !== null) {
    ownerOptions.set(node, options);
  }
}

export function findOwnerRuntimeOptions(
  owner: Owner | null,
): RuntimeOptions | undefined {
  if (owner === null) {
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
