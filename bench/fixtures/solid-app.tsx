/** @jsxImportSource solid-js */

import { createSignal, For, type JSX } from "solid-js";

interface Row {
  readonly id: number;
  readonly label: string;
}

const ROWS = 20;

function createRows(): readonly Row[] {
  return Array.from({ length: ROWS }, (_, id) => ({ id, label: `Item ${id}` }));
}

export function App(props: { readonly title: string }): JSX.Element {
  const [title] = createSignal(props.title);
  const [rows] = createSignal<readonly Row[]>(createRows());

  return (
    <div class="app">
      <h1>{title()}</h1>
      <ul class="list">
        <For each={rows()}>{(row) => <li>{row.label}</li>}</For>
      </ul>
    </div>
  );
}
