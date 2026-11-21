import { getRuntimeContextStore } from "./runtime-context-provider.js";

const ID_STATE = Symbol.for("silent.id.state");

interface IdState {
  count: number;
}

type IdHost = typeof globalThis & {
  [ID_STATE]?: IdState;
};

export interface IdGenerator {
  readonly count: number;
  next(prefix?: string): string;
  reset(): void;
}

function idState(): IdState {
  const host = globalThis as IdHost;
  let state = host[ID_STATE];
  if (state === undefined) {
    state = { count: 0 };
    host[ID_STATE] = state;
  }
  return state;
}

function format(prefix: string, value: number): string {
  return `${prefix}-${value}`;
}

export function createId(prefix = "silent"): string {
  const store = getRuntimeContextStore();
  if (store !== null) {
    store.idCount += 1;
    return format(prefix, store.idCount);
  }
  const state = idState();
  state.count += 1;
  return format(prefix, state.count);
}

export function useId(prefix = "silent"): string {
  return createId(prefix);
}

export function resetIds(): void {
  const store = getRuntimeContextStore();
  if (store !== null) {
    store.idCount = 0;
    return;
  }
  idState().count = 0;
}

export function currentIdCount(): number {
  const store = getRuntimeContextStore();
  return store !== null ? store.idCount : idState().count;
}

export function withIdScope<T>(fn: () => T): T {
  const store = getRuntimeContextStore();
  if (store !== null) {
    const previous = store.idCount;
    store.idCount = 0;
    try {
      return fn();
    } finally {
      store.idCount = previous;
    }
  }
  const state = idState();
  const previous = state.count;
  state.count = 0;
  try {
    return fn();
  } finally {
    state.count = previous;
  }
}

export class IdSequence implements IdGenerator {
  readonly #prefix: string;
  #count = 0;

  constructor(prefix = "silent") {
    this.#prefix = prefix;
  }

  get count(): number {
    return this.#count;
  }

  next(prefix: string = this.#prefix): string {
    this.#count += 1;
    return format(prefix, this.#count);
  }

  reset(): void {
    this.#count = 0;
  }
}

export function createIdGenerator(prefix = "silent"): IdSequence {
  return new IdSequence(prefix);
}
