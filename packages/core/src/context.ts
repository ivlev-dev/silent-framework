import { createRoot, getOwner, type Owner } from "@ivlev-dev/silent-reactivity";
import { collectNodes } from "./dom.js";
import { registerContextLink } from "./context-link.js";
import type { Children } from "./jsx.js";

const NO_DEFAULT: unique symbol = Symbol("silent.context.none");
const MISSING: unique symbol = Symbol("silent.context.missing");

let linked = false;

function ensureContextLink(): void {
  if (linked) {
    return;
  }
  linked = true;
  registerContextLink({
    capture: captureContextValues,
    adopt: adoptContextValues,
  });
}

export class ContextMissingError extends Error {
  constructor(name: string) {
    super(`Контекст ${name} не найден: нет провайдера и значения по умолчанию`);
    this.name = "ContextMissingError";
  }
}

export interface ContextOptions<T> {
  readonly defaultValue?: T;
  readonly name?: string;
}

interface ContextFrame {
  readonly context: object;
  readonly value: unknown;
}

interface ContextRegistry {
  readonly scopes: WeakMap<object, Map<object, unknown>>;
  readonly frames: ContextFrame[];
  hasScopes: boolean;
}

interface OwnerNodeLink {
  readonly parent: OwnerNodeLink | null;
}

const REGISTRY_KEY = Symbol.for("silent.context.registry");

type RegistryHost = typeof globalThis & {
  [REGISTRY_KEY]?: ContextRegistry;
};

function registry(): ContextRegistry {
  const host = globalThis as RegistryHost;
  let found = host[REGISTRY_KEY];
  if (found === undefined) {
    found = {
      scopes: new WeakMap<object, Map<object, unknown>>(),
      frames: [],
      hasScopes: false,
    };
    host[REGISTRY_KEY] = found;
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

function valuesOf(registry: ContextRegistry, key: object): Map<object, unknown> {
  let values = registry.scopes.get(key);
  if (values === undefined) {
    values = new Map<object, unknown>();
    registry.scopes.set(key, values);
    registry.hasScopes = true;
  }
  return values;
}

function bindOwnerValue(
  registry: ContextRegistry,
  owner: Owner | null,
  context: object,
  value: unknown,
): void {
  if (owner === null) {
    return;
  }
  valuesOf(registry, owner).set(context, value);
  const node = nodeOf(owner);
  if (node !== null) {
    valuesOf(registry, node).set(context, value);
  }
}

function lookupOwnerValue(
  registry: ContextRegistry,
  context: object,
  owner: Owner | null,
): unknown | typeof MISSING {
  if (owner === null) {
    return MISSING;
  }
  const direct = registry.scopes.get(owner);
  if (direct !== undefined && direct.has(context)) {
    return direct.get(context);
  }
  let node = nodeOf(owner);
  while (node !== null) {
    const values = registry.scopes.get(node);
    if (values !== undefined && values.has(context)) {
      return values.get(context);
    }
    node = node.parent;
  }
  return MISSING;
}

interface Resolution<T> {
  readonly found: boolean;
  readonly value: T | undefined;
}

export interface BoundContext<T> {
  readonly context: Context<T>;
  get(): T;
  has(): boolean;
}

export class Context<T> {
  readonly #name: string;
  readonly #defaultValue: T | typeof NO_DEFAULT;

  constructor(options: ContextOptions<T> = {}) {
    ensureContextLink();
    this.#name = options.name ?? "Context";
    this.#defaultValue =
      "defaultValue" in options ? (options.defaultValue as T) : NO_DEFAULT;
  }

  get name(): string {
    return this.#name;
  }

  has(): boolean {
    if (this.#resolve().found) {
      return true;
    }
    return this.#defaultValue !== NO_DEFAULT;
  }

  get(): T {
    const resolution = this.#resolve();
    if (resolution.found) {
      return resolution.value as T;
    }
    if (this.#defaultValue !== NO_DEFAULT) {
      return this.#defaultValue;
    }
    throw new ContextMissingError(this.#name);
  }

  tryGet(): T | undefined {
    const resolution = this.#resolve();
    if (resolution.found) {
      return resolution.value as T;
    }
    return this.#defaultValue === NO_DEFAULT
      ? undefined
      : (this.#defaultValue as T);
  }

  provide<R>(value: T, fn: () => R): R {
    const state = registry();
    const frame: ContextFrame = { context: this, value };
    state.frames.push(frame);
    try {
      return createRoot(() => {
        bindOwnerValue(state, getOwner(), this, value);
        return fn();
      });
    } finally {
      const index = state.frames.lastIndexOf(frame);
      if (index !== -1) {
        state.frames.splice(index, 1);
      }
    }
  }

  bind(): BoundContext<T> {
    const value = this.get();
    return {
      context: this,
      has: (): boolean => true,
      get: (): T => value,
    };
  }

  #resolve(): Resolution<T> {
    const state = registry();
    const frames = state.frames;
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      if (frame !== undefined && frame.context === this) {
        return { found: true, value: frame.value as T };
      }
    }
    const value = lookupOwnerValue(state, this, getOwner());
    if (value !== MISSING) {
      return { found: true, value: value as T };
    }
    return { found: false, value: undefined };
  }
}

export function createContext<T>(options: ContextOptions<T> = {}): Context<T> {
  return new Context<T>(options);
}

export type ProviderChildren = unknown | (() => unknown);

export interface ProviderProps<T> {
  readonly context: Context<T>;
  readonly value: T;
  readonly children?: ProviderChildren;
}

function resolveChildren(value: ProviderChildren): unknown {
  let current: unknown = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

export function Provider<T>(props: ProviderProps<T>): Node {
  const container = document.createDocumentFragment();
  props.context.provide(props.value, () => {
    const nodes = collectNodes(resolveChildren(props.children) as Children);
    for (const node of nodes) {
      container.appendChild(node);
    }
  });
  return container;
}

export function captureContextValues(): Map<object, unknown> | null {
  const state = registry();
  if (!state.hasScopes && state.frames.length === 0) {
    return null;
  }
  const captured = new Map<object, unknown>();
  const owner = getOwner();
  if (owner !== null) {
    const chain: object[] = [];
    let node = nodeOf(owner);
    while (node !== null) {
      chain.push(node);
      node = node.parent;
    }
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const key = chain[index];
      if (key === undefined) {
        continue;
      }
      const values = state.scopes.get(key);
      if (values === undefined) {
        continue;
      }
      for (const [context, value] of values) {
        captured.set(context, value);
      }
    }
    const direct = state.scopes.get(owner);
    if (direct !== undefined) {
      for (const [context, value] of direct) {
        captured.set(context, value);
      }
    }
  }
  for (const frame of state.frames) {
    captured.set(frame.context, frame.value);
  }
  return captured.size === 0 ? null : captured;
}

export function adoptContextValues(
  owner: Owner | null,
  values: Map<object, unknown> | null,
): void {
  if (owner === null || values === null) {
    return;
  }
  const state = registry();
  for (const [context, value] of values) {
    bindOwnerValue(state, owner, context, value);
  }
}
