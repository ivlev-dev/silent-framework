export type AnyComponent = (...args: never[]) => unknown;
export type Preloader = (...args: never[]) => unknown;

export interface ViewMeta {
  readonly vm: unknown;
  readonly preloader?: Preloader | undefined;
  readonly preloaderName?: string | undefined;
  readonly name?: string | undefined;
  readonly moduleId?: string | undefined;
}

export interface ViewRuntimeContext {
  readonly vm: object;
  readonly preloader: Preloader | null;
}
