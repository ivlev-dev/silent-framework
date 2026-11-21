/**
 * Внутренний контракт per-render контекста для серверного рантайма.
 * @internal
 */
import type { RuntimeOptions } from "./component-state.js";
import type { ServerStreamCollector } from "./server-stream.js";

/**
 * Состояние одного рендера. Store живёт в async-контексте (провайдером),
 * а не в модульной переменной процесса: параллельные SSR-запросы не должны
 * видеть опции, metadata/stream-коллекторы и счётчик id друг друга.
 *
 * Модуль намеренно не импортирует `node:*`: провайдер (AsyncLocalStorage)
 * регистрирует серверный пакет, core работает с абстракцией.
 *
 * @internal
 */
export interface RuntimeContextStore {
  active: boolean;
  server: boolean;
  options: RuntimeOptions;
  metadata: ((node: Element) => void) | null;
  stream: ServerStreamCollector | null;
  idCount: number;
  pending: Set<Promise<unknown>>;
}

/** Контракт провайдера: хранилище текущей async-цепочки и запуск в нём. @internal */
export interface RuntimeContextProvider {
  readonly name: string;
  getStore(): RuntimeContextStore | null;
  run<T>(store: RuntimeContextStore, fn: () => T): T;
}

let provider: RuntimeContextProvider | null = null;

/** Устанавливает провайдер контекста (null — снимает). @internal */
export function setRuntimeContextProvider(next: RuntimeContextProvider | null): void {
  provider = next;
}

/** Возвращает зарегистрированный провайдер или null. @internal */
export function getRuntimeContextProvider(): RuntimeContextProvider | null {
  return provider;
}

/** Проверяет, зарегистрирован ли провайдер контекста. @internal */
export function hasRuntimeContextProvider(): boolean {
  return provider !== null;
}

/** Создаёт состояние нового рендера. @internal */
export function createRuntimeContextStore(init: {
  server?: boolean;
  options?: RuntimeOptions;
  metadata?: ((node: Element) => void) | null;
  stream?: ServerStreamCollector | null;
  pending?: Set<Promise<unknown>>;
} = {}): RuntimeContextStore {
  return {
    active: true,
    server: init.server ?? false,
    options: init.options ?? {},
    metadata: init.metadata ?? null,
    stream: init.stream ?? null,
    idCount: 0,
    pending: init.pending ?? new Set<Promise<unknown>>(),
  };
}

/**
 * Активный (не closed) store текущей async-цепочки или null.
 * Клиентский путь (провайдер не зарегистрирован) выходит на первой проверке,
 * без обращений к async-контексту и без аллокаций.
 *
 * @internal
 */
export function getRuntimeContextStore(): RuntimeContextStore | null {
  if (provider === null) {
    return null;
  }
  const store = provider.getStore();
  return store !== null && store.active ? store : null;
}
