import type { CounterVM } from "./counter.vm";

export function CounterPreloader() {
  return <span class="loading">Загрузка…</span>;
}

export function Counter(
  this: { vm: CounterVM; preloader: typeof CounterPreloader },
) {
  return (
    <section class="counter">
      <button type="button" onClick={() => this.vm.increment()}>
        +
      </button>
      <span class="value">{this.vm.count}</span>
      <span class="double">{this.vm.double}</span>
    </section>
  );
}
