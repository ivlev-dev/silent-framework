export type Accessor<T> = () => T;

export type Setter<T> = (value: T | ((prev: T) => T)) => T;

export type EffectErrorHandler = (error: unknown, owner: Owner | null) => void;

export interface SignalOptions<T> {
  equals?: (a: T, b: T) => boolean;
}

export interface MemoOptions<T> extends SignalOptions<T> {
  name?: string;
}

export interface Owner {
  readonly disposed: boolean;
  dispose(): void;
}

export interface ReactiveStore {
  readonly disposed: boolean;
  dispose(): void;
}

export interface OnOptions {
  defer?: boolean;
}
