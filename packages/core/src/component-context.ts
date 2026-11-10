import type { Container } from "@ivlev-dev/silent-di";

export interface ComponentContextValue<P = unknown> {
  readonly props: P;
  readonly container: Container;
  readonly signal: AbortSignal;
  view: Node | null;
}

export type SignalSource = AbortSignal | (() => AbortSignal);

export class ComponentContext<P = unknown> implements ComponentContextValue<P> {
  readonly props: P;
  readonly container: Container;
  view: Node | null = null;
  private readonly source: SignalSource;
  private resolved: AbortSignal | null = null;

  constructor(props: P, container: Container, signal: SignalSource) {
    this.props = props;
    this.container = container;
    this.source = signal;
  }

  get signal(): AbortSignal {
    if (this.resolved === null) {
      this.resolved = typeof this.source === "function" ? this.source() : this.source;
    }
    return this.resolved;
  }
}
