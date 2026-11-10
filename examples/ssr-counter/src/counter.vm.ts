import { computed, reactive, ViewModel } from "@ivlev-dev/silent-core";

export class CounterVM extends ViewModel<Record<string, never>> {
  @reactive accessor count = 0;

  @computed get double(): number {
    return this.count * 2;
  }

  increment(): void {
    this.count += 1;
  }
}
