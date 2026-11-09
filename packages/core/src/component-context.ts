import type { Container } from "@silent/di";

export interface ComponentContextValue<P = unknown> {
  readonly props: P;
  readonly container: Container;
  readonly signal: AbortSignal;
  view: Node | null;
}

export class ComponentContext<P = unknown> implements ComponentContextValue<P> {
  readonly props: P;
  readonly container: Container;
  readonly signal: AbortSignal;
  view: Node | null;

  constructor(props: P, container: Container, signal: AbortSignal) {
    this.props = props;
    this.container = container;
    this.signal = signal;
    this.view = null;
  }
}
