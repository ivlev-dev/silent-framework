import { createSignal, For } from "@ivlev-dev/silent-core";

interface Row {
  readonly id: number;
  readonly label: string;
}

const ROWS = 100;

function createRows(): readonly Row[] {
  return Array.from({ length: ROWS }, (_, id) => ({
    id,
    label: "Item " + String(id),
  }));
}

export function App(props: { readonly title: string }) {
  const [count, setCount] = createSignal(0);
  const [rows, setRows] = createSignal<readonly Row[]>(createRows());

  return (
    <main class="app">
      <h1>{props.title}</h1>
      <section class="counter">
        <button type="button" onClick={() => setCount(count() - 1)}>-</button>
        <strong class="value">{count}</strong>
        <button type="button" onClick={() => setCount(count() + 1)}>+</button>
      </section>
      <ul class="list">
        <For each={rows}>{(row: Row) => <li>{row.label}</li>}</For>
      </ul>
      <button
        type="button"
        onClick={() =>
          setRows((previous) => [
            ...previous,
            { id: previous.length, label: "Item " + String(previous.length) },
          ])
        }
      >
        Add
      </button>
    </main>
  );
}
