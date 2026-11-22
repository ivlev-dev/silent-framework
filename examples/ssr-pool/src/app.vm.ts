import { reactive, ViewModel } from "@ivlev-dev/silent-core";

/** Аргументы рендера: structured-cloneable, чтобы их можно было отдать воркеру. */
export interface RenderArgs {
  readonly [key: string]: unknown;
  readonly title: string;
  readonly delayMs?: number | undefined;
  readonly late?: boolean | undefined;
  readonly fail?: boolean | undefined;
  /** Метка запроса для e2e-проверки изоляции стримов. */
  readonly req?: string | undefined;
}

export class AppVM extends ViewModel<RenderArgs> {
  @reactive accessor clicks = 0;

  increment(): void {
    this.clicks += 1;
  }
}
