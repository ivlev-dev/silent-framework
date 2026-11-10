import type { AppVM } from "./app.vm";
import { Counter } from "./counter";

export function App(this: { vm: AppVM }, props: { title: string }) {
  return (
    <main class="app">
      <title>{props.title}</title>
      <meta name="description" content="Silent Framework: SSR-счётчик" />
      <h1>{props.title}</h1>
      <p>Сервер отрендерил разметку, клиент её адоптировал.</p>
      <Counter />
    </main>
  );
}
