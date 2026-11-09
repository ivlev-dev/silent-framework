import { reactive, ViewModel } from "@silent/core";

export class AppVM extends ViewModel<{ title: string }> {
  @reactive accessor step = 2;
}
