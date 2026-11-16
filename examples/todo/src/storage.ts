export interface StoredTodo {
  readonly title: string;
  readonly done: boolean;
}

export interface TodoStorage {
  load(): readonly StoredTodo[];
  save(items: readonly StoredTodo[]): void;
}

const KEY = "silent.todo.items";

export class LocalTodoStorage implements TodoStorage {
  load(): readonly StoredTodo[] {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const items: StoredTodo[] = [];
      for (const entry of parsed) {
        if (typeof entry !== "object" || entry === null) {
          continue;
        }
        const record = entry as Record<string, unknown>;
        const title = record["title"];
        const done = record["done"];
        if (typeof title === "string" && typeof done === "boolean") {
          items.push({ title, done });
        }
      }
      return items;
    } catch {
      return [];
    }
  }

  save(items: readonly StoredTodo[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      return;
    }
  }
}
