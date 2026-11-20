export interface NativeModule {
  transform(source: string, filename: string, optionsJson: string, indexJson: string): string;
  scan(root: string, optionsJson: string): string;
  version(): string;
}

export type Libc = "gnu" | "musl";

export interface TripleOptions {
  platform: string;
  arch: string;
  libc?: Libc;
  allowGnuFallback?: boolean;
}

export interface LoadNativeOptions {
  requireModule: (name: string) => unknown;
  nativeDirectory: string;
  triples: readonly string[];
}

export declare const NATIVE_PACKAGE_PREFIX: string;

export declare function detectLibc(report?: unknown): Libc;
export declare function resolveNativeTriples(options: TripleOptions): string[];
export declare function nativePackageName(triple: string): string;
export declare function isNativeModule(value: unknown): value is NativeModule;
export declare function nativeLoadError(triples: readonly string[], reasons: readonly string[]): Error;
export declare function loadNative(options: LoadNativeOptions): NativeModule;
