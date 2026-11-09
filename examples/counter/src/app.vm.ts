import { reactive, ViewModel } from "@ivlev98/silent-core";

export class AppVM extends ViewModel<{ title: string }> {
  @reactive accessor step = 2;
}
