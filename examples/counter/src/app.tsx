import type { AppVM } from "./app.vm";
import { AppPreloader } from "./preloader";
import { Counter } from "./counter";

export function App(
  this: { vm: AppVM; preloader: typeof AppPreloader },
  props: { title: string },
) {
  return (
    <main class="app">
      <h1>{props.title}</h1>
      <Counter step={this.vm.step} />
    </main>
  );
}
