import type { CounterVM } from "./counter.vm";
import { CounterPreloader } from "./preloader";
import { For } from "@ivlev-dev/silent-core";

export function Counter(
  this: { vm: CounterVM; preloader: typeof CounterPreloader },
  props: { step: number },
) {
  return (
    <section class="counter">
      <h2>Счётчик</h2>
      <div class="row">
        <button onClick={() => this.vm.decrement()}>-</button>
        <strong class="value">{this.vm.count}</strong>
        <button onClick={() => this.vm.increment(props.step)}>+</button>
      </div>
      <p>
        Двойное значение: <span class="double">{this.vm.double}</span>
      </p>
      <p>
        Город: <span class="city">{this.vm.city}</span>{" "}
        <button onClick={() => this.vm.changeCity()}>Сменить город</button>
      </p>
      <div class="row">
        <button onClick={() => this.vm.addItem()}>Добавить</button>
        <button onClick={() => this.vm.renameFirst()}>Переименовать первый</button>
        <button onClick={() => this.vm.removeFirst()}>Удалить первый</button>
      </div>
      <ul class="items">
        <For each={this.vm.items}>
          {(item: { name: string }) => <li>{item.name}</li>}
        </For>
      </ul>
    </section>
  );
}
