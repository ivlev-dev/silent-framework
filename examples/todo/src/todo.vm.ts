import { computed, reactive, ViewModel } from "@ivlev-dev/silent-core";
import type { TodoStorage } from "./storage";
import { Todo } from "./todo";

export type Filter = "all" | "active" | "completed";

export class TodoVM extends ViewModel<{ title: string }> {
  @reactive accessor draft = "";
  @reactive accessor filter: Filter = "all";
  @reactive accessor items: Todo[] = [];

  constructor(private readonly storage: TodoStorage) {
    super();
  }

  @computed get visible(): Todo[] {
    const filter = this.filter;
    return this.items.filter((todo) => {
      if (filter === "active") {
        return !todo.done;
      }
      if (filter === "completed") {
        return todo.done;
      }
      return true;
    });
  }

  @computed get remaining(): number {
    let count = 0;
    for (const todo of this.items) {
      if (!todo.done) {
        count += 1;
      }
    }
    return count;
  }

  @computed get completed(): number {
    return this.items.length - this.remaining;
  }

  created(): void {
    const stored = this.storage.load();
    const items: Todo[] = [];
    for (const entry of stored) {
      items.push(new Todo(entry.title, entry.done));
    }
    this.items = items;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  setFilter(next: Filter): void {
    this.filter = next;
  }

  add(): void {
    const title = this.draft.trim();
    if (title === "") {
      return;
    }
    this.items.push(new Todo(title));
    this.draft = "";
    this.persist();
  }

  toggle(todo: Todo): void {
    todo.done = !todo.done;
    this.persist();
  }

  remove(todo: Todo): void {
    const index = this.items.indexOf(todo);
    if (index < 0) {
      return;
    }
    this.items.splice(index, 1);
    this.persist();
  }

  clearCompleted(): void {
    this.items = this.items.filter((todo) => !todo.done);
    this.persist();
  }

  private persist(): void {
    this.storage.save(
      this.items.map((todo) => ({ title: todo.title, done: todo.done })),
    );
  }
}
