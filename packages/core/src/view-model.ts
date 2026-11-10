import { storeFor } from "@ivlev-dev/silent-reactivity";

export abstract class ViewModel<P = unknown> {
  props!: P;
  view!: Node;

  created?(): void;
  beforeMount?(): void;
  mounted?(): void;
  updated?(): void;
  beforeUnmount?(): void;
  unmounted?(): void;

  dispose(): void {
    storeFor(this).dispose();
  }
}
