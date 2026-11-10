import { describe, expect, it } from "vitest";
import { flushSync, storeFor } from "@ivlev-dev/silent-reactivity";
import { reactive, watch } from "../src/decorators";
import { ViewModel } from "../src/view-model";

class CounterVM extends ViewModel<{ count: number }> {
  @reactive accessor count = 0;
  unmountCount = 0;
  view: Node = document.createElement("div");

  mounted?(): void;

  unmounted(): void {
    this.unmountCount += 1;
  }

  @watch((vm: CounterVM) => vm.count)
  onCount(next: number): void {
    this.logs.push(next);
  }

  readonly logs: number[] = [];
}

class PlainVM {
  props!: { id: number };
  updated(): void {

  }
}

describe("ViewModel", () => {
  it("prop-сы и view доступны", () => {
    const vm = new CounterVM();
    const node = document.createElement("span");
    vm.props = { count: 3 };
    vm.view = node;
    expect(vm.props.count).toBe(3);
    expect(vm.view).toBe(node);
  });

  it("dispose освобождает reactive-ресурсы", () => {
    const vm = new CounterVM();
    flushSync();
    vm.count = 1;
    flushSync();
    expect(vm.logs).toEqual([1]);
    expect(storeFor(vm).disposed).toBe(false);
    vm.dispose();
    expect(storeFor(vm).disposed).toBe(true);
    expect(vm.unmountCount).toBe(0);
    vm.count = 2;
    flushSync();
    expect(vm.logs).toEqual([1]);
  });

  it("dispose безопасен при повторном вызове", () => {
    const vm = new CounterVM();
    vm.dispose();
    expect(() => vm.dispose()).not.toThrow();
    expect(storeFor(vm).disposed).toBe(true);
  });

  it("наследование ViewModel не обязательно", () => {
    const vm = new PlainVM();
    vm.props = { id: 1 };
    expect(vm.props.id).toBe(1);
    expect(typeof vm.updated).toBe("function");
  });
});
