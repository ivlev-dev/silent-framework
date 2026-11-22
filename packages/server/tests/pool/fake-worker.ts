import {
  MessageChannel,
  type MessagePort,
  type Transferable,
} from "node:worker_threads";
import type { PoolWorker, WorkerFactory } from "../../src/pool/pool.js";
import {
  POOL_PROTOCOL,
  type EntryCapabilities,
  type MainToWorker,
} from "../../src/pool/protocol.js";

type Listener = (...args: any[]) => void;

export interface FakeWorkerConfig {
  readonly protocol?: number;
  readonly capabilities?: EntryCapabilities;
  readonly autoReady?: boolean;
}

export class FakeWorker implements PoolWorker {
  readonly id: number;
  readonly received: MainToWorker[] = [];
  readonly mainPort: MessagePort;
  readonly workerPort: MessagePort;
  private readonly config: FakeWorkerConfig;
  private readonly messageListeners: Listener[] = [];
  private readonly exitListeners: ((code: number) => void)[] = [];
  private readonly errorListeners: ((error: unknown) => void)[] = [];
  private readonly receivedWaiters: {
    readonly predicate: (message: MainToWorker) => boolean;
    readonly resolve: (message: MainToWorker) => void;
  }[] = [];
  private exited = false;
  handler: ((message: MainToWorker, worker: FakeWorker) => void) | null = null;

  get isExited(): boolean {
    return this.exited;
  }

  constructor(id: number, config: FakeWorkerConfig = {}) {
    this.id = id;
    this.config = config;
    const channel = new MessageChannel();
    this.mainPort = channel.port1;
    this.workerPort = channel.port2;
    this.mainPort.on("message", (message: unknown) => {
      for (const listener of [...this.messageListeners]) {
        listener(message);
      }
    });
    this.workerPort.on("message", (message: unknown) => {
      const typed = message as MainToWorker;
      this.received.push(typed);
      this.resolveWaiters(typed);
      this.respond(typed);
    });
    this.mainPort.start();
    this.workerPort.start();
    if (config.autoReady !== false) {
      queueMicrotask(() => {
        this.send({
          type: "ready",
          protocol: config.protocol ?? POOL_PROTOCOL,
          capabilities: config.capabilities ?? {
            render: true,
            renderStream: true,
          },
        });
      });
    }
  }

  postMessage(message: unknown, transferList?: readonly unknown[]): void {
    if (transferList === undefined) {
      this.mainPort.postMessage(message);
      return;
    }
    this.mainPort.postMessage(message, [...transferList] as Transferable[]);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    if (event === "message") {
      this.messageListeners.push(listener);
      return;
    }
    if (event === "exit") {
      this.exitListeners.push(listener);
      return;
    }
    if (event === "error") {
      this.errorListeners.push(listener);
    }
  }

  off(event: string, listener: (...args: any[]) => void): void {
    const remove = (list: Listener[]): void => {
      const index = list.indexOf(listener);
      if (index >= 0) {
        list.splice(index, 1);
      }
    };
    if (event === "message") {
      remove(this.messageListeners);
      return;
    }
    if (event === "exit") {
      remove(this.exitListeners as Listener[]);
      return;
    }
    if (event === "error") {
      remove(this.errorListeners as Listener[]);
    }
  }

  terminate(): Promise<number> {
    this.exit(0);
    this.mainPort.close();
    this.workerPort.close();
    return Promise.resolve(0);
  }

  send(message: unknown): void {
    this.workerPort.postMessage(message);
  }

  sendResult(id: number, html: string, head = ""): void {
    this.send({
      type: "result",
      protocol: POOL_PROTOCOL,
      id,
      result: { html, head },
    });
  }

  sendError(id: number, error: unknown): void {
    this.send({
      type: "error",
      protocol: POOL_PROTOCOL,
      id,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack !== undefined
          ? { stack: error.stack }
          : {}),
        ...(typeof (error as { code?: unknown } | null)?.code === "string"
          ? { code: (error as { code: string }).code }
          : {}),
      },
    });
  }

  exit(code = 0): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    for (const listener of [...this.exitListeners]) {
      listener(code);
    }
  }

  emitError(error: unknown): void {
    for (const listener of [...this.errorListeners]) {
      listener(error);
    }
  }

  waitForMessage(
    predicate: (message: MainToWorker) => boolean,
    timeoutMs = 2000,
  ): Promise<MainToWorker> {
    const existing = this.received.find(predicate);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    return new Promise<MainToWorker>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: (message: MainToWorker): void => {
          clearTimeout(timer);
          resolve(message);
        },
      };
      const timer = setTimeout(() => {
        const index = this.receivedWaiters.indexOf(waiter);
        if (index >= 0) {
          this.receivedWaiters.splice(index, 1);
        }
        reject(
          new Error(
            `FakeWorker #${this.id}: не дождались сообщения (получено: ${this.received
              .map((message) => message.type)
              .join(", ")})`,
          ),
        );
      }, timeoutMs);
      (timer as { unref?: () => void }).unref?.();
      this.receivedWaiters.push(waiter);
    });
  }

  private respond(message: MainToWorker): void {
    if (message.type === "shutdown") {
      this.send({ type: "shutdown-complete", protocol: POOL_PROTOCOL });
      queueMicrotask(() => {
        this.exit(0);
      });
      return;
    }
    this.handler?.(message, this);
  }

  private resolveWaiters(message: MainToWorker): void {
    for (const waiter of [...this.receivedWaiters]) {
      if (!waiter.predicate(message)) {
        continue;
      }
      const index = this.receivedWaiters.indexOf(waiter);
      if (index >= 0) {
        this.receivedWaiters.splice(index, 1);
      }
      waiter.resolve(message);
    }
  }
}

export interface FakeHarness {
  readonly workers: FakeWorker[];
  readonly factory: WorkerFactory;
  readonly config: FakeWorkerConfig;
  handler: ((message: MainToWorker, worker: FakeWorker) => void) | null;
}

export function createFakeHarness(config: FakeWorkerConfig = {}): FakeHarness {
  const workers: FakeWorker[] = [];
  const harness: FakeHarness = {
    workers,
    config,
    handler: null,
    factory: ({ workerId }) => {
      const worker = new FakeWorker(workerId, harness.config);
      worker.handler = (message, current): void => {
        harness.handler?.(message, current);
      };
      workers.push(worker);
      return worker;
    },
  };
  return harness;
}

export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
