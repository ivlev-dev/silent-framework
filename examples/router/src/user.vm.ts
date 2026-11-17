import { computed, ViewModel } from "@ivlev-dev/silent-core";
import type { IRouter } from "@ivlev-dev/silent-router";

export class UserVM extends ViewModel<{ params: { id: string } }> {
  constructor(private readonly router: IRouter) {
    super();
  }

  @computed get nextId(): number {
    const id = Number(this.props.params.id);
    return Number.isFinite(id) ? id + 1 : 1;
  }

  next(): void {
    void this.router.push({
      name: "user",
      params: { id: this.nextId },
      query: { tab: "info" },
    });
  }
}
