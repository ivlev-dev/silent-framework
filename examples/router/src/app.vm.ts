import { computed, ViewModel } from "@ivlev-dev/silent-core";
import type { IRouter } from "@ivlev-dev/silent-router";
import { Session } from "./session";

export class AppVM extends ViewModel<{ title: string }> {
  constructor(
    private readonly router: IRouter,
    private readonly session: Session,
  ) {
    super();
  }

  @computed get pending(): boolean {
    return this.router.state().pending;
  }

  @computed get location(): string {
    return this.router.state().route?.fullPath ?? "/";
  }

  @computed get user(): string | null {
    return this.session.user;
  }

  @computed get metaTitle(): string {
    const title = this.router.meta["title"];
    return typeof title === "string" ? title : "без meta";
  }

  back(): void {
    this.router.back();
  }

  logout(): void {
    this.session.logout();
    void this.router.navigate("/");
  }
}
