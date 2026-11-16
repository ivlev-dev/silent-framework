import {
  createMemo,
  createRenderEffect,
  createSignal,
  onCleanup,
  type Accessor,
} from "@ivlev-dev/silent-reactivity";
import { getCurrentBoundary, type AsyncBoundary } from "./boundary.js";
import { trackAsyncWork } from "./component-state.js";

export type ResourceStatus = "idle" | "pending" | "success" | "error";

export interface ResourceFetchContext {
  readonly signal: AbortSignal;
  readonly key: unknown;
}

export type ResourceFetcher<T> = (
  context: ResourceFetchContext,
) => T | Promise<T>;

export interface ResourceOptions<T, K = unknown> {
  readonly key?: K | (() => K) | undefined;
  readonly initialValue?: T | undefined;
  readonly cache?: ResourceCache | false | undefined;
  readonly cacheTime?: number | undefined;
  readonly dedupe?: boolean | undefined;
  readonly immediate?: boolean | undefined;
  readonly throwOnError?: boolean | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly boundary?: AsyncBoundary | null | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly disposeOnCleanup?: boolean | undefined;
}

export interface Resource<T> {
  readonly data: Accessor<T | undefined>;
  readonly error: Accessor<unknown>;
  readonly pending: Accessor<boolean>;
  readonly status: Accessor<ResourceStatus>;
  readonly ready: Promise<void>;
  readonly key: Accessor<unknown>;
  read(): T | undefined;
  refetch(): Promise<T | undefined>;
  set(value: T): void;
  mutate(updater: (previous: T | undefined) => T): void;
  abort(reason?: unknown): void;
  dispose(): void;
}

interface CacheEntry {
  readonly data: unknown;
  readonly at: number;
}

const NO_ERROR = Symbol("silent.resource.noError");
const NO_KEY = Symbol("silent.resource.noKey");
const RESOLVED_READY: Promise<void> = Promise.resolve();

function noop(): void {}

export class ResourceCache {
  private readonly entries = new Map<unknown, CacheEntry>();
  private readonly inflight = new Map<unknown, Promise<unknown>>();

  get size(): number {
    return this.entries.size;
  }

  has(key: unknown): boolean {
    return this.entries.has(key);
  }

  read<T>(key: unknown): { readonly data: T; readonly at: number } | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    return { data: entry.data as T, at: entry.at };
  }

  get<T>(key: unknown): T | undefined {
    return this.read<T>(key)?.data;
  }

  set<T>(key: unknown, data: T): void {
    this.entries.set(key, { data, at: Date.now() });
  }

  delete(key: unknown): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /** @internal */
  inflightFor<T>(key: unknown): Promise<T | undefined> | undefined {
    return this.inflight.get(key) as Promise<T | undefined> | undefined;
  }

  /** @internal */
  trackInflight<T>(key: unknown, promise: Promise<T>): Promise<T> {
    this.inflight.set(key, promise);
    const release = (): void => {
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key);
      }
    };
    void promise.then(release, release);
    return promise;
  }
}

export const sharedResourceCache = new ResourceCache();

export function createResourceCache(): ResourceCache {
  return new ResourceCache();
}

export function clearResourceCache(cache: ResourceCache = sharedResourceCache): void {
  cache.clear();
}

export function createResource<T, K = unknown>(
  fetcher: (context: ResourceFetchContext) => T | Promise<T>,
  options: ResourceOptions<T, K> = {},
): Resource<T> {
  const [dataSignal, setData] = createSignal<T | undefined>(options.initialValue);
  const [errorSignal, setErrorSignal] = createSignal<unknown>(NO_ERROR);
  const [pendingSignal, setPending] = createSignal(false);
  const keySource = options.key;
  const [keySignal, setKeySignal] = createSignal<unknown>(
    typeof keySource === "function" ? undefined : keySource,
  );

  const cacheTime = options.cacheTime ?? Number.POSITIVE_INFINITY;
  const caching = options.cache !== false && cacheTime > 0;
  const cache: ResourceCache =
    options.cache instanceof ResourceCache ? options.cache : sharedResourceCache;
  const dedupe = options.dedupe !== false;
  const immediate = options.immediate !== false;
  const boundary =
    options.boundary !== undefined ? options.boundary : getCurrentBoundary();

  const status = createMemo<ResourceStatus>(() => {
    if (pendingSignal()) {
      return "pending";
    }
    if (errorSignal() !== NO_ERROR) {
      return "error";
    }
    return dataSignal() === undefined ? "idle" : "success";
  });

  const error: Accessor<unknown> = () => {
    const value = errorSignal();
    return value === NO_ERROR ? undefined : value;
  };

  let disposed = false;
  let requestId = 0;
  let activePromise: Promise<T | undefined> | null = null;
  let activeKey: unknown = NO_KEY;
  let activeController: AbortController | null = null;

  function resolveKey(): unknown {
    if (typeof keySource === "function") {
      return (keySource as () => unknown)();
    }
    return keySource;
  }

  function hasKey(key: unknown): boolean {
    return key !== undefined;
  }

  function expired(at: number): boolean {
    return Date.now() - at >= cacheTime;
  }

  function commitValue(key: unknown, value: T): void {
    setErrorSignal(NO_ERROR);
    setData(value);
    if (hasKey(key) && caching) {
      cache.set(key, value);
    }
  }

  function commitError(failure: unknown): void {
    setErrorSignal(failure);
    const handler = options.onError;
    if (handler !== undefined) {
      try {
        handler(failure);
      } catch (handlerError) {
        console.error(handlerError);
      }
    }
  }

  function observe(
    key: unknown,
    source: Promise<T | undefined>,
    signal: AbortSignal | null,
    release: () => void,
  ): Promise<T | undefined> {
    const id = (requestId += 1);
    setErrorSignal(NO_ERROR);
    setPending(true);
    const promise = source
      .then(
        (value: T | undefined): T | undefined => {
          if (disposed || id !== requestId) {
            return dataSignal();
          }
          if (signal !== null && signal.aborted) {
            return dataSignal();
          }
          if (value === undefined) {
            return dataSignal();
          }
          commitValue(key, value);
          return value;
        },
        (failure: unknown): T | undefined => {
          if (disposed || id !== requestId) {
            return dataSignal();
          }
          if (signal !== null && signal.aborted) {
            return dataSignal();
          }
          commitError(failure);
          return dataSignal();
        },
      )
      .finally(() => {
        release();
        if (id === requestId) {
          activePromise = null;
          activeKey = NO_KEY;
          setPending(false);
        }
      });
    activePromise = promise;
    activeKey = key;
    return promise;
  }

  function start(key: unknown): Promise<T | undefined> {
    const controller = new AbortController();
    activeController = controller;
    const external = options.signal;
    const forward = (): void => {
      controller.abort(external?.reason);
    };
    if (external !== undefined) {
      if (external.aborted) {
        controller.abort(external.reason);
      } else {
        external.addEventListener("abort", forward, { once: true });
      }
    }
    let source: Promise<T | undefined>;
    try {
      source = Promise.resolve(fetcher({ signal: controller.signal, key }));
    } catch (failure) {
      source = Promise.reject(failure);
    }
    const promise = observe(key, source, controller.signal, () => {
      external?.removeEventListener("abort", forward);
      if (activeController === controller) {
        activeController = null;
      }
    });
    const tracked = trackAsyncWork(promise, controller.signal);
    boundary?.register(tracked.then(noop, noop));
    if (hasKey(key) && caching && dedupe) {
      cache.trackInflight(key, promise);
    }
    return promise;
  }

  function supersede(): void {
    if (activePromise === null && activeController === null) {
      return;
    }
    requestId += 1;
    const controller = activeController;
    activeController = null;
    activePromise = null;
    activeKey = NO_KEY;
    controller?.abort();
    setPending(false);
  }

  function refetch(): Promise<T | undefined> {
    if (disposed) {
      return Promise.resolve(dataSignal());
    }
    const key = resolveKey();
    setKeySignal(key);
    if (dedupe && activePromise !== null && Object.is(activeKey, key)) {
      return activePromise;
    }
    supersede();
    if (hasKey(key) && caching) {
      const cached = cache.read<T>(key);
      if (cached !== undefined) {
        if (!expired(cached.at)) {
          setErrorSignal(NO_ERROR);
          setData(cached.data);
          return Promise.resolve(cached.data);
        }
        cache.delete(key);
      }
      if (dedupe) {
        const shared = cache.inflightFor<T>(key);
        if (shared !== undefined) {
          const adopted = observe(key, shared, null, noop);
          const tracked = trackAsyncWork(adopted, null);
          boundary?.register(tracked.then(noop, noop));
          return adopted;
        }
      }
    }
    return start(key);
  }

  function set(value: T): void {
    if (disposed) {
      return;
    }
    const key = resolveKey();
    setKeySignal(key);
    commitValue(key, value);
    setPending(false);
  }

  function mutate(updater: (previous: T | undefined) => T): void {
    set(updater(dataSignal()));
  }

  function abort(reason?: unknown): void {
    requestId += 1;
    const controller = activeController;
    activeController = null;
    activePromise = null;
    activeKey = NO_KEY;
    controller?.abort(reason);
    if (!disposed) {
      setPending(false);
    }
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    requestId += 1;
    activeController?.abort();
    activeController = null;
    activePromise = null;
    activeKey = NO_KEY;
    setPending(false);
  }

  function read(): T | undefined {
    const failure = errorSignal();
    if (failure !== NO_ERROR && options.throwOnError === true) {
      throw failure;
    }
    return dataSignal();
  }

  const resource: Resource<T> = {
    data: dataSignal,
    error,
    pending: pendingSignal,
    status,
    get ready(): Promise<void> {
      const active = activePromise;
      return active === null ? RESOLVED_READY : active.then(noop, noop);
    },
    key: keySignal,
    read,
    refetch,
    set,
    mutate,
    abort,
    dispose,
  };

  if (typeof keySource === "function") {
    let primed = false;
    let previousKey: unknown = NO_KEY;
    createRenderEffect(() => {
      const key = (keySource as () => K)();
      if (!primed) {
        primed = true;
        previousKey = key;
        if (immediate) {
          void refetch();
        }
        return;
      }
      if (!Object.is(key, previousKey)) {
        previousKey = key;
        void refetch();
      }
    });
  } else if (immediate) {
    void refetch();
  }

  if (options.disposeOnCleanup !== false) {
    onCleanup(dispose);
  }

  return resource;
}
