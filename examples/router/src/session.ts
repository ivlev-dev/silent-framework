import { createSignal, type Accessor, type Setter } from "@ivlev-dev/silent-reactivity";

export class Session {
  private readonly state: [Accessor<string | null>, Setter<string | null>];

  constructor(initialUser: string | null = null) {
    this.state = createSignal<string | null>(initialUser);
  }

  get user(): string | null {
    return this.state[0]();
  }

  get authenticated(): boolean {
    return this.state[0]() !== null;
  }

  login(user = "Алиса"): void {
    this.state[1](user);
  }

  logout(): void {
    this.state[1](null);
  }
}
