import { computed, ViewModel } from "@ivlev-dev/silent-core";
import type { IRouter } from "@ivlev-dev/silent-router";

export class AppVM extends ViewModel<{ title: string }> {
  constructor(private readonly router: IRouter) {
    super();
  }

  @computed get pending(): boolean {
    return this.router.state().pending;
  }

  @computed get location(): string {
    return this.router.state().route?.fullPath ?? "/";
  }

  back(): void {
    this.router.back();
  }
}
