/** @jsxImportSource solid-js */

/** @jsxImportSource solid-js */

import { createSignal, For, type JSX } from "solid-js";
import { createRows, type Row } from "../../shared/app-data";

export function App(props: { readonly title: string }): JSX.Element {
  const [count, setCount] = createSignal(0);
  const [rows] = createSignal<readonly Row[]>(createRows());

  return (
    <main class="app">
      <h1>{props.title}</h1>
      <section class="counter">
        <button type="button" onClick={() => setCount((value) => value - 1)}>-</button>
        <strong class="value">{count()}</strong>
        <button type="button" onClick={() => setCount((value) => value + 1)}>+</button>
      </section>
      <ul class="list">
        <For each={rows()}>{(row) => <li>{row.label}</li>}</For>
      </ul>
    </main>
  );
}
