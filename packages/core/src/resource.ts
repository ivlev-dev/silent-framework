import {
  createMemo,
  createRenderEffect,
  createSignal,
  onCleanup,
  type Accessor,
} from "@ivlev-dev/silent-reactivity";
import { getCurrentBoundary, type AsyncBoundary } from "./boundary.js";
import { trackAsyncWork } from "./component-state.js";
import {
  getRuntimeContextStore,
  type RuntimeContextStore,
} from "./runtime-context-provider.js";

export type ResourceStatus = "idle" | "pending" | "success" | "error";

export interface ResourceFetchContext {
  readonly signal: AbortSignal;
  readonly key: unknown;
}

export type ResourceFetcher<T> = (
  context: ResourceFetchContext,
) => T | Promise<T>;

/**
 * Опции `createResource`.
 *
 * Кэширование по `key`: клиент без явного `cache` использует общий модульный
 * кэш (`cacheTime` по умолчанию `Infinity`); активный SSR-рендер получает
 * отдельный кэш на запрос. Явный `cache: ResourceCache` используется и на
 * сервере (осознанный обмен данными между запросами), `cache: false` или
 * `cacheTime: 0` отключают кэш и in-flight дедупликацию.
 */
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
  /** Завершается отклонением, если текущий запрос завершился ошибкой. */
  readonly ready: Promise<void>;
  readonly key: Accessor<unknown>;
  read(): T | undefined;
  /**
   * Запускает запрос. Промис отклоняется ошибкой fetcher'а (после записи в
   * `error`/`status` и вызова `onError`); данные последнего успешного
   * запроса при этом сохраняются.
   */
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
const RESOLVED_READY: Promise<void> = /*#__PURE__*/ Promise.resolve();

function noop(): void {}

/**
 * Кэш ресурсов: записи по ключу плюс in-flight промисы для дедупликации.
 * Экземпляр можно передать в `createResource(..., { cache })`, чтобы осознанно
 * разделять данные между рендерами/запросами.
 */
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

/**
 * Общий кэш клиентского рантайма. На сервере без явного `options.cache`
 * не используется: иначе данные одного запроса попадали бы в другой.
 */
export const sharedResourceCache = /*#__PURE__*/ new ResourceCache();

/**
 * Кэши, привязанные к store одного SSR-рендера. WeakMap не продлевает жизнь
 * store и не требует ручной очистки: записи исчезают вместе с рендером.
 */
const serverResourceCaches = /*#__PURE__*/ new WeakMap<RuntimeContextStore, ResourceCache>();

function serverRenderStore(): RuntimeContextStore | null {
  const store = getRuntimeContextStore();
  return store !== null && store.server ? store : null;
}

function scopedServerCache(store: RuntimeContextStore): ResourceCache {
  let cache = serverResourceCaches.get(store);
  if (cache === undefined) {
    cache = new ResourceCache();
    serverResourceCaches.set(store, cache);
  }
  return cache;
}

export function createResourceCache(): ResourceCache {
  return new ResourceCache();
}

export function clearResourceCache(cache: ResourceCache = sharedResourceCache): void {
  cache.clear();
}

/**
 * Создаёт ресурс с асинхронными данными.
 *
 * Кэширование по `key`:
 * - клиент: общий `sharedResourceCache`, `cacheTime` по умолчанию `Infinity`;
 * - сервер (активный SSR-контекст): кэш текущего рендера, поэтому одинаковые
 *   ключи дедуплицируются внутри запроса, но не между запросами;
 * - явный `options.cache` (`ResourceCache`) используется и на сервере — это
 *   единственный способ осознанно разделить данные между SSR-запросами;
 * - `cache: false` или `cacheTime: 0` отключают кэш и in-flight дедупликацию.
 */
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
  const serverStore = serverRenderStore();
  const cache: ResourceCache | null =
    options.cache === false || !(cacheTime > 0)
      ? null
      : options.cache instanceof ResourceCache
        ? options.cache
        : serverStore !== null
          ? scopedServerCache(serverStore)
          : sharedResourceCache;
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
    if (hasKey(key) && cache !== null) {
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
          throw failure;
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
    if (hasKey(key) && cache !== null && dedupe) {
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
    if (hasKey(key) && cache !== null) {
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
      return active === null ? RESOLVED_READY : active.then(() => undefined);
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
          void refetch().catch(noop);
        }
        return;
      }
      if (!Object.is(key, previousKey)) {
        previousKey = key;
        void refetch().catch(noop);
      }
    });
  } else if (immediate) {
    void refetch().catch(noop);
  }

  if (options.disposeOnCleanup !== false) {
    onCleanup(dispose);
  }

  return resource;
}
