import { createSignal, For } from "@ivlev-dev/silent-core";
import { createRows, type Row } from "../../shared/app-data";

export function App(props: { readonly title: string }) {
  const [count, setCount] = createSignal(0);
  const [rows] = createSignal<readonly Row[]>(createRows());

  return (
    <main class="app">
      <h1>{props.title}</h1>
      <section class="counter">
        <button type="button" onClick={() => setCount(count() - 1)}>-</button>
        <strong class="value">{count()}</strong>
        <button type="button" onClick={() => setCount(count() + 1)}>+</button>
      </section>
      <ul class="list">
        <For each={rows()}>{(row: Row) => <li>{row.label}</li>}</For>
      </ul>
    </main>
  );
}
