import type {
  Accessor,
  EffectErrorHandler,
  MemoOptions,
  Owner,
  Setter,
  SignalOptions,
} from "./types.js";

type EqualityFn<T> = (a: T, b: T) => boolean;
type NodeState = 0 | 1 | 2;

const CLEAN: NodeState = 0;
const CHECK: NodeState = 1;
const DIRTY: NodeState = 2;
const MAX_FLUSH_ITERATIONS = 100000;

let reconcileStampSeq = 0;
let wakeStampSeq = 0;
let memoIdSeq = 0;

const defaultEffectErrorHandler: EffectErrorHandler = (error) => {
  console.error(error);
};

let effectErrorHandler: EffectErrorHandler | null = defaultEffectErrorHandler;

export function setEffectErrorHandler(
  handler: EffectErrorHandler | null,
): EffectErrorHandler | null {
  const previous = effectErrorHandler;
  effectErrorHandler = handler;
  return previous;
}

function reportEffectError(error: unknown): void {
  const handler = effectErrorHandler;
  if (handler === null) {
    return;
  }
  try {
    handler(error);
  } catch (handlerError) {
    console.error(handlerError);
  }
}

export class CircularComputationError extends Error {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`Circular memo computation detected: ${path.join(" -> ")}`);
    this.name = "CircularComputationError";
    this.path = path;
  }
}

interface SignalNode {
  readonly type: "signal";
  value: unknown;
  version: number;
  reconcileStamp: number;
  readonly equals: EqualityFn<unknown>;
  readonly observers: Set<ComputationNode>;
}

interface MemoNode {
  readonly type: "memo";
  value: unknown;
  version: number;
  reconcileStamp: number;
  readonly equals: EqualityFn<unknown>;
  readonly fn: () => unknown;
  readonly name: string;
  state: NodeState;
  disposed: boolean;
  initialized: boolean;
  running: boolean;
  failed: boolean;
  wakeStamp: number;
  readonly observers: Set<ComputationNode>;
  deps: SourceNode[] | null;
  depVersions: number[] | null;
  nextDepMap: Map<SourceNode, number> | null;
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
  nextDepMap: Map<SourceNode, number> | null;
  readonly owner: OwnerNode;
}

type SourceNode = SignalNode | MemoNode;
type ComputationNode = MemoNode | EffectNode;

interface OwnerNode {
  disposed: boolean;
  parent: OwnerNode | null;
  children: Set<OwnerNode> | null;
  cleanups: (() => void)[] | null;
  computation: ComputationNode | null;
}

export interface SignalHandle<T> {
  read(): T;
  peek(): T;
  write(value: T): T;
  hasObservers(): boolean;
}

let currentListener: ComputationNode | null = null;
let currentOwner: OwnerNode | null = null;

const pendingInitial = new Set<EffectNode>();
const effectQueue = new Set<EffectNode>();
const ownerRefs = new WeakMap<OwnerNode, Owner>();
const ownerNodes = new WeakMap<Owner, OwnerNode>();
const memoStack: MemoNode[] = [];

let flushScheduled = false;
let flushing = false;
let initialFlushing = false;
let batchDepth = 0;

function createSignalNode<T>(value: T, equals: EqualityFn<unknown>): SignalNode {
  return {
    type: "signal",
    value,
    version: 0,
    reconcileStamp: 0,
    equals,
    observers: new Set<ComputationNode>(),
  };
}

function trackDependency(node: SourceNode): void {
  const listener = currentListener;
  if (listener === null || listener.disposed) {
    return;
  }
  let nextDeps = listener.nextDepMap;
  if (nextDeps === null) {
    nextDeps = new Map<SourceNode, number>();
    listener.nextDepMap = nextDeps;
  }
  nextDeps.set(node, node.version);
}

function readSource(node: SourceNode): unknown {
  if (node.type === "memo") {
    if (node.disposed) {
      return node.value;
    }
    if (node.running) {
      throw circularError(node);
    }
    try {
      updateIfNecessary(node);
    } catch (error) {
      trackDependency(node);
      throw error;
    }
  }
  trackDependency(node);
  return node.value;
}

function circularError(node: MemoNode): CircularComputationError {
  const start = memoStack.indexOf(node);
  const active = start === -1 ? memoStack : memoStack.slice(start);
  const path = active.map((entry) => entry.name);
  path.push(node.name);
  return new CircularComputationError(path);
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
  if (node.disposed) {
    return;
  }
  if (node.state === DIRTY) {
    if (node.type === "memo" && node.failed) {
      node.failed = false;
      wakeObservers(node, ++wakeStampSeq);
    }
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

function wakeObservers(node: ComputationNode, stamp: number): void {
  if (node.type !== "memo") {
    return;
  }
  for (const observer of node.observers) {
    if (observer.disposed) {
      continue;
    }
    if (observer.type === "memo") {
      if (observer.wakeStamp === stamp) {
        continue;
      }
      if (observer.state === CLEAN) {
        observer.state = CHECK;
      }
      observer.wakeStamp = stamp;
      wakeObservers(observer, stamp);
    } else {
      if (observer.state === CLEAN) {
        observer.state = DIRTY;
      }
      queueEffect(observer);
    }
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
  let nextDeps = node.nextDepMap;
  if (nextDeps === null) {
    nextDeps = new Map<SourceNode, number>();
    node.nextDepMap = nextDeps;
  }
  nextDeps.clear();
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
  const nextMap = node.nextDepMap;
  const previousDeps = node.deps;
  const previousVersions = node.depVersions;
  if (nextMap === null || nextMap.size === 0) {
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
    return;
  }
  const nextDeps: SourceNode[] = [];
  const nextVersions: number[] = [];
  for (const [dep, version] of nextMap) {
    nextDeps.push(dep);
    nextVersions.push(version);
  }
  nextMap.clear();
  if (previousDeps === null) {
    for (const dep of nextDeps) {
      dep.observers.add(node);
    }
  } else {
    const presenceStamp = ++reconcileStampSeq;
    for (const dep of nextDeps) {
      dep.reconcileStamp = presenceStamp;
    }
    for (const dep of previousDeps) {
      if (dep.reconcileStamp !== presenceStamp) {
        dep.observers.delete(node);
      }
    }
    const previousStamp = ++reconcileStampSeq;
    for (const dep of previousDeps) {
      dep.reconcileStamp = previousStamp;
    }
    for (const dep of nextDeps) {
      if (dep.reconcileStamp !== previousStamp) {
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
}

function recomputeMemo(node: MemoNode): void {
  if (node.disposed) {
    return;
  }
  const previous = node.value;
  const wasInitialized = node.initialized;
  memoStack.push(node);
  try {
    resetOwner(node.owner);
    node.state = CLEAN;
    const next = runWithTracking(node, node.fn);
    node.initialized = true;
    node.failed = false;
    if (!wasInitialized || !node.equals(previous, next)) {
      node.value = next;
      node.version += 1;
      for (const observer of node.observers) {
        markCheck(observer);
      }
    }
  } catch (error) {
    node.state = DIRTY;
    node.failed = true;
    throw error;
  } finally {
    memoStack.pop();
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

function runQueuedEffect(node: EffectNode): void {
  if (node.disposed) {
    return;
  }
  try {
    updateIfNecessary(node);
  } catch (error) {
    if (node.state === DIRTY) {
      node.state = CLEAN;
    }
    reportEffectError(error);
  }
}

function flushInitialEffects(): void {
  if (pendingInitial.size === 0 || initialFlushing) {
    return;
  }
  initialFlushing = true;
  try {
    let iterations = 0;
    while (pendingInitial.size > 0) {
      const nodes = Array.from(pendingInitial);
      pendingInitial.clear();
      for (const node of nodes) {
        runQueuedEffect(node);
      }
      iterations += nodes.length;
      if (iterations > MAX_FLUSH_ITERATIONS) {
        throw new Error("Reactivity flush exceeded iteration limit");
      }
    }
  } finally {
    initialFlushing = false;
  }
}

function flushEffects(): void {
  if (flushing || initialFlushing) {
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
      runQueuedEffect(entry.value);
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
  node.nextDepMap?.clear();
  node.nextDepMap = null;
  disposeOwner(node.owner);
}

class OwnerRef implements Owner {
  constructor(private readonly node: OwnerNode) {}

  get disposed(): boolean {
    return this.node.disposed;
  }

  dispose(): void {
    disposeOwner(this.node);
  }
}

function toOwner(node: OwnerNode): Owner {
  const existing = ownerRefs.get(node);
  if (existing !== undefined) {
    return existing;
  }
  const ref: Owner = new OwnerRef(node);
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
    nextDepMap: null,
    owner,
  };
  owner.computation = node;
  if (owner.disposed) {
    node.disposed = true;
  }
  return node;
}

export function isTracking(): boolean {
  return currentListener !== null;
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
    hasObservers(): boolean {
      return node.observers.size > 0;
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
  const name =
    options?.name ?? (fn.name.length > 0 ? fn.name : `memo#${(memoIdSeq += 1)}`);
  const node: MemoNode = {
    type: "memo",
    value: undefined,
    version: 0,
    reconcileStamp: 0,
    equals: equality,
    fn: fn as () => unknown,
    name,
    state: DIRTY,
    disposed: false,
    initialized: false,
    running: false,
    failed: false,
    wakeStamp: 0,
    observers: new Set<ComputationNode>(),
    deps: null,
    depVersions: null,
    nextDepMap: null,
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

interface ProbeTracker {
  nextDepMap: Map<SourceNode, number> | null;
  disposed: boolean;
}

const trackerPool: ProbeTracker[] = [];
const holderPool: OwnerNode[] = [];
let probeDepth = 0;

function acquireTracker(): ProbeTracker {
  let tracker = trackerPool[probeDepth];
  if (tracker === undefined) {
    tracker = { nextDepMap: null, disposed: false };
    trackerPool.push(tracker);
  } else {
    tracker.nextDepMap?.clear();
    tracker.disposed = false;
  }
  probeDepth += 1;
  return tracker;
}

function acquireHolder(): OwnerNode {
  let holder = holderPool[probeDepth];
  if (holder === undefined) {
    holder = {
      disposed: false,
      parent: null,
      children: null,
      cleanups: null,
      computation: null,
    };
    holderPool.push(holder);
  } else {
    holder.disposed = false;
  }
  return holder;
}

function createEffectUnlessStatic(fn: () => void): (() => void) | null {
  const parentOwner = currentOwner;
  if (parentOwner !== null && parentOwner.disposed) {
    return null;
  }
  const holder = acquireHolder();
  const tracker = acquireTracker();
  const previousListener = currentListener;
  currentListener = tracker as unknown as ComputationNode;
  currentOwner = holder;
  try {
    fn();
  } catch (error) {
    currentListener = previousListener;
    currentOwner = parentOwner;
    probeDepth -= 1;
    tracker.nextDepMap?.clear();
    disposeOwner(holder);
    throw error;
  }
  currentListener = previousListener;
  currentOwner = parentOwner;
  probeDepth -= 1;
  const nextMap = tracker.nextDepMap;
  if (nextMap === null || nextMap.size === 0) {
    const children = holder.children;
    const cleanups = holder.cleanups;
    if (children === null && cleanups === null) {
      return null;
    }
    const owner = createOwnerNode(parentOwner);
    if (children !== null) {
      const target = (owner.children ??= new Set<OwnerNode>());
      for (const child of children) {
        child.parent = owner;
        target.add(child);
      }
      holder.children = null;
    }
    if (cleanups !== null) {
      owner.cleanups = cleanups;
      holder.cleanups = null;
    }
    return () => disposeOwner(owner);
  }
  const deps: SourceNode[] = [];
  const versions: number[] = [];
  for (const [dep, version] of nextMap) {
    deps.push(dep);
    versions.push(version);
  }
  nextMap.clear();
  const node = createEffectNode("renderEffect", fn);
  node.initialized = true;
  node.state = CLEAN;
  node.deps = deps;
  node.depVersions = versions;
  for (const dep of deps) {
    dep.observers.add(node);
  }
  const owner = node.owner;
  const children = holder.children;
  if (children !== null) {
    const target = (owner.children ??= new Set<OwnerNode>());
    for (const child of children) {
      child.parent = owner;
      target.add(child);
    }
    holder.children = null;
  }
  if (holder.cleanups !== null) {
    owner.cleanups = holder.cleanups;
    holder.cleanups = null;
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

const UNLESS_STATIC_EFFECT = Symbol.for("silent.effectUnlessStatic");
(createRoot as unknown as Record<symbol, unknown>)[UNLESS_STATIC_EFFECT] = createEffectUnlessStatic;
