import { availableParallelism } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  MessageChannel,
  Worker,
  type MessagePort,
  type ResourceLimits,
} from "node:worker_threads";
import type { RenderResult } from "../render.js";
import {
  PoolError,
  abortedPoolError,
  poolClosedAbortError,
  poolClosedError,
  timeoutPoolError,
} from "./errors.js";
import {
  POOL_PROTOCOL,
  isProtocolCompatible,
  isWireError,
  reviveError,
  type EntryCapabilities,
  type MainToWorker,
  type StreamMainMessage,
  type StreamWorkerMessage,
  type WorkerData,
  type WorkerToMain,
} from "./protocol.js";

/** Возможности entry-модуля, которые пул публикует в `worker:ready`. */
export type { EntryCapabilities } from "./protocol.js";

export type PoolState =
  | "idle"
  | "booting"
  | "ready"
  | "closing"
  | "closed"
  | "failed";

export interface PoolRenderOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface PoolStreamOptions extends PoolRenderOptions {
  readonly idleTimeoutMs?: number | undefined;
  readonly highWaterMark?: number | undefined;
  readonly maxBufferedChars?: number | undefined;
  readonly onHead?:
    | ((head: string, info: { readonly final: boolean }) => void)
    | undefined;
  readonly onShell?: ((info: { readonly bytes: number }) => void) | undefined;
}

export interface RenderPoolOptions {
  readonly workers?: number | undefined;
  readonly warmup?: "lazy" | "eager" | undefined;
  readonly timeoutMs?: number | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly terminateGraceMs?: number | undefined;
  readonly maxQueue?: number | undefined;
  readonly maxTasksPerWorker?: number | undefined;
  readonly name?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly execArgv?: readonly string[] | undefined;
  readonly resourceLimits?: ResourceLimits | undefined;
  readonly onEvent?: ((event: PoolEvent) => void) | undefined;
  readonly onError?: ((error: unknown, info: PoolErrorInfo) => void) | undefined;
}

export interface StreamSummary {
  readonly head: string;
  readonly finalHead: string;
  readonly chunks: number;
  readonly chars: number;
  readonly durationMs: number;
  readonly workerId: number;
}

export interface StreamHandle {
  readonly stream: ReadableStream<string>;
  readonly head: Promise<string>;
  readonly finalHead: Promise<string>;
  readonly done: Promise<StreamSummary>;
  cancel(reason?: unknown): void;
}

export interface PoolWorkersStats {
  readonly total: number;
  readonly booting: number;
  readonly idle: number;
  readonly busy: number;
}

export interface PoolStats {
  readonly state: PoolState;
  readonly workers: PoolWorkersStats;
  readonly queueDepth: number;
  readonly completed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly aborted: number;
  readonly rejectedOverflow: number;
  readonly restarts: number;
  readonly deaths: number;
  readonly staleMessages: number;
}

export type PoolEvent =
  | { readonly type: "worker:spawn"; readonly workerId: number }
  | {
      readonly type: "worker:ready";
      readonly workerId: number;
      readonly capabilities: EntryCapabilities;
    }
  | {
      readonly type: "worker:exit";
      readonly workerId: number;
      readonly code: number;
      readonly expected: boolean;
    }
  | {
      readonly type: "worker:restart";
      readonly workerId: number;
      readonly reason: string;
    }
  | {
      readonly type: "job:queued";
      readonly jobId: number;
      readonly kind: "render" | "stream";
    }
  | {
      readonly type: "job:start";
      readonly jobId: number;
      readonly kind: "render" | "stream";
      readonly workerId: number;
    }
  | {
      readonly type: "job:finish";
      readonly jobId: number;
      readonly kind: "render" | "stream";
      readonly ok: boolean;
      readonly durationMs: number;
    }
  | {
      readonly type: "job:timeout";
      readonly jobId: number;
      readonly kind: "render" | "stream";
      readonly timeoutMs: number;
    }
  | {
      readonly type: "job:abort";
      readonly jobId: number;
      readonly kind: "render" | "stream";
      readonly reason?: string;
    }
  | { readonly type: "pool:closed" }
  | { readonly type: "pool:failed"; readonly error: unknown };

export interface PoolErrorInfo {
  readonly source: "worker" | "event" | "callback";
  readonly workerId?: number;
  readonly event?: PoolEvent;
}

export interface RenderPool<
  Args extends readonly unknown[] = readonly unknown[],
> {
  readonly workers: number;
  readonly name: string;
  readonly state: PoolState;
  render(args: Args, options?: PoolRenderOptions): Promise<RenderResult>;
  renderStream(args: Args, options?: PoolStreamOptions): StreamHandle;
  ready(): Promise<void>;
  stats(): PoolStats;
  close(options?: { force?: boolean; timeoutMs?: number }): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

/** Минимальная поверхность воркера, нужная планировщику. */
export interface PoolWorker {
  postMessage(message: unknown, transferList?: readonly unknown[]): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(
    event: string,
    listener: (...args: any[]) => void,
  ): unknown;
  terminate(): void | Promise<unknown>;
}

export interface WorkerCreateContext {
  readonly workerId: number;
  readonly workerData: WorkerData;
  readonly protocol: number;
  readonly entryUrl: string;
  readonly name?: string;
}

export type WorkerFactory = (
  context: WorkerCreateContext,
  workerId: number,
) => PoolWorker;

export interface PoolInternal {
  readonly workerFactory?: WorkerFactory | undefined;
}

interface NormalizedOptions {
  readonly workers: number;
  readonly warmup: "lazy" | "eager";
  readonly timeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly terminateGraceMs: number;
  readonly maxQueue: number;
  readonly maxTasksPerWorker: number;
  readonly name: string;
  readonly env: NodeJS.ProcessEnv | undefined;
  readonly execArgv: readonly string[] | undefined;
  readonly resourceLimits: ResourceLimits | undefined;
  readonly onEvent: ((event: PoolEvent) => void) | undefined;
  readonly onError:
    | ((error: unknown, info: PoolErrorInfo) => void)
    | undefined;
}

type Timer = ReturnType<typeof setTimeout>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
  readonly settled: boolean;
}

function createDeferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const deferred: Deferred<T> = {
    promise,
    resolve(value: T): void {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise(value);
    },
    reject(reason: unknown): void {
      if (settled) {
        return;
      }
      settled = true;
      rejectPromise(reason);
    },
    get settled(): boolean {
      return settled;
    },
  };
  void promise.catch(() => undefined);
  return deferred;
}

function unref(timer: Timer): void {
  (timer as { unref?: () => void }).unref?.();
}

function clonePoolError(error: PoolError): PoolError {
  return new PoolError(error.code, error.message, {
    ...(error.cause !== undefined ? { cause: error.cause } : {}),
    name: error.name,
  });
}

function isDebugEnabled(): boolean {
  const flags = globalThis as unknown as { __SILENT_POOL_DEBUG__?: boolean };
  return (
    process.env.SILENT_POOL_DEBUG === "1" || flags.__SILENT_POOL_DEBUG__ === true
  );
}

function errorDetails(error: unknown): {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
} {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { name?: unknown; message?: unknown; code?: unknown };
    return {
      name: typeof candidate.name === "string" ? candidate.name : "Error",
      message: typeof candidate.message === "string" ? candidate.message : String(error),
      ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

function infoDetails(info: PoolErrorInfo): Record<string, unknown> {
  return {
    source: info.source,
    ...(info.workerId !== undefined ? { workerId: info.workerId } : {}),
    ...(info.event !== undefined ? { event: info.event.type } : {}),
  };
}

function reasonText(reason: unknown): string | undefined {
  if (reason === undefined) {
    return undefined;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === "string") {
    return reason;
  }
  return String(reason);
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "AbortError" || candidate.code === "aborted";
}

const MAX_ARGS_UNITS = 8 * 1024 * 1024;
const MAX_ARGS_DEPTH = 64;

function argsLimitFailure(args: readonly unknown[]): PoolError | null {
  const seen = new WeakSet<object>();
  let units = 0;

  const charge = (amount: number): boolean => {
    units += amount;
    return units <= MAX_ARGS_UNITS;
  };

  const visit = (value: unknown, depth: number): boolean => {
    if (depth > MAX_ARGS_DEPTH) {
      return false;
    }
    const type = typeof value;
    if (value === null || value === undefined) {
      return charge(4);
    }
    if (type === "string") {
      return charge((value as string).length);
    }
    if (type === "number" || type === "boolean") {
      return charge(8);
    }
    if (type === "bigint") {
      return charge(String(value).length);
    }
    if (type !== "object") {
      // Функции/символы отклонит structuredClone с DataCloneError.
      return true;
    }
    const object = value as object;
    if (seen.has(object)) {
      return true;
    }
    seen.add(object);
    if (ArrayBuffer.isView(object)) {
      return charge((object as ArrayBufferView).byteLength);
    }
    if (object instanceof ArrayBuffer) {
      return charge(object.byteLength);
    }
    if (object instanceof Date || object instanceof RegExp) {
      return charge(16);
    }
    if (object instanceof Map) {
      for (const [key, item] of object) {
        if (!visit(key, depth + 1) || !visit(item, depth + 1)) {
          return false;
        }
      }
      return true;
    }
    if (object instanceof Set) {
      for (const item of object) {
        if (!visit(item, depth + 1)) {
          return false;
        }
      }
      return true;
    }
    return visitOwnProperties(object, depth);
  };

  // Обходим только собственные дескрипторы: getters не вызываются (их вызов
  // остаётся на structuredClone, чей throw ловится в dataCloneFailure).
  const visitOwnProperties = (object: object, depth: number): boolean => {
    for (const key of Reflect.ownKeys(object)) {
      if (typeof key === "symbol") {
        // structuredClone игнорирует символьные ключи; считаем для запаса.
        if (!charge(8)) {
          return false;
        }
        continue;
      }
      if (!charge(key.length)) {
        return false;
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      if (descriptor === undefined) {
        continue;
      }
      if (!("value" in descriptor)) {
        // Accessor: сам getter не трогаем, иначе аргумент может бросить
        // синхронно ещё до создания job.
        if (!charge(8)) {
          return false;
        }
        continue;
      }
      if (!visit(descriptor.value, depth + 1)) {
        return false;
      }
    }
    return true;
  };

  try {
    for (const arg of args) {
      if (!visit(arg, 0)) {
        return new PoolError(
          "args-not-cloneable",
          `Аргументы рендера превышают лимит (${MAX_ARGS_UNITS} единиц / глубина ${MAX_ARGS_DEPTH})`,
        );
      }
    }
  } catch (error) {
    // Proxy/getter может бросить из ownKeys, дескриптора или итератора Map/Set.
    // Контракт render()/renderStream() — только Promise/StreamHandle, поэтому
    // синхронный throw превращаем в PoolError.
    return new PoolError(
      "args-not-cloneable",
      "Не удалось проанализировать аргументы рендера",
      { cause: error },
    );
  }
  return null;
}

function dataCloneFailure(args: readonly unknown[]): PoolError | null {
  const limit = argsLimitFailure(args);
  if (limit !== null) {
    return limit;
  }
  try {
    structuredClone(args);
    return null;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "DataCloneError") {
      return new PoolError(
        "args-not-cloneable",
        "Аргументы рендера нельзя передать в worker (DataCloneError)",
        { cause: error },
      );
    }
    return new PoolError(
      "args-not-cloneable",
      "Не удалось склонировать аргументы рендера",
      { cause: error },
    );
  }
}

function isBareSpecifier(entry: string): boolean {
  if (path.isAbsolute(entry)) {
    return false;
  }
  if (
    entry.startsWith("./") ||
    entry.startsWith("../") ||
    entry.startsWith(".\\") ||
    entry.startsWith("..\\")
  ) {
    return false;
  }
  if (entry.startsWith("file:") || entry.startsWith("data:")) {
    return false;
  }
  return true;
}

function resolveEntryUrl(entry: string | URL): string {
  if (entry instanceof URL) {
    if (entry.protocol === "data:") {
      throw new PoolError(
        "entry-load-failed",
        "data: entry запрещён: передайте file: URL или путь к файлу",
      );
    }
    if (entry.protocol !== "file:") {
      throw new PoolError(
        "entry-load-failed",
        `Неподдерживаемый протокол entry: ${entry.protocol}; используйте file: URL или путь`,
      );
    }
    return entry.href;
  }
  if (entry.startsWith("data:")) {
    throw new PoolError(
      "entry-load-failed",
      "data: entry запрещён: передайте file: URL или путь к файлу",
    );
  }
  if (entry.startsWith("file:")) {
    try {
      return new URL(entry).href;
    } catch (error) {
      throw new PoolError(
        "entry-load-failed",
        `Некорректный URL entry: ${entry}`,
        { cause: error },
      );
    }
  }
  if (isBareSpecifier(entry)) {
    throw new PoolError(
      "entry-load-failed",
      `Entry "${entry}" — bare specifier. Передайте URL, полученный через import.meta.resolve("${entry}"), или путь к файлу`,
    );
  }
  return pathToFileURL(path.resolve(process.cwd(), entry)).href;
}

function normalizeOptions(options: RenderPoolOptions): NormalizedOptions {
  const workers = options.workers ?? Math.min(4, availableParallelism());
  if (!Number.isInteger(workers) || workers < 1) {
    throw new TypeError("workers должен быть целым числом >= 1");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("timeoutMs должен быть числом >= 0");
  }
  const idleTimeoutMs = options.idleTimeoutMs ?? timeoutMs;
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) {
    throw new TypeError("idleTimeoutMs должен быть числом >= 0");
  }
  const terminateGraceMs = options.terminateGraceMs ?? 500;
  if (!Number.isFinite(terminateGraceMs) || terminateGraceMs < 0) {
    throw new TypeError("terminateGraceMs должен быть числом >= 0");
  }
  const maxQueue = options.maxQueue ?? workers * 64;
  if (!Number.isInteger(maxQueue) || maxQueue < 0) {
    throw new TypeError("maxQueue должен быть целым числом >= 0");
  }
  const maxTasksPerWorker = options.maxTasksPerWorker ?? 0;
  if (!Number.isInteger(maxTasksPerWorker) || maxTasksPerWorker < 0) {
    throw new TypeError("maxTasksPerWorker должен быть целым числом >= 0");
  }
  const warmup = options.warmup ?? "lazy";
  if (warmup !== "lazy" && warmup !== "eager") {
    throw new TypeError('warmup должен быть "lazy" или "eager"');
  }
  const name = options.name ?? "silent-ssr-pool";
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("name должен быть непустой строкой");
  }
  return {
    workers,
    warmup,
    timeoutMs,
    idleTimeoutMs,
    terminateGraceMs,
    maxQueue,
    maxTasksPerWorker,
    name,
    env: options.env,
    execArgv: options.execArgv,
    resourceLimits: options.resourceLimits,
    onEvent: options.onEvent,
    onError: options.onError,
  };
}

interface BaseJob {
  readonly id: number;
  readonly kind: "render" | "stream";
  readonly args: readonly unknown[];
  readonly queuedAt: number;
  startedAt: number | null;
  workerId: number;
  settled: boolean;
  readonly signal: AbortSignal | undefined;
  abortListener: (() => void) | null;
  queueTimer: Timer | null;
}

interface UnaryJob extends BaseJob {
  readonly kind: "render";
  readonly resolve: (result: RenderResult) => void;
  readonly reject: (reason: unknown) => void;
  readonly timeoutMs: number;
  timer: Timer | null;
  slot: Slot | null;
}

interface StreamJob extends BaseJob {
  readonly kind: "stream";
  readonly options: PoolStreamOptions;
  readonly timeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly highWaterMark: number;
  readonly maxBufferedChars: number;
  readonly head: Deferred<string>;
  readonly finalHead: Deferred<string>;
  readonly done: Deferred<StreamSummary>;
  readonly controllerHolder: { controller: ReadableStreamDefaultController<string> | null };
  readonly pending: string[];
  pendingChars: number;
  paused: boolean;
  headSeen: boolean;
  firstHead: string;
  lastHead: string;
  chunks: number;
  chars: number;
  terminal: "end" | "error" | "aborted" | null;
  ending: boolean;
  streamClosed: boolean;
  /** Тело успешно закрыто через `controller.close()` — только тогда `done` успешен. */
  bodyClosed: boolean;
  summary: StreamSummary | null;
  doneSettled: boolean;
  port: MessagePort | null;
  timer: Timer | null;
  idleTimer: Timer | null;
  slot: Slot | null;
}

type Job = UnaryJob | StreamJob;

interface Slot {
  readonly id: number;
  readonly worker: PoolWorker;
  status: "booting" | "idle" | "busy" | "shutdown" | "dead";
  ready: boolean;
  expectedExit: boolean;
  dead: boolean;
  capabilities: EntryCapabilities;
  job: Job | null;
  tasks: number;
  bootError: unknown;
  boot: Deferred<void>;
  exitPromise: Promise<void>;
  resolveExit: () => void;
  graceTimer: Timer | null;
  terminatePromise: Promise<void> | null;
  detach: (() => void) | null;
  retireWhenIdle: boolean;
}

function createSlot(
  id: number,
  worker: PoolWorker,
): Slot {
  let resolveExit: () => void = () => {};
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  return {
    id,
    worker,
    status: "booting",
    ready: false,
    expectedExit: false,
    dead: false,
    capabilities: { render: false, renderStream: false },
    job: null,
    tasks: 0,
    bootError: null,
    boot: createDeferred<void>(),
    exitPromise,
    resolveExit,
    graceTimer: null,
    terminatePromise: null,
    detach: null,
    retireWhenIdle: false,
  };
}

interface Counters {
  completed: number;
  failed: number;
  timedOut: number;
  aborted: number;
  rejectedOverflow: number;
  restarts: number;
  deaths: number;
  staleMessages: number;
}

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 30_000;
const DEFAULT_HIGH_WATER_MARK = 64 * 1024;
const DEFAULT_MAX_BUFFERED_CHARS = 4_000_000;

class RenderPoolImplementation<
  Args extends readonly unknown[] = readonly unknown[],
> implements RenderPool<Args>
{
  private readonly config: NormalizedOptions;
  private readonly entryUrl: string;
  private readonly factory: WorkerFactory;
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private readonly counters: Counters = {
    completed: 0,
    failed: 0,
    timedOut: 0,
    aborted: 0,
    rejectedOverflow: 0,
    restarts: 0,
    deaths: 0,
    staleMessages: 0,
  };
  private readonly crashTimes: number[] = [];
  private stateValue: PoolState = "idle";
  private failure: PoolError | null = null;
  private nextWorkerId = 0;
  private nextJobId = 0;
  private closePromise: Promise<void> | null = null;

  constructor(
    entry: string | URL,
    options: RenderPoolOptions,
    internal: PoolInternal,
  ) {
    this.config = normalizeOptions(options);
    this.entryUrl = resolveEntryUrl(entry);
    this.factory =
      internal.workerFactory ?? ((context) => this.createNodeWorker(context));
    if (this.config.warmup === "eager") {
      void this.ready().catch(() => undefined);
    }
  }

  get workers(): number {
    return this.config.workers;
  }

  get name(): string {
    return this.config.name;
  }

  get state(): PoolState {
    return this.stateValue;
  }

  render(
    args: Args,
    options: PoolRenderOptions = {},
  ): Promise<RenderResult> {
    const failure = this.usableError();
    if (failure !== null) {
      return Promise.reject(failure);
    }
    if (options.signal?.aborted === true) {
      return Promise.reject(abortedPoolError());
    }
    const cloneFailure = dataCloneFailure(args);
    if (cloneFailure !== null) {
      return Promise.reject(cloneFailure);
    }
    if (!this.canEnqueue()) {
      this.counters.rejectedOverflow += 1;
      return Promise.reject(
        new PoolError(
          "queue-full",
          `Очередь пула заполнена (maxQueue=${this.config.maxQueue})`,
        ),
      );
    }

    const deferred = createDeferred<RenderResult>();
    const job: UnaryJob = {
      id: ++this.nextJobId,
      kind: "render",
      args,
      queuedAt: performance.now(),
      startedAt: null,
      workerId: 0,
      settled: false,
      signal: options.signal,
      abortListener: null,
      resolve: deferred.resolve,
      reject: deferred.reject,
      timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
      timer: null,
      queueTimer: null,
      slot: null,
    };

    this.queue.push(job);
    this.armQueueTimeout(job);
    this.emit({ type: "job:queued", jobId: job.id, kind: "render" });
    this.attachAbort(job);
    this.debug("job queued", { jobId: job.id, kind: "render" });
    this.pump();
    return deferred.promise;
  }

  renderStream(args: Args, options: PoolStreamOptions = {}): StreamHandle {
    const usable = this.usableError();
    if (usable !== null) {
      return this.erroredStream(usable);
    }
    if (options.signal?.aborted === true) {
      return this.erroredStream(abortedPoolError());
    }
    const cloneFailure = dataCloneFailure(args);
    if (cloneFailure !== null) {
      return this.erroredStream(cloneFailure);
    }
    if (!this.canEnqueue()) {
      this.counters.rejectedOverflow += 1;
      return this.erroredStream(
        new PoolError(
          "queue-full",
          `Очередь пула заполнена (maxQueue=${this.config.maxQueue})`,
        ),
      );
    }

    const highWaterMark = options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK;
    if (!Number.isFinite(highWaterMark) || highWaterMark < 0) {
      return this.erroredStream(
        new PoolError("stream-contract", "highWaterMark должен быть >= 0"),
      );
    }
    const maxBufferedChars =
      options.maxBufferedChars ?? DEFAULT_MAX_BUFFERED_CHARS;
    if (!Number.isFinite(maxBufferedChars) || maxBufferedChars < 0) {
      return this.erroredStream(
        new PoolError(
          "stream-contract",
          "maxBufferedChars должен быть числом >= 0",
        ),
      );
    }

    const job: StreamJob = {
      id: ++this.nextJobId,
      kind: "stream",
      args,
      queuedAt: performance.now(),
      startedAt: null,
      workerId: 0,
      settled: false,
      signal: options.signal,
      abortListener: null,
      options,
      timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
      idleTimeoutMs: options.idleTimeoutMs ?? this.config.idleTimeoutMs,
      highWaterMark,
      maxBufferedChars,
      head: createDeferred<string>(),
      finalHead: createDeferred<string>(),
      done: createDeferred<StreamSummary>(),
      controllerHolder: { controller: null },
      pending: [],
      pendingChars: 0,
      paused: false,
      headSeen: false,
      firstHead: "",
      lastHead: "",
      chunks: 0,
      chars: 0,
      terminal: null,
      ending: false,
      streamClosed: false,
      bodyClosed: false,
      summary: null,
      doneSettled: false,
      port: null,
      timer: null,
      queueTimer: null,
      idleTimer: null,
      slot: null,
    };

    const stream = new ReadableStream<string>(
      {
        start: (controller): void => {
          job.controllerHolder.controller = controller;
        },
        pull: (): void => {
          // Чтение consumer'а — тоже активность: пока он вычитывает буфер,
          // idle-таймаут не должен срабатывать, даже если воркер на паузе.
          this.resetStreamIdle(job);
          this.flushStream(job);
        },
        cancel: (reason): void => {
          this.abortStream(
            job,
            abortedPoolError(reasonText(reason) ?? "Стриминг отменён читателем"),
            "abort",
            false,
          );
        },
      },
      {
        highWaterMark: Math.max(1, highWaterMark),
        size: (chunk: string): number => chunk.length,
      },
    );

    const handle: StreamHandle = {
      stream,
      head: job.head.promise,
      finalHead: job.finalHead.promise,
      done: job.done.promise,
      cancel: (reason?: unknown): void => {
        this.abortStream(
          job,
          abortedPoolError(reasonText(reason) ?? "Стриминг отменён"),
          "abort",
          false,
        );
      },
    };

    this.queue.push(job);
    this.armQueueTimeout(job);
    this.emit({ type: "job:queued", jobId: job.id, kind: "stream" });
    this.attachAbort(job);
    this.debug("job queued", { jobId: job.id, kind: "stream" });
    this.pump();
    return handle;
  }

  async ready(): Promise<void> {
    const failure = this.usableError();
    if (failure !== null) {
      throw failure;
    }
    this.ensureWorkers(this.config.workers);
    const pending = this.slots
      .filter((slot) => !slot.ready && !slot.dead)
      .map((slot) => slot.boot.promise);
    const results = await Promise.allSettled(pending);
    if (this.stateValue === "failed" && this.failure !== null) {
      throw this.failure;
    }
    if (!this.slots.some((slot) => slot.ready && !slot.dead)) {
      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }
      }
      throw new PoolError(
        "worker-start-failed",
        "Ни один воркер пула не завершил boot",
      );
    }
  }

  stats(): PoolStats {
    let booting = 0;
    let idle = 0;
    let busy = 0;
    for (const slot of this.slots) {
      if (slot.status === "booting") {
        booting += 1;
      } else if (slot.status === "idle") {
        idle += 1;
      } else if (slot.status === "busy") {
        busy += 1;
      }
    }
    return {
      state: this.stateValue,
      workers: { total: this.slots.length, booting, idle, busy },
      queueDepth: this.queue.length,
      completed: this.counters.completed,
      failed: this.counters.failed,
      timedOut: this.counters.timedOut,
      aborted: this.counters.aborted,
      rejectedOverflow: this.counters.rejectedOverflow,
      restarts: this.counters.restarts,
      deaths: this.counters.deaths,
      staleMessages: this.counters.staleMessages,
    };
  }

  close(options: { force?: boolean; timeoutMs?: number } = {}): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }
    if (this.stateValue === "closed") {
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }
    this.stateValue = "closing";
    const force = options.force === true;
    this.debug("closing", { force });

    const queued = this.queue.splice(0, this.queue.length);
    for (const job of queued) {
      this.failJobBeforeStart(job, poolClosedError());
    }

    const waits: Promise<void>[] = [];
    for (const slot of [...this.slots]) {
      waits.push(slot.exitPromise);
      if (slot.job !== null && slot.job.kind === "stream") {
        this.abortStream(
          slot.job,
          poolClosedAbortError(),
          "abort",
          force,
        );
      } else if (slot.job !== null && force) {
        this.finishUnaryFailure(
          slot,
          slot.job,
          poolClosedError(),
          "failed",
          true,
        );
      }
      if (force) {
        this.terminateSlot(slot);
      } else if (slot.job === null) {
        this.shutdownSlot(slot);
      } else {
        slot.retireWhenIdle = true;
      }
    }

    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    let timer: Timer | null = null;
    if (!force) {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        // timeoutMs: 0 — «не ждать»: завершаем воркеры немедленно.
        for (const slot of [...this.slots]) {
          this.terminateSlot(slot);
        }
      } else {
        timer = setTimeout(() => {
          for (const slot of [...this.slots]) {
            this.terminateSlot(slot);
          }
        }, timeoutMs);
        unref(timer);
      }
    }

    this.closePromise = (async (): Promise<void> => {
      await Promise.all(waits);
      if (timer !== null) {
        clearTimeout(timer);
      }
      this.stateValue = "closed";
      this.emit({ type: "pool:closed" });
      this.debug("closed");
    })();
    return this.closePromise;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private createNodeWorker(context: WorkerCreateContext): PoolWorker {
    return new Worker(new URL("./worker-main.js", import.meta.url), {
      workerData: context.workerData,
      ...(this.config.env !== undefined ? { env: this.config.env } : {}),
      ...(this.config.execArgv !== undefined
        ? { execArgv: [...this.config.execArgv] }
        : {}),
      ...(this.config.resourceLimits !== undefined
        ? { resourceLimits: this.config.resourceLimits }
        : {}),
    }) as unknown as PoolWorker;
  }

  private usableError(): PoolError | null {
    if (this.stateValue === "closed" || this.stateValue === "closing") {
      return poolClosedError();
    }
    if (this.stateValue === "failed") {
      const failure = this.failure;
      return failure === null
        ? new PoolError("worker-start-failed", "Пул находится в состоянии failed")
        : clonePoolError(failure);
    }
    return null;
  }

  private canEnqueue(): boolean {
    if (this.findIdleSlot() !== null) {
      return true;
    }
    const activeWorkers = this.slots.filter(
      (slot) => slot.status !== "shutdown",
    ).length;
    if (activeWorkers + this.queue.length < this.config.workers) {
      return true;
    }
    return this.queue.length < this.config.maxQueue;
  }

  private findIdleSlot(): Slot | null {
    for (const slot of this.slots) {
      if (slot.status === "idle" && slot.job === null) {
        return slot;
      }
    }
    return null;
  }

  private ensureWorkers(count: number): void {
    while (
      this.slots.length < count &&
      this.stateValue !== "failed" &&
      this.stateValue !== "closed"
    ) {
      if (!this.spawnWorker()) {
        return;
      }
    }
  }

  private spawnWorker(): boolean {
    if (this.stateValue === "failed" || this.stateValue === "closed") {
      return false;
    }
    const workerId = ++this.nextWorkerId;
    const workerData: WorkerData = {
      protocol: POOL_PROTOCOL,
      entryUrl: this.entryUrl,
      name: this.config.name,
    };
    let worker: PoolWorker;
    try {
      const context: WorkerCreateContext = {
        workerId,
        workerData,
        protocol: workerData.protocol,
        entryUrl: workerData.entryUrl,
        ...(workerData.name !== undefined ? { name: workerData.name } : {}),
      };
      worker = this.factory(context, workerId);
    } catch (error) {
      this.failPool(
        new PoolError(
          "worker-start-failed",
          `Не удалось запустить воркер #${workerId}`,
          { cause: error },
        ),
      );
      return false;
    }
    const slot = createSlot(workerId, worker);
    this.slots.push(slot);
    this.emit({ type: "worker:spawn", workerId });
    this.debug("worker spawn", { workerId });
    if (this.stateValue === "idle") {
      this.stateValue = "booting";
    }
    this.attachWorker(slot);
    return true;
  }

  private attachWorker(slot: Slot): void {
    const onMessage = (message: unknown): void => {
      this.handleWorkerMessage(slot, message);
    };
    const onError = (error: unknown): void => {
      slot.bootError = error;
      this.reportError(error, { source: "worker", workerId: slot.id });
    };
    const onExit = (code: number): void => {
      this.handleExit(slot, code);
    };
    slot.worker.on("message", onMessage);
    slot.worker.on("error", onError);
    slot.worker.on("exit", onExit);
    slot.detach = (): void => {
      const worker = slot.worker;
      if (typeof worker.off === "function") {
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
        return;
      }
      worker.removeListener?.("message", onMessage);
      worker.removeListener?.("error", onError);
      worker.removeListener?.("exit", onExit);
    };
  }

  private handleWorkerMessage(slot: Slot, message: unknown): void {
    try {
      this.processWorkerMessage(slot, message);
    } catch (error) {
      this.failListener(slot, error);
    }
  }

  private processWorkerMessage(slot: Slot, message: unknown): void {
    if (slot.dead) {
      this.counters.staleMessages += 1;
      return;
    }
    if (!isProtocolCompatible(message)) {
      this.failPool(
        new PoolError(
          "protocol-mismatch",
          `Воркер #${slot.id} прислал сообщение с несовместимым протоколом`,
        ),
      );
      return;
    }
    const msg = message as WorkerToMain;
    switch (msg.type) {
      case "ready": {
        if (slot.ready) {
          this.counters.staleMessages += 1;
          return;
        }
        const capabilities: EntryCapabilities = {
          render: msg.capabilities?.render === true,
          renderStream: msg.capabilities?.renderStream === true,
        };
        slot.ready = true;
        slot.capabilities = capabilities;
        slot.status = "idle";
        slot.boot.resolve();
        if (this.stateValue === "booting" || this.stateValue === "idle") {
          this.stateValue = "ready";
        }
        this.emit({
          type: "worker:ready",
          workerId: slot.id,
          capabilities,
        });
        this.debug("worker ready", { workerId: slot.id, ...capabilities });
        this.pump();
        return;
      }
      case "entry-error": {
        if (!this.validateWireError(slot, msg.error, "entry-error")) {
          return;
        }
        const cause = reviveError(msg.error);
        this.failPool(
          new PoolError("entry-load-failed", msg.error.message, {
            cause,
            name: msg.error.name,
          }),
        );
        return;
      }
      case "protocol-error": {
        if (!this.validateWireError(slot, msg.error, "protocol-error")) {
          return;
        }
        this.failPool(
          new PoolError("protocol-mismatch", msg.error.message, {
            cause: reviveError(msg.error),
            name: msg.error.name,
          }),
        );
        return;
      }
      case "result": {
        if (slot.job === null || slot.job.kind !== "render") {
          this.counters.staleMessages += 1;
          return;
        }
        const job = slot.job;
        if (job.id !== msg.id) {
          this.counters.staleMessages += 1;
          return;
        }
        if (
          typeof msg.result?.html !== "string" ||
          typeof msg.result.head !== "string"
        ) {
          this.finishUnaryFailure(
            slot,
            job,
            new PoolError(
              "protocol-mismatch",
              `Воркер #${slot.id} вернул некорректный результат render`,
            ),
            "failed",
          );
          return;
        }
        this.finishUnarySuccess(slot, job, msg.result);
        return;
      }
      case "error": {
        if (!this.validateWireError(slot, msg.error, "error")) {
          return;
        }
        if (slot.job === null || slot.job.kind !== "render") {
          this.counters.staleMessages += 1;
          return;
        }
        const job = slot.job;
        if (job.id !== msg.id) {
          this.counters.staleMessages += 1;
          return;
        }
        this.finishUnaryFailure(slot, job, reviveError(msg.error), "failed");
        return;
      }
      case "shutdown-complete": {
        return;
      }
      default: {
        this.counters.staleMessages += 1;
      }
    }
  }

  private validateWireError(
    slot: Slot,
    wire: unknown,
    messageType: string,
  ): boolean {
    if (isWireError(wire)) {
      return true;
    }
    const error = new PoolError(
      "protocol-mismatch",
      `Воркер #${slot.id} прислал сообщение ${messageType} без корректной wire-ошибки`,
    );
    this.reportError(error, { source: "worker", workerId: slot.id });
    this.failPool(error);
    return false;
  }

  private failListener(slot: Slot, error: unknown): void {
    this.reportError(error, { source: "worker", workerId: slot.id });
    this.failPool(
      new PoolError(
        "protocol-mismatch",
        `Не удалось обработать сообщение воркера #${slot.id}`,
        { cause: error },
      ),
    );
  }

  private handleExit(slot: Slot, code: number): void {
    if (slot.dead) {
      return;
    }
    slot.dead = true;
    slot.status = "dead";
    if (slot.graceTimer !== null) {
      clearTimeout(slot.graceTimer);
      slot.graceTimer = null;
    }
    slot.detach?.();
    slot.detach = null;
    slot.boot.reject(
      this.failure ??
        new PoolError(
          "worker-exited",
          `Воркер #${slot.id} завершился с кодом ${code}`,
          { cause: slot.bootError },
        ),
    );
    slot.resolveExit();
    const index = this.slots.indexOf(slot);
    if (index >= 0) {
      this.slots.splice(index, 1);
    }
    this.emit({
      type: "worker:exit",
      workerId: slot.id,
      code,
      expected: slot.expectedExit,
    });
    this.debug("worker exit", {
      workerId: slot.id,
      code,
      expected: slot.expectedExit,
    });
    this.cleanupSlotJob(slot, code);

    if (this.stateValue === "failed" || this.stateValue === "closed") {
      return;
    }
    if (this.stateValue === "closing") {
      return;
    }
    if (!slot.ready && !slot.expectedExit) {
      const hasLiveReady = this.slots.some(
        (current) => current.ready && !current.dead,
      );
      if (!hasLiveReady) {
        this.failPool(
          new PoolError(
            "entry-load-failed",
            `Воркер #${slot.id} не смог загрузить entry`,
            { cause: slot.bootError },
          ),
        );
        return;
      }
      // Дополнительный воркер упал на boot, но пул уже обслуживает запросы:
      // рестартим его по общим правилам, а не валим весь пул.
      this.counters.deaths += 1;
      if (!this.recordCrash()) {
        return;
      }
      this.emit({
        type: "worker:restart",
        workerId: slot.id,
        reason: `boot exit ${code}`,
      });
      this.debug("worker restart", { workerId: slot.id, code });
      this.ensureWorkers(this.config.workers);
      this.pump();
      return;
    }
    if (slot.expectedExit) {
      this.pump();
      return;
    }

    this.counters.deaths += 1;
    if (!this.recordCrash()) {
      return;
    }
    this.emit({
      type: "worker:restart",
      workerId: slot.id,
      reason: `exit ${code}`,
    });
    this.debug("worker restart", { workerId: slot.id, code });
    this.pump();
  }

  private cleanupSlotJob(slot: Slot, code: number): void {
    const job = slot.job;
    slot.job = null;
    if (job === null) {
      return;
    }
    if (job.kind === "render") {
      if (!job.settled) {
        this.finishUnaryFailure(
          slot,
          job,
          new PoolError(
            "worker-exited",
            `Воркер #${slot.id} завершился во время задачи #${job.id}`,
            { cause: slot.bootError ?? new Error(`exit code ${code}`) },
          ),
          "failed",
          false,
        );
      }
      return;
    }
    this.closeStreamPort(job);
    if (job.terminal === null) {
      this.finishStreamFailure(
        slot,
        job,
        new PoolError(
          "worker-exited",
          `Воркер #${slot.id} завершился до end стрима`,
          { cause: slot.bootError ?? new Error(`exit code ${code}`) },
        ),
        "failed",
        false,
      );
    }
  }

  private recordCrash(): boolean {
    const now = performance.now();
    while (
      this.crashTimes.length > 0 &&
      now - (this.crashTimes[0] ?? 0) > RESTART_WINDOW_MS
    ) {
      this.crashTimes.shift();
    }
    this.crashTimes.push(now);
    if (this.crashTimes.length > MAX_RESTARTS) {
      this.failPool(
        new PoolError(
          "worker-start-failed",
          `Пул остановлен: больше ${MAX_RESTARTS} падений воркеров за ${RESTART_WINDOW_MS / 1000} с`,
        ),
      );
      return false;
    }
    this.counters.restarts += 1;
    return true;
  }

  private pump(): void {
    if (
      this.stateValue === "closing" ||
      this.stateValue === "closed" ||
      this.stateValue === "failed"
    ) {
      return;
    }
    for (;;) {
      if (this.queue.length === 0) {
        return;
      }
      const slot = this.findIdleSlot();
      if (slot !== null) {
        const job = this.queue.shift();
        if (job === undefined) {
          return;
        }
        if (!this.dispatch(slot, job)) {
          continue;
        }
        continue;
      }
      if (this.slots.some((current) => current.status === "booting")) {
        return;
      }
      if (this.slots.length >= this.config.workers) {
        return;
      }
      const needed = Math.min(
        this.queue.length,
        this.config.workers - this.slots.length,
      );
      for (let index = 0; index < needed; index += 1) {
        if (!this.spawnWorker()) {
          return;
        }
      }
      return;
    }
  }

  private dispatch(slot: Slot, job: Job): boolean {
    this.clearQueueTimer(job);
    if (job.kind === "render" && job.settled) {
      return false;
    }
    if (job.kind === "stream" && job.terminal !== null) {
      return false;
    }
    if (job.kind === "render" && !slot.capabilities.render) {
      this.failJobBeforeStart(
        job,
        new PoolError(
          "render-unsupported",
          "Entry-модуль не экспортирует render",
        ),
      );
      return false;
    }
    if (job.kind === "stream" && !slot.capabilities.renderStream) {
      this.failJobBeforeStart(
        job,
        new PoolError(
          "stream-unsupported",
          "Entry-модуль не экспортирует renderStream",
        ),
      );
      return false;
    }

    slot.status = "busy";
    slot.job = job;
    job.slot = slot;
    job.workerId = slot.id;
    job.startedAt = performance.now();
    this.emit({
      type: "job:start",
      jobId: job.id,
      kind: job.kind,
      workerId: slot.id,
    });
    this.debug("job start", {
      jobId: job.id,
      kind: job.kind,
      workerId: slot.id,
    });

    if (job.kind === "render") {
      this.armUnaryTimeout(job);
      try {
        slot.worker.postMessage({
          type: "render",
          protocol: POOL_PROTOCOL,
          id: job.id,
          args: job.args,
        } satisfies MainToWorker);
      } catch (error) {
        this.finishUnaryFailure(
          slot,
          job,
          new PoolError(
            "worker-exited",
            `Не удалось отправить задачу воркеру #${slot.id}`,
            { cause: error },
          ),
          "failed",
          true,
        );
      }
      return true;
    }

    this.armStreamTimeouts(job);
    const channel = new MessageChannel();
    const port = channel.port1;
    job.port = port;
    port.on("message", (message: unknown): void => {
      this.handleStreamMessage(slot, job, message);
    });
    port.on("close", (): void => {
      this.handleStreamPortClose(slot, job);
    });
    port.start();
    try {
      slot.worker.postMessage(
        {
          type: "render-stream",
          protocol: POOL_PROTOCOL,
          id: job.id,
          args: job.args,
          port: channel.port2,
        } satisfies MainToWorker,
        [channel.port2],
      );
    } catch (error) {
      this.finishStreamFailure(
        slot,
        job,
        new PoolError(
          "worker-exited",
          `Не удалось отправить стрим воркеру #${slot.id}`,
          { cause: error },
        ),
        "failed",
        true,
      );
    }
    return true;
  }

  private handleStreamMessage(
    slot: Slot,
    job: StreamJob,
    message: unknown,
  ): void {
    try {
      this.processStreamMessage(slot, job, message);
    } catch (error) {
      this.failListener(slot, error);
    }
  }

  private processStreamMessage(
    slot: Slot,
    job: StreamJob,
    message: unknown,
  ): void {
    if (job.terminal !== null) {
      this.counters.staleMessages += 1;
      return;
    }
    if (typeof message !== "object" || message === null) {
      this.counters.staleMessages += 1;
      return;
    }
    const msg = message as StreamWorkerMessage;
    switch (msg.type) {
      case "head": {
        const value = typeof msg.head === "string" ? msg.head : String(msg.head);
        if (!job.headSeen) {
          job.headSeen = true;
          job.firstHead = value;
          job.head.resolve(value);
        }
        job.lastHead = value;
        this.resetStreamIdle(job);
        this.invokeCallback((): void => {
          job.options.onHead?.(value, { final: msg.final === true });
        });
        return;
      }
      case "shell": {
        const bytes = typeof msg.bytes === "number" ? msg.bytes : 0;
        this.resetStreamIdle(job);
        this.invokeCallback((): void => {
          job.options.onShell?.({ bytes });
        });
        return;
      }
      case "chunk": {
        const chunk = typeof msg.chunk === "string" ? msg.chunk : String(msg.chunk);
        if (chunk.length === 0) {
          return;
        }
        this.resetStreamIdle(job);
        if (this.bufferedChars(job) + chunk.length > job.maxBufferedChars) {
          this.abortStream(
            job,
            new PoolError(
              "stream-overflow",
              `Буфер стрима превысил ${job.maxBufferedChars} символов`,
            ),
            "failed",
            false,
          );
          return;
        }
        job.chunks += 1;
        job.chars += chunk.length;
        job.pending.push(chunk);
        job.pendingChars += chunk.length;
        this.flushStream(job);
        if (
          !job.paused &&
          job.pendingChars >= job.highWaterMark &&
          job.highWaterMark > 0
        ) {
          job.paused = true;
          this.sendStreamControl(job, { type: "pause" });
        }
        return;
      }
      case "end": {
        this.finishStreamSuccess(slot, job);
        return;
      }
      case "error": {
        if (!this.validateWireError(slot, msg.error, "stream-error")) {
          return;
        }
        this.finishStreamFailure(
          slot,
          job,
          reviveError(msg.error),
          "failed",
          false,
        );
        return;
      }
      default: {
        this.counters.staleMessages += 1;
      }
    }
  }

  private handleStreamPortClose(slot: Slot, job: StreamJob): void {
    if (job.terminal !== null) {
      return;
    }
    this.finishStreamFailure(
      slot,
      job,
      new PoolError(
        "worker-exited",
        `Порт стрима закрыт до получения end (воркер #${slot.id})`,
      ),
      "failed",
      true,
    );
  }

  private finishStreamSuccess(slot: Slot, job: StreamJob): void {
    if (job.terminal !== null) {
      return;
    }
    if (!job.headSeen) {
      this.finishStreamWithoutHead(job);
      return;
    }
    job.terminal = "end";
    job.ending = true;
    this.clearStreamTimers(job);
    // Abort-listener остаётся до закрытия тела: отмена по signal в этом окне
    // должна отклонять `done`, а не оставлять его висеть.
    const summary: StreamSummary = {
      head: job.firstHead,
      finalHead: job.lastHead,
      chunks: job.chunks,
      chars: job.chars,
      durationMs: this.jobDuration(job),
      workerId: job.workerId,
    };
    job.finalHead.resolve(job.lastHead);
    job.summary = summary;
    this.counters.completed += 1;
    this.emit({
      type: "job:finish",
      jobId: job.id,
      kind: "stream",
      ok: true,
      durationMs: summary.durationMs,
    });
    this.flushStream(job);
    // `done` резолвится только из closeBody, когда тело реально закрыто и
    // недоставленных чанков не осталось: потребитель, не читавший тело,
    // не должен видеть успех раньше времени.
    this.resolveStreamDone(job);
    this.closeStreamPort(job);
    slot.job = null;
    job.slot = null;
    this.completeTask(slot);
  }

  private resolveStreamDone(job: StreamJob): void {
    if (
      job.doneSettled ||
      job.terminal !== "end" ||
      job.summary === null ||
      !job.bodyClosed ||
      job.pending.length > 0
    ) {
      return;
    }
    job.doneSettled = true;
    job.done.resolve(job.summary);
  }

  private finishStreamWithoutHead(job: StreamJob): void {
    if (job.terminal !== null) {
      return;
    }
    const error = new PoolError(
      "stream-head-missing",
      "renderStream() завершился без вызова onHead",
    );
    job.terminal = "error";
    this.clearStreamTimers(job);
    this.removeAbort(job);
    this.closeBody(job);
    job.head.reject(error);
    job.finalHead.reject(error);
    job.done.reject(error);
    this.counters.failed += 1;
    this.emit({
      type: "job:finish",
      jobId: job.id,
      kind: "stream",
      ok: false,
      durationMs: this.jobDuration(job),
    });
    this.closeStreamPort(job);
    const slot = job.slot;
    job.slot = null;
    if (slot !== null) {
      slot.job = null;
      this.completeTask(slot);
    }
  }

  private finishStreamFailure(
    slot: Slot,
    job: StreamJob,
    error: unknown,
    outcome: "failed" | "timeout" | "abort",
    terminate: boolean,
  ): void {
    if (job.terminal !== null) {
      return;
    }
    job.terminal = "error";
    this.clearStreamTimers(job);
    this.removeAbort(job);
    this.errorStream(job, error);
    job.head.reject(error);
    job.finalHead.reject(error);
    job.done.reject(error);
    this.counters.failed += 1;
    if (outcome === "timeout") {
      this.counters.timedOut += 1;
    }
    if (outcome === "abort") {
      this.counters.aborted += 1;
    }
    this.emit({
      type: "job:finish",
      jobId: job.id,
      kind: "stream",
      ok: false,
      durationMs: this.jobDuration(job),
    });
    this.closeStreamPort(job);
    slot.job = null;
    job.slot = null;
    if (terminate) {
      this.retireSlot(slot);
    } else {
      this.completeTask(slot);
    }
  }

  /**
   * Отмена уже завершившегося (`end`) стрима, тело которого не дочитано.
   * Воркер уже свободен, а чанки лежат в буфере пула: отдаём ошибку в тело и
   * `done`, выбрасываем буфер — успешный `done` здесь был бы ложью.
   */
  private discardEndedStream(
    job: StreamJob,
    error: unknown,
    outcome: "failed" | "timeout" | "abort",
  ): void {
    job.terminal = outcome === "failed" ? "error" : "aborted";
    job.ending = false;
    job.pending.length = 0;
    job.pendingChars = 0;
    job.paused = false;
    this.removeAbort(job);
    this.errorStream(job, error);
    job.done.reject(error);
    if (outcome === "timeout") {
      this.counters.timedOut += 1;
      return;
    }
    if (outcome === "abort") {
      this.counters.aborted += 1;
      const reason = reasonText(error);
      this.emit({
        type: "job:abort",
        jobId: job.id,
        kind: "stream",
        ...(reason !== undefined ? { reason } : {}),
      });
    }
  }

  private abortStream(
    job: StreamJob,
    error: PoolError,
    outcome: "failed" | "timeout" | "abort",
    forceTerminate: boolean,
    timeoutMs = 0,
    closeBody = false,
  ): void {
    if (job.terminal !== null) {
      if (job.terminal === "end" && !job.doneSettled) {
        // `end` уже пришёл, но тело не дочитано: успешный `done` недопустим,
        // иначе потребитель увидит успех, а недоставленные чанки потеряются.
        this.discardEndedStream(job, error, outcome);
      }
      return;
    }
    if (job.startedAt === null) {
      this.removeFromQueue(job);
    }
    job.terminal = outcome === "failed" ? "error" : "aborted";
    this.clearStreamTimers(job);
    this.removeAbort(job);
    this.sendStreamControl(job, {
      type: "cancel",
      reason: error.message,
    });
    if (closeBody) {
      this.closeBody(job);
    } else {
      this.errorStream(job, error);
    }
    job.head.reject(error);
    job.finalHead.reject(error);
    job.done.reject(error);
    this.counters.failed += 1;
    if (outcome === "timeout") {
      this.counters.timedOut += 1;
      this.debug("job timeout", {
        jobId: job.id,
        kind: "stream",
        timeoutMs,
      });
      this.emit({
        type: "job:timeout",
        jobId: job.id,
        kind: "stream",
        timeoutMs,
      });
    }
    if (outcome === "abort") {
      this.counters.aborted += 1;
      const reason =
        reasonText(job.options.signal?.reason) ?? error.message;
      this.emit({
        type: "job:abort",
        jobId: job.id,
        kind: "stream",
        ...(reason !== undefined ? { reason } : {}),
      });
    }
    this.emit({
      type: "job:finish",
      jobId: job.id,
      kind: "stream",
      ok: false,
      durationMs: this.jobDuration(job),
    });
    const slot = job.slot;
    job.slot = null;
    if (slot === null) {
      return;
    }
    if (forceTerminate) {
      this.terminateSlot(slot);
    } else {
      this.retireSlot(slot);
    }
  }

  private finishUnarySuccess(
    slot: Slot,
    job: UnaryJob,
    result: { readonly html: string; readonly head: string },
  ): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    this.clearUnaryTimer(job);
    this.removeAbort(job);
    const durationMs = this.jobDuration(job);
    job.resolve({ html: result.html, head: result.head });
    this.counters.completed += 1;
    this.emit({
      type: "job:finish",
      jobId: job.id,
      kind: "render",
      ok: true,
      durationMs,
    });
    slot.job = null;
    job.slot = null;
    this.completeTask(slot);
  }

  private finishUnaryFailure(
    slot: Slot | null,
    job: UnaryJob,
    error: unknown,
    outcome: "failed" | "timeout" | "abort",
    terminate = false,
  ): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    this.clearUnaryTimer(job);
    this.removeAbort(job);
    job.reject(error);
    this.counters.failed += 1;
    if (outcome === "timeout") {
      this.counters.timedOut += 1;
      this.emit({
        type: "job:timeout",
        jobId: job.id,
        kind: "render",
        timeoutMs: job.timeoutMs,
      });
    }
    if (outcome === "abort") {
      this.counters.aborted += 1;
      this.emit({
        type: "job:abort",
        jobId: job.id,
        kind: "render",
        ...(reasonText(job.signal?.reason) !== undefined
          ? { reason: reasonText(job.signal?.reason) as string }
          : {}),
      });
    }
    this.emit({
      type: "job:finish",
      jobId: job.id,
      kind: "render",
      ok: false,
      durationMs: this.jobDuration(job),
    });
    if (slot === null) {
      return;
    }
    slot.job = null;
    job.slot = null;
    if (terminate) {
      this.terminateSlot(slot);
    } else {
      this.completeTask(slot);
    }
  }

  private failJobBeforeStart(job: Job, error: unknown): void {
    const aborted = isAbortError(error);
    const abortReason =
      reasonText(job.signal?.reason) ?? reasonText(error);
    if (job.kind === "render") {
      if (job.settled) {
        return;
      }
      job.settled = true;
      this.clearUnaryTimer(job);
      this.removeAbort(job);
      job.reject(error);
      if (aborted) {
        this.counters.aborted += 1;
        this.emit({
          type: "job:abort",
          jobId: job.id,
          kind: "render",
          ...(abortReason !== undefined ? { reason: abortReason } : {}),
        });
      } else {
        this.counters.failed += 1;
      }
      this.emit({
        type: "job:finish",
        jobId: job.id,
        kind: "render",
        ok: false,
        durationMs: 0,
      });
      return;
    }
    if (job.terminal !== null) {
      return;
    }
    job.terminal = aborted ? "aborted" : "error";
    this.clearStreamTimers(job);
    this.removeAbort(job);
    this.errorStream(job, error);
    job.head.reject(error);
    job.finalHead.reject(error);
    job.done.reject(error);
    if (aborted) {
      this.counters.aborted += 1;
      this.emit({
        type: "job:abort",
        jobId: job.id,
        kind: "stream",
        ...(abortReason !== undefined ? { reason: abortReason } : {}),
      });
    } else {
      this.counters.failed += 1;
    }
    this.emit({
      type: "job:finish",
      jobId: job.id,
      kind: "stream",
      ok: false,
      durationMs: 0,
    });
  }

  private completeTask(slot: Slot): void {
    slot.tasks += 1;
    if (slot.dead) {
      return;
    }
    if (this.stateValue === "closing" || this.stateValue === "closed") {
      this.shutdownSlot(slot);
      return;
    }
    if (this.stateValue === "failed") {
      this.terminateSlot(slot);
      return;
    }
    if (slot.retireWhenIdle) {
      this.shutdownSlot(slot);
      return;
    }
    if (
      this.config.maxTasksPerWorker > 0 &&
      slot.tasks >= this.config.maxTasksPerWorker
    ) {
      this.shutdownSlot(slot);
      this.pump();
      return;
    }
    slot.status = "idle";
    this.pump();
  }

  private shutdownSlot(slot: Slot): void {
    if (slot.dead || slot.status === "shutdown") {
      return;
    }
    slot.expectedExit = true;
    slot.status = "shutdown";
    try {
      slot.worker.postMessage({
        type: "shutdown",
        protocol: POOL_PROTOCOL,
      } satisfies MainToWorker);
    } catch {
      this.terminateSlot(slot);
      return;
    }
    this.scheduleGrace(slot);
  }

  private retireSlot(slot: Slot): void {
    if (slot.dead) {
      return;
    }
    slot.expectedExit = true;
    slot.status = "shutdown";
    this.scheduleGrace(slot);
  }

  private scheduleGrace(slot: Slot): void {
    if (slot.graceTimer !== null) {
      return;
    }
    if (this.config.terminateGraceMs <= 0) {
      this.terminateSlot(slot);
      return;
    }
    slot.graceTimer = setTimeout(() => {
      slot.graceTimer = null;
      this.terminateSlot(slot);
    }, this.config.terminateGraceMs);
    unref(slot.graceTimer);
  }

  private terminateSlot(slot: Slot): void {
    if (slot.dead) {
      return;
    }
    slot.expectedExit = true;
    slot.status = "shutdown";
    if (slot.graceTimer !== null) {
      clearTimeout(slot.graceTimer);
      slot.graceTimer = null;
    }
    if (slot.terminatePromise !== null) {
      return;
    }
    let result: void | Promise<unknown>;
    try {
      result = slot.worker.terminate();
    } catch {
      this.handleExit(slot, -1);
      return;
    }
    slot.terminatePromise = Promise.resolve(result).then(
      (): void => {
        this.handleExit(slot, -1);
      },
      (): void => {
        this.handleExit(slot, -1);
      },
    );
  }

  private failPool(error: PoolError): void {
    if (
      this.stateValue === "failed" ||
      this.stateValue === "closed" ||
      this.stateValue === "closing"
    ) {
      return;
    }
    this.stateValue = "failed";
    this.failure = error;
    this.emit({ type: "pool:failed", error });
    this.debug("pool failed", { message: error.message });
    const queued = this.queue.splice(0, this.queue.length);
    for (const job of queued) {
      this.failJobBeforeStart(job, clonePoolError(error));
    }
    for (const slot of [...this.slots]) {
      slot.boot.reject(error);
      if (slot.job !== null) {
        if (slot.job.kind === "render") {
          this.finishUnaryFailure(
            slot,
            slot.job,
            clonePoolError(error),
            "failed",
            false,
          );
        } else {
          this.finishStreamFailure(
            slot,
            slot.job,
            clonePoolError(error),
            "failed",
            false,
          );
        }
      }
      this.terminateSlot(slot);
    }
  }

  private attachAbort(job: Job): void {
    const signal = job.signal;
    if (signal === undefined) {
      return;
    }
    const listener = (): void => {
      if (job.kind === "render") {
        if (job.settled) {
          return;
        }
        if (job.startedAt === null) {
          this.removeFromQueue(job);
          this.failJobBeforeStart(job, abortedPoolError());
          return;
        }
        if (job.slot !== null) {
          this.finishUnaryFailure(
            job.slot,
            job,
            abortedPoolError(),
            "abort",
            true,
          );
        }
        return;
      }
      if (job.startedAt === null) {
        this.removeFromQueue(job);
        this.failJobBeforeStart(job, abortedPoolError());
        return;
      }
      this.abortStream(job, abortedPoolError(), "abort", false);
    };
    job.abortListener = listener;
    if (signal.aborted) {
      listener();
      return;
    }
    signal.addEventListener("abort", listener, { once: true });
  }

  private removeAbort(job: Job): void {
    if (job.abortListener === null) {
      return;
    }
    job.signal?.removeEventListener("abort", job.abortListener);
    job.abortListener = null;
  }

  private removeFromQueue(job: Job): void {
    const index = this.queue.indexOf(job);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  private armUnaryTimeout(job: UnaryJob): void {
    if (job.timeoutMs <= 0) {
      return;
    }
    job.timer = setTimeout(() => {
      job.timer = null;
      if (job.settled) {
        return;
      }
      const slot = job.slot;
      this.debug("job timeout", {
        jobId: job.id,
        kind: "render",
        timeoutMs: job.timeoutMs,
      });
      this.finishUnaryFailure(
        slot,
        job,
        timeoutPoolError(job.timeoutMs),
        "timeout",
        true,
      );
    }, job.timeoutMs);
    unref(job.timer);
  }

  private armQueueTimeout(job: Job): void {
    if (job.timeoutMs <= 0) {
      return;
    }
    job.queueTimer = setTimeout(() => {
      job.queueTimer = null;
      if (job.kind === "render") {
        if (job.settled || job.startedAt !== null) {
          return;
        }
        this.removeFromQueue(job);
        this.debug("job timeout in queue", {
          jobId: job.id,
          kind: job.kind,
          timeoutMs: job.timeoutMs,
        });
        this.finishUnaryFailure(
          null,
          job,
          timeoutPoolError(job.timeoutMs),
          "timeout",
          false,
        );
        return;
      }
      if (job.terminal !== null || job.startedAt !== null) {
        return;
      }
      this.removeFromQueue(job);
      this.debug("job timeout in queue", {
        jobId: job.id,
        kind: job.kind,
        timeoutMs: job.timeoutMs,
      });
      this.abortStream(
        job,
        timeoutPoolError(job.timeoutMs),
        "timeout",
        false,
        job.timeoutMs,
      );
    }, job.timeoutMs);
    unref(job.queueTimer);
  }

  private clearQueueTimer(job: Job): void {
    if (job.queueTimer !== null) {
      clearTimeout(job.queueTimer);
      job.queueTimer = null;
    }
  }

  private armStreamTimeouts(job: StreamJob): void {
    if (job.timeoutMs > 0) {
      job.timer = setTimeout(() => {
        job.timer = null;
        this.abortStream(
          job,
          timeoutPoolError(job.timeoutMs),
          "timeout",
          false,
          job.timeoutMs,
        );
      }, job.timeoutMs);
      unref(job.timer);
    }
    this.resetStreamIdle(job);
  }

  private resetStreamIdle(job: StreamJob): void {
    this.clearStreamIdle(job);
    if (
      job.idleTimeoutMs <= 0 ||
      job.terminal !== null ||
      job.startedAt === null
    ) {
      return;
    }
    job.idleTimer = setTimeout(() => {
      job.idleTimer = null;
      this.abortStream(
        job,
        timeoutPoolError(job.idleTimeoutMs, "idle"),
        "timeout",
        false,
        job.idleTimeoutMs,
      );
    }, job.idleTimeoutMs);
    unref(job.idleTimer);
  }

  private clearStreamIdle(job: StreamJob): void {
    if (job.idleTimer !== null) {
      clearTimeout(job.idleTimer);
      job.idleTimer = null;
    }
  }

  private clearUnaryTimer(job: UnaryJob): void {
    if (job.timer !== null) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    this.clearQueueTimer(job);
  }

  private clearStreamTimers(job: StreamJob): void {
    if (job.timer !== null) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    this.clearStreamIdle(job);
    this.clearQueueTimer(job);
  }

  private sendStreamControl(
    job: StreamJob,
    message: StreamMainMessage,
  ): void {
    if (job.port === null) {
      return;
    }
    try {
      job.port.postMessage(message);
    } catch {
      // Порт уже закрыт.
    }
  }

  private bufferedChars(job: StreamJob): number {
    const controller = job.controllerHolder.controller;
    if (controller === null || job.streamClosed) {
      return job.pendingChars;
    }
    const desired = controller.desiredSize;
    if (desired === null) {
      return job.pendingChars;
    }
    const highWaterMark = Math.max(1, job.highWaterMark);
    const queued = Math.max(0, highWaterMark - desired);
    return job.pendingChars + queued;
  }

  private flushStream(job: StreamJob): void {
    const controller = job.controllerHolder.controller;
    if (controller === null || job.streamClosed) {
      return;
    }
    while (job.pending.length > 0) {
      const desired = controller.desiredSize;
      if (desired === null || desired <= 0) {
        break;
      }
      const chunk = job.pending.shift();
      if (chunk === undefined) {
        break;
      }
      job.pendingChars -= chunk.length;
      try {
        controller.enqueue(chunk);
      } catch {
        job.streamClosed = true;
        return;
      }
    }
    if (
      job.paused &&
      job.pendingChars < job.highWaterMark / 2
    ) {
      job.paused = false;
      this.sendStreamControl(job, { type: "resume" });
      this.resetStreamIdle(job);
    }
    if (job.ending && job.pending.length === 0 && !job.streamClosed) {
      this.closeBody(job);
    }
  }

  private errorStream(job: StreamJob, error: unknown): void {
    if (job.streamClosed) {
      return;
    }
    const controller = job.controllerHolder.controller;
    if (controller === null) {
      return;
    }
    job.streamClosed = true;
    try {
      controller.error(error);
    } catch {
      // Поток уже закрыт/отменён.
    }
  }

  private closeBody(job: StreamJob): void {
    if (job.streamClosed) {
      return;
    }
    const controller = job.controllerHolder.controller;
    if (controller === null) {
      return;
    }
    job.streamClosed = true;
    try {
      controller.close();
    } catch {
      // Поток уже закрыт/отменён.
    }
    job.bodyClosed = true;
    this.removeAbort(job);
    this.resolveStreamDone(job);
  }

  private closeStreamPort(job: StreamJob): void {
    const port = job.port;
    job.port = null;
    if (port === null) {
      return;
    }
    try {
      port.close();
    } catch {
      // Порт уже закрыт.
    }
  }

  private jobDuration(job: Job): number {
    const end = performance.now();
    const start = job.startedAt ?? job.queuedAt;
    return Math.max(0, end - start);
  }

  private erroredStream(error: unknown): StreamHandle {
    const stream = new ReadableStream<string>({
      start: (controller): void => {
        controller.error(error);
      },
    });
    const reject = <T>(): Promise<T> => {
      const deferred = createDeferred<T>();
      deferred.reject(error);
      return deferred.promise;
    };
    const done = reject<StreamSummary>();
    const head = reject<string>();
    const finalHead = reject<string>();
    return {
      stream,
      head,
      finalHead,
      done,
      cancel: (): void => {},
    };
  }

  private invokeCallback(task: () => void): void {
    try {
      task();
    } catch (error) {
      this.reportError(error, { source: "callback" });
    }
  }

  private emit(event: PoolEvent): void {
    const handler = this.config.onEvent;
    if (handler === undefined) {
      return;
    }
    try {
      handler(event);
    } catch (error) {
      this.reportError(error, { source: "event", event });
    }
  }

  private reportError(error: unknown, info: PoolErrorInfo): void {
    const handler = this.config.onError;
    if (handler === undefined) {
      if (isDebugEnabled()) {
        // Только name/message/code: в debug-лог не должны попадать props/PII.
        console.debug(`[${this.config.name}] error`, errorDetails(error), infoDetails(info));
      }
      return;
    }
    try {
      handler(error, info);
    } catch (failure) {
      if (isDebugEnabled()) {
        console.debug(`[${this.config.name}] onError failed`, errorDetails(failure));
      }
    }
  }

  private debug(message: string, details?: unknown): void {
    if (!isDebugEnabled()) {
      return;
    }
    if (details === undefined) {
      console.debug(`[${this.config.name}] ${message}`);
      return;
    }
    console.debug(`[${this.config.name}] ${message}`, details);
  }
}

export function createPool<
  Args extends readonly unknown[] = readonly unknown[],
>(
  entry: string | URL,
  options: RenderPoolOptions = {},
  internal: PoolInternal = {},
): RenderPool<Args> {
  return new RenderPoolImplementation<Args>(entry, options, internal);
}
