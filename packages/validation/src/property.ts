export function constructorOf(target: object): Function | null {
  const inherited: unknown = (target as { constructor?: unknown }).constructor;
  if (typeof inherited === "function") {
    return inherited;
  }
  const prototype: unknown = Object.getPrototypeOf(target);
  if (prototype === null || typeof prototype !== "object") {
    return null;
  }
  const ctor: unknown = (prototype as { constructor?: unknown }).constructor;
  return typeof ctor === "function" ? ctor : null;
}

function readInheritedAccessor(
  target: object,
  key: PropertyKey,
): unknown {
  let prototype: unknown = Object.getPrototypeOf(target);
  while (prototype !== null && prototype !== Object.prototype) {
    if (typeof prototype === "object") {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor !== undefined) {
        return "get" in descriptor || "set" in descriptor
          ? Reflect.get(target, key)
          : undefined;
      }
    }
    prototype = Object.getPrototypeOf(prototype as object);
  }
  return undefined;
}

export function readFieldValue(target: object, key: PropertyKey): unknown {
  const value = (target as Record<PropertyKey, unknown>)[key];
  if (typeof value !== "function" && key !== "__proto__") {
    return value;
  }
  const own = Object.getOwnPropertyDescriptor(target, key);
  if (own !== undefined) {
    return "value" in own ? own.value : Reflect.get(target, key);
  }
  return readInheritedAccessor(target, key);
}
