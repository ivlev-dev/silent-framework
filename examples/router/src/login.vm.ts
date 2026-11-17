import { computed, ViewModel } from "@ivlev-dev/silent-core";
import type { IRouter, RouteViewProps } from "@ivlev-dev/silent-router";
import { Session } from "./session";

export type LoginQuery = { readonly next?: string };

export class LoginVM extends ViewModel<RouteViewProps<"/login", LoginQuery>> {
  constructor(
    private readonly router: IRouter,
    private readonly session: Session,
  ) {
    super();
  }

  @computed get next(): string {
    const next = this.props.query.next;
    if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("/login")) {
      return "/private/profile";
    }
    return next;
  }

  async submit(): Promise<void> {
    this.session.login("Алиса");
    await this.router.navigate(this.next);
  }
}
