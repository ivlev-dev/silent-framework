import { reactive, ViewModel } from "@ivlev-dev/silent-core";

export class AppVM extends ViewModel<{ title: string }> {
  @reactive accessor step = 2;
}
