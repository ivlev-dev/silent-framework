import type { Accessor, MemoOptions, Owner, Setter, SignalOptions } from "./types.js";

type EqualityFn<T> = (a: T, b: T) => boolean;
type NodeState = 0 | 1 | 2;

const CLEAN: NodeState = 0;
const CHECK: NodeState = 1;
const DIRTY: NodeState = 2;
const MAX_FLUSH_ITERATIONS = 100000;

interface SignalNode {
  readonly type: "signal";
  value: unknown;
  version: number;
  readonly equals: EqualityFn<unknown>;
  readonly observers: Set<ComputationNode>;
}

interface MemoNode {
  readonly type: "memo";
  value: unknown;
  version: number;
  readonly equals: EqualityFn<unknown>;
  readonly fn: () => unknown;
  state: NodeState;
  disposed: boolean;
  initialized: boolean;
  running: boolean;
  readonly observers: Set<ComputationNode>;
  deps: SourceNode[] | null;
  depVersions: number[] | null;
  nextDeps: SourceNode[] | null;
  nextDepVersions: number[] | null;
  readonly owner: OwnerNode;
}

interface EffectNode {
  readonly type: "effect" | "renderEffect";
  readonly fn: () => void;
  state: NodeState;
  disposed: boolean;
  initialized: boolean;
  running: boolean;
  deps: SourceNode[] | null;
  depVersions: number[] | null;
  nextDeps: SourceNode[] | null;
  nextDepVersions: number[] | null;
  readonly owner: OwnerNode;
}

type SourceNode = SignalNode | MemoNode;
type ComputationNode = MemoNode | EffectNode;

interface OwnerNode {
  disposed: boolean;
  readonly parent: OwnerNode | null;
  children: Set<OwnerNode> | null;
  cleanups: (() => void)[] | null;
  computation: ComputationNode | null;
}

export interface SignalHandle<T> {
  read(): T;
  peek(): T;
  write(value: T): T;
}

let currentListener: ComputationNode | null = null;
let currentOwner: OwnerNode | null = null;

const pendingInitial = new Set<EffectNode>();
const effectQueue = new Set<EffectNode>();
const ownerRefs = new WeakMap<OwnerNode, Owner>();
const ownerNodes = new WeakMap<Owner, OwnerNode>();

let flushScheduled = false;
let flushing = false;
let batchDepth = 0;

function createSignalNode<T>(value: T, equals: EqualityFn<unknown>): SignalNode {
  return {
    type: "signal",
    value,
    version: 0,
    equals,
    observers: new Set<ComputationNode>(),
  };
}

function readSource(node: SourceNode): unknown {
  if (node.type === "memo") {
    if (node.disposed) {
      return node.value;
    }
    updateIfNecessary(node);
  }
  const listener = currentListener;
  if (listener !== null && !listener.disposed) {
    let nextDeps = listener.nextDeps;
    let nextVersions = listener.nextDepVersions;
    if (nextDeps === null || nextVersions === null) {
      nextDeps = [];
      nextVersions = [];
      listener.nextDeps = nextDeps;
      listener.nextDepVersions = nextVersions;
    }
    const existing = nextDeps.indexOf(node);
    if (existing === -1) {
      nextDeps.push(node);
      nextVersions.push(node.version);
    } else {
      nextVersions[existing] = node.version;
    }
  }
  return node.value;
}

function writeSource(node: SignalNode, value: unknown): void {
  if (node.equals(node.value, value)) {
    return;
  }
  node.value = value;
  node.version += 1;
  for (const observer of node.observers) {
    markDirty(observer);
  }
}

function markDirty(node: ComputationNode): void {
  if (node.disposed || node.state === DIRTY) {
    return;
  }
  node.state = DIRTY;
  if (node.type === "memo") {
    for (const observer of node.observers) {
      markCheck(observer);
    }
  } else {
    queueEffect(node);
  }
}

function markCheck(node: ComputationNode): void {
  if (node.disposed || node.state !== CLEAN) {
    return;
  }
  node.state = CHECK;
  if (node.type === "memo") {
    for (const observer of node.observers) {
      markCheck(observer);
    }
  } else {
    queueEffect(node);
  }
}

function depsChanged(node: ComputationNode): boolean {
  const deps = node.deps;
  const depVersions = node.depVersions;
  if (deps === null || depVersions === null) {
    return false;
  }
  for (let index = 0; index < deps.length; index += 1) {
    const dep = deps[index];
    const version = depVersions[index];
    if (dep === undefined || version === undefined) {
      continue;
    }
    if (dep.type === "memo") {
      if (dep.disposed) {
        return true;
      }
      updateIfNecessary(dep);
    }
    if (dep.version !== version) {
      return true;
    }
  }
  return false;
}

function updateIfNecessary(node: ComputationNode): void {
  if (node.disposed || node.state === CLEAN) {
    return;
  }
  if (node.state === CHECK && !depsChanged(node)) {
    node.state = CLEAN;
    return;
  }
  if (node.type === "memo") {
    recomputeMemo(node);
  } else {
    runEffect(node);
  }
}

function runWithTracking<T>(node: ComputationNode, fn: () => T): T {
  const previousListener = currentListener;
  const previousOwner = currentOwner;
  currentListener = node;
  currentOwner = node.owner;
  node.running = true;
  try {
    return fn();
  } finally {
    node.running = false;
    currentListener = previousListener;
    currentOwner = previousOwner;
    reconcileDependencies(node);
  }
}

function reconcileDependencies(node: ComputationNode): void {
  const nextDeps = node.nextDeps;
  const nextVersions = node.nextDepVersions;
  if (nextDeps === null) {
    const previousDeps = node.deps;
    const previousVersions = node.depVersions;
    if (previousDeps !== null) {
      for (const dep of previousDeps) {
        dep.observers.delete(node);
      }
      previousDeps.length = 0;
    }
    if (previousVersions !== null) {
      previousVersions.length = 0;
    }
    node.deps = null;
    node.depVersions = null;
    node.nextDeps = null;
    node.nextDepVersions = null;
    return;
  }
  if (nextVersions === null) {
    node.nextDeps = null;
    return;
  }
  const previousDeps = node.deps;
  const previousVersions = node.depVersions;
  if (previousDeps === null) {
    for (const dep of nextDeps) {
      dep.observers.add(node);
    }
  } else {
    for (const dep of previousDeps) {
      if (nextDeps.indexOf(dep) === -1) {
        dep.observers.delete(node);
      }
    }
    for (const dep of nextDeps) {
      if (previousDeps.indexOf(dep) === -1) {
        dep.observers.add(node);
      }
    }
    previousDeps.length = 0;
  }
  if (previousVersions !== null) {
    previousVersions.length = 0;
  }
  node.deps = nextDeps;
  node.depVersions = nextVersions;
  node.nextDeps = null;
  node.nextDepVersions = null;
}

function recomputeMemo(node: MemoNode): void {
  if (node.disposed) {
    return;
  }
  resetOwner(node.owner);
  node.state = CLEAN;
  const previous = node.value;
  const wasInitialized = node.initialized;
  const next = runWithTracking(node, node.fn);
  node.initialized = true;
  if (!wasInitialized || !node.equals(previous, next)) {
    node.value = next;
    node.version += 1;
    for (const observer of node.observers) {
      markCheck(observer);
    }
  }
}

function runEffect(node: EffectNode): void {
  if (node.disposed) {
    return;
  }
  resetOwner(node.owner);
  node.state = CLEAN;
  node.initialized = true;
  runWithTracking(node, node.fn);
}

function queueEffect(node: EffectNode): void {
  if (node.disposed) {
    return;
  }
  if (node.initialized) {
    effectQueue.add(node);
  } else {
    pendingInitial.add(node);
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    flushInitialEffects();
    flushEffects();
  });
}

function flushInitialEffects(): void {
  if (pendingInitial.size === 0) {
    return;
  }
  const nodes = Array.from(pendingInitial);
  pendingInitial.clear();
  for (const node of nodes) {
    if (!node.disposed) {
      updateIfNecessary(node);
    }
  }
}

function flushEffects(): void {
  if (flushing) {
    return;
  }
  flushing = true;
  try {
    let iterations = 0;
    while (effectQueue.size > 0) {
      const entry = effectQueue.values().next();
      if (entry.done === true) {
        break;
      }
      effectQueue.delete(entry.value);
      if (!entry.value.disposed) {
        updateIfNecessary(entry.value);
      }
      iterations += 1;
      if (iterations > MAX_FLUSH_ITERATIONS) {
        throw new Error("Reactivity flush exceeded iteration limit");
      }
    }
  } finally {
    flushing = false;
  }
}

function createOwnerNode(parent: OwnerNode | null): OwnerNode {
  const node: OwnerNode = {
    disposed: parent !== null && parent.disposed,
    parent,
    children: null,
    cleanups: null,
    computation: null,
  };
  if (parent !== null && !parent.disposed) {
    (parent.children ??= new Set<OwnerNode>()).add(node);
  }
  return node;
}

function runCleanups(owner: OwnerNode): void {
  const cleanups = owner.cleanups;
  if (cleanups === null) {
    return;
  }
  owner.cleanups = null;
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    const cleanup = cleanups[index];
    if (cleanup !== undefined) {
      cleanup();
    }
  }
}

function disposeOwnerChildren(owner: OwnerNode): void {
  const children = owner.children;
  if (children === null) {
    return;
  }
  owner.children = null;
  for (const child of children) {
    if (child.computation !== null) {
      disposeComputation(child.computation);
    } else {
      disposeOwner(child);
    }
  }
}

function resetOwner(owner: OwnerNode): void {
  runCleanups(owner);
  disposeOwnerChildren(owner);
}

function disposeOwner(owner: OwnerNode): void {
  if (owner.disposed) {
    return;
  }
  owner.disposed = true;
  runCleanups(owner);
  disposeOwnerChildren(owner);
  if (owner.parent !== null) {
    owner.parent.children?.delete(owner);
  }
}

function disposeComputation(node: ComputationNode): void {
  if (node.disposed) {
    return;
  }
  node.disposed = true;
  if (node.type === "memo") {
    node.observers.clear();
  } else {
    effectQueue.delete(node);
    pendingInitial.delete(node);
  }
  const deps = node.deps;
  if (deps !== null) {
    for (const dep of deps) {
      dep.observers.delete(node);
    }
    deps.length = 0;
  }
  const depVersions = node.depVersions;
  if (depVersions !== null) {
    depVersions.length = 0;
  }
  node.deps = null;
  node.depVersions = null;
  node.nextDeps = null;
  node.nextDepVersions = null;
  disposeOwner(node.owner);
}

function toOwner(node: OwnerNode): Owner {
  const existing = ownerRefs.get(node);
  if (existing !== undefined) {
    return existing;
  }
  const ref: Owner = {
    get disposed(): boolean {
      return node.disposed;
    },
    dispose(): void {
      disposeOwner(node);
    },
  };
  ownerRefs.set(node, ref);
  ownerNodes.set(ref, node);
  return ref;
}

function createEffectNode(type: "effect" | "renderEffect", fn: () => void): EffectNode {
  const owner = createOwnerNode(currentOwner);
  const node: EffectNode = {
    type,
    fn,
    state: DIRTY,
    disposed: false,
    initialized: false,
    running: false,
    deps: null,
    depVersions: null,
    nextDeps: null,
    nextDepVersions: null,
    owner,
  };
  owner.computation = node;
  if (owner.disposed) {
    node.disposed = true;
  }
  return node;
}

export function createSignalHandle<T>(
  value: T,
  equals?: (a: T, b: T) => boolean,
): SignalHandle<T> {
  const equality: EqualityFn<unknown> =
    equals === undefined ? Object.is : (a, b) => equals(a as T, b as T);
  const node = createSignalNode(value, equality);
  return {
    read(): T {
      return readSource(node) as T;
    },
    peek(): T {
      return node.value as T;
    },
    write(next: T): T {
      writeSource(node, next);
      return next;
    },
  };
}

export function createSignal<T>(
  value: T,
  options?: SignalOptions<T>,
): [Accessor<T>, Setter<T>] {
  const equals = options?.equals;
  const equality: EqualityFn<unknown> =
    equals === undefined ? Object.is : (a, b) => equals(a as T, b as T);
  const node = createSignalNode(value, equality);
  const accessor: Accessor<T> = () => readSource(node) as T;
  const setter: Setter<T> = (next) => {
    const resolved: T =
      typeof next === "function"
        ? (next as (prev: T) => T)(node.value as T)
        : next;
    writeSource(node, resolved);
    return resolved;
  };
  return [accessor, setter];
}

export function createMemo<T>(fn: () => T, options?: MemoOptions<T>): Accessor<T> {
  const equalsOption = options?.equals;
  const equality: EqualityFn<unknown> =
    equalsOption === undefined
      ? Object.is
      : (a, b) => equalsOption(a as T, b as T);
  const owner = createOwnerNode(currentOwner);
  const node: MemoNode = {
    type: "memo",
    value: undefined,
    version: 0,
    equals: equality,
    fn: fn as () => unknown,
    state: DIRTY,
    disposed: false,
    initialized: false,
    running: false,
    observers: new Set<ComputationNode>(),
    deps: null,
    depVersions: null,
    nextDeps: null,
    nextDepVersions: null,
    owner,
  };
  owner.computation = node;
  if (owner.disposed) {
    node.disposed = true;
  }
  return () => readSource(node) as T;
}

export function createEffect(fn: () => void): void {
  const node = createEffectNode("effect", fn);
  queueEffect(node);
}

export function createRenderEffect(fn: () => void): void {
  const node = createEffectNode("renderEffect", fn);
  runEffect(node);
}

function createScopedRenderEffect(fn: () => void): () => void {
  const node = createEffectNode("renderEffect", fn);
  try {
    runEffect(node);
  } catch (error) {
    disposeComputation(node);
    throw error;
  }
  return () => disposeComputation(node);
}

export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner = createOwnerNode(currentOwner);
  const previousOwner = currentOwner;
  currentOwner = owner;
  try {
    return fn(() => disposeOwner(owner));
  } catch (error) {
    disposeOwner(owner);
    throw error;
  } finally {
    currentOwner = previousOwner;
  }
}

export function getOwner(): Owner | null {
  return currentOwner === null ? null : toOwner(currentOwner);
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const node = owner === null ? null : ownerNodes.get(owner) ?? null;
  const previousOwner = currentOwner;
  currentOwner = node;
  try {
    return fn();
  } finally {
    currentOwner = previousOwner;
  }
}

export function onCleanup(fn: () => void): void {
  if (currentOwner === null) {
    return;
  }
  if (currentOwner.disposed) {
    fn();
    return;
  }
  (currentOwner.cleanups ??= []).push(fn);
}

export function untrack<T>(fn: () => T): T {
  const previousListener = currentListener;
  currentListener = null;
  try {
    return fn();
  } finally {
    currentListener = previousListener;
  }
}

export function batch<T>(fn: () => T): T {
  batchDepth += 1;
  try {
    return fn();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0) {
      flushEffects();
    }
  }
}

export function flushSync(): void {
  flushInitialEffects();
  flushEffects();
}

const SCOPED_EFFECT = Symbol.for("silent.scopedRenderEffect");
(createRoot as unknown as Record<symbol, unknown>)[SCOPED_EFFECT] = createScopedRenderEffect;
