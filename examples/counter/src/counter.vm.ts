import type { CounterService } from "./service";
import { computed, reactive, ViewModel, watch } from "@ivlev98/silent-core";

export class Item {
  @reactive accessor name: string;

  constructor(name: string) {
    this.name = name;
  }
}

export interface CounterProps {
  step: number;
}

export class CounterVM extends ViewModel<CounterProps> {
  @reactive accessor count = 0;
  @reactive accessor items: Item[] = [];
  @reactive accessor user = { name: "Ann", address: { city: "Moscow" } };
  readonly events: string[] = [];

  constructor(private readonly service: CounterService) {
    super();
  }

  @computed get double(): number {
    return this.count * 2;
  }

  @computed get city(): string {
    return this.user.address.city;
  }

  @watch((vm: CounterVM) => vm.count, { immediate: true })
  onCount(next: number, prev: number | undefined): void {
    this.service.log(`count ${String(prev)} -> ${next}`);
  }

  created(): void {
    this.events.push("created");
  }

  mounted(): void {
    this.events.push("mounted");
    this.service.log(`mounted at ${this.service.timestamp()}`);
  }

  unmounted(): void {
    this.events.push("unmounted");
  }

  increment(step: number): void {
    this.count += step;
  }

  decrement(): void {
    this.count -= 1;
  }

  addItem(): void {
    this.items.push(new Item(`item-${this.items.length + 1}`));
  }

  renameFirst(): void {
    const first = this.items[0];
    if (first !== undefined) {
      first.name = `${first.name}!`;
    }
  }

  removeFirst(): void {
    this.items.shift();
  }

  changeCity(): void {
    this.user.address.city = this.user.address.city === "Moscow" ? "Kazan" : "Moscow";
  }
}
