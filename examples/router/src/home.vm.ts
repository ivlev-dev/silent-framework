import { computed, ViewModel } from "@ivlev-dev/silent-core";
import { Session } from "./session";

export class HomeVM extends ViewModel {
  constructor(private readonly session: Session) {
    super();
  }

  @computed get user(): string | null {
    return this.session.user;
  }

  @computed get label(): string {
    return this.session.user ?? "гость";
  }
}
