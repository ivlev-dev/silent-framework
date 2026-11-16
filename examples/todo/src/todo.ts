import { reactive } from "@ivlev-dev/silent-core";

export class Todo {
  @reactive accessor title: string;
  @reactive accessor done = false;

  constructor(title: string, done = false) {
    this.title = title;
    this.done = done;
  }
}
