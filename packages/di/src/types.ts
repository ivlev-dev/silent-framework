import type { Container } from "./container.js";

export type ScopeName = "singleton" | "transient" | "scoped";

export type Factory<T> = (container: Container) => T | Promise<T>;

export interface Binding<T = unknown> {
  readonly factory: Factory<T>;
  scope: ScopeName;
}

export interface BindingBuilder {
  inSingletonScope(): BindingBuilder;
  inTransientScope(): BindingBuilder;
  inScopedScope(): BindingBuilder;
}
