import { For } from "@ivlev-dev/silent-core";
import type { Todo } from "./todo";
import type { Filter, TodoVM } from "./todo.vm";

interface FilterOption {
  readonly id: Filter;
  readonly label: string;
}

const FILTERS: readonly FilterOption[] = [
  { id: "all", label: "Все" },
  { id: "active", label: "Активные" },
  { id: "completed", label: "Выполненные" },
];

export function App(this: { vm: TodoVM }, props: { title: string }) {
  return (
    <main class="app">
      <title>Silent Framework: задачи</title>
      <h1>{props.title}</h1>
      <section class="todo">
        <div class="row">
          <input
            class="draft"
            value={this.vm.draft}
            placeholder="Что нужно сделать?"
            onInput={(event: InputEvent) => {
              if (event.target instanceof HTMLInputElement) {
                this.vm.setDraft(event.target.value);
              }
            }}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Enter") {
                this.vm.add();
              }
            }}
          />
          <button class="add" onClick={() => this.vm.add()}>
            Добавить
          </button>
        </div>
        <div class="filters">
          <For each={FILTERS}>
            {(option: FilterOption) => (
              <button
                class={this.vm.filter === option.id ? "chip chip-active" : "chip"}
                onClick={() => this.vm.setFilter(option.id)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
        <ul class="items">
          <For each={this.vm.visible}>
            {(todo: Todo) => (
              <li class={todo.done ? "done" : ""}>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => this.vm.toggle(todo)}
                />
                <span class="title">{todo.title}</span>
                <button class="remove" onClick={() => this.vm.remove(todo)}>
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
        <footer class="summary">
          Осталось: <span class="remaining">{this.vm.remaining}</span> · Выполнено:{" "}
          <span class="completed">{this.vm.completed}</span>
          <button class="clear" onClick={() => this.vm.clearCompleted()}>
            Очистить выполненные
          </button>
        </footer>
      </section>
    </main>
  );
}
