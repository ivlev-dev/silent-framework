import { createSignal, For } from "@ivlev-dev/silent-core";

interface Row {
  readonly id: number;
  readonly label: string;
}

export const ROWS = 20;

function createRows(): readonly Row[] {
  return Array.from({ length: ROWS }, (_, id) => ({
    id,
    label: `Item ${String(id)}`,
  }));
}

export function App(props: { readonly title: string }): Node {
  const [rows] = createSignal<readonly Row[]>(createRows());

  return (
    <div class="app">
      <h1>{props.title}</h1>
      <ul class="list">
        <For each={rows()}>{(row: Row) => <li>{row.label}</li>}</For>
      </ul>
    </div>
  );
}
