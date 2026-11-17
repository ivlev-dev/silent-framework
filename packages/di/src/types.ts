import type { Container } from "./container.js";

export type ScopeName = "singleton" | "transient" | "scoped";

export type ImplicitBindingMode = "allow" | "warn" | "error";

export interface ContainerOptions {
  readonly implicitBindings?: ImplicitBindingMode;
}

export type Factory<T> = (container: Container) => T | Promise<T>;

export interface Binding<T = unknown> {
  readonly factory: Factory<T>;
  scope: ScopeName;
}

export interface ContainerResolutionEvent {
  readonly token: unknown;
  readonly tokenName: string;
  readonly container: string;
  readonly owner: string;
  readonly scope: ScopeName;
  readonly implicit: boolean;
  readonly cached: boolean;
}

export type ContainerResolutionInspector = (event: ContainerResolutionEvent) => void;

export interface BindingBuilder {
  inSingletonScope(): BindingBuilder;
  inTransientScope(): BindingBuilder;
  inScopedScope(): BindingBuilder;
}
