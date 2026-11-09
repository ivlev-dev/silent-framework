import { describe, expect, it, vi } from "vitest";
import {
  createEffect,
  flushSync,
  isReactiveClass,
  storeFor,
} from "@silent/reactivity";
import { computed, reactive, watch } from "../src/decorators";

type CountCall = { next: number; prev: number | undefined };

class Counter {
  @reactive accessor count = 0;
}

class Model {
  @reactive accessor count = 0;
  @reactive accessor other = 0;
  computations = 0;
  readonly calls: CountCall[] = [];

  @computed
  get double(): number {
    this.computations += 1;
    return this.count * 2;
  }

  @watch((vm: Model) => vm.count, { immediate: true })
  onCount(next: number, prev: number | undefined): void {
    this.calls.push({ next, prev });
  }
}

class Profile {
  @reactive accessor profile = { name: "a", tags: ["x", "y"] };
}

class List {
  @reactive accessor items = [1, 2];
}

class Base {
  @reactive accessor value = 1;
  readonly calls: number[] = [];

  @watch((vm: Base) => vm.value, { immediate: true })
  onValue(next: number): void {
    this.calls.push(next);
  }
}

class Derived extends Base {
  @reactive accessor extra = 10;
}

class Tolerance {
  @reactive accessor value = 0;
  readonly calls: number[] = [];

  @watch((vm: Tolerance) => vm.value, {
    equals: (a, b) => Math.floor(a / 10) === Math.floor(b / 10),
  })
  onValue(next: number): void {
    this.calls.push(next);
  }
}

describe("reactive", () => {
  it("читает и пишет значение", () => {
    const vm = new Counter();
    expect(vm.count).toBe(0);
    vm.count = 3;
    expect(vm.count).toBe(3);
    expect(isReactiveClass(Counter)).toBe(true);
  });

  it("эффект реагирует только на нужные поля", () => {
    const vm = new Model();
    let runs = 0;
    let snapshot = 0;
    createEffect(() => {
      snapshot = vm.count;
      runs += 1;
    });
    flushSync();
    vm.other = 5;
    flushSync();
    expect(runs).toBe(1);
    expect(vm.other).toBe(5);
    vm.count = 1;
    flushSync();
    expect(runs).toBe(2);
    expect(snapshot).toBe(1);
  });

  it("работает с вложенными объектами", () => {
    const vm = new Profile();
    let name = "";
    createEffect(() => {
      name = vm.profile.name;
    });
    flushSync();
    expect(name).toBe("a");
    vm.profile.name = "b";
    flushSync();
    expect(name).toBe("b");
    vm.profile = { name: "c", tags: [] };
    flushSync();
    expect(name).toBe("c");
  });

  it("массив: push/splice обновляют эффект", () => {
    const vm = new List();
    let first = 0;
    let length = 0;
    createEffect(() => {
      first = vm.items[0] as number;
      length = vm.items.length;
    });
    flushSync();
    expect(first).toBe(1);
    expect(length).toBe(2);
    vm.items.push(3);
    flushSync();
    expect(length).toBe(3);
    expect(first).toBe(1);
    vm.items.splice(0, 1);
    flushSync();
    expect(length).toBe(2);
    expect(first).toBe(2);
  });

  it("два экземпляра независимы", () => {
    const a = new Counter();
    const b = new Counter();
    a.count = 5;
    expect(a.count).toBe(5);
    expect(b.count).toBe(0);
    let value = 0;
    createEffect(() => {
      value = a.count;
    });
    flushSync();
    b.count = 7;
    flushSync();
    expect(value).toBe(5);
  });

  it("работает при наследовании", () => {
    const derived = new Derived();
    expect(derived.value).toBe(1);
    expect(derived.extra).toBe(10);
    let value = 0;
    let extra = 0;
    createEffect(() => {
      value = derived.value;
      extra = derived.extra;
    });
    flushSync();
    derived.value = 2;
    derived.extra = 20;
    flushSync();
    expect(value).toBe(2);
    expect(extra).toBe(20);
    expect(isReactiveClass(Derived)).toBe(true);
  });
});

describe("computed", () => {
  it("кешируется и обновляется при изменении зависимостей", () => {
    const vm = new Model();
    expect(vm.double).toBe(0);
    expect(vm.double).toBe(0);
    expect(vm.computations).toBe(1);
    vm.count = 2;
    expect(vm.double).toBe(4);
    expect(vm.double).toBe(4);
    expect(vm.computations).toBe(2);
  });
});

describe("watch", () => {
  it("immediate: первый вызов с prev = undefined", () => {
    const vm = new Model();
    flushSync();
    expect(vm.calls).toEqual([{ next: 0, prev: undefined }]);
  });

  it("вызывает обработчик при изменениях и передаёт prev", () => {
    const vm = new Model();
    flushSync();
    vm.count = 1;
    flushSync();
    expect(vm.calls).toEqual([
      { next: 0, prev: undefined },
      { next: 1, prev: 0 },
    ]);
    vm.count = 1;
    flushSync();
    expect(vm.calls).toHaveLength(2);
  });

  it("без immediate не вызывает на первом запуске", () => {
    const onCount = vi.fn();
    class Quiet {
      @reactive accessor count = 0;

      @watch((vm: Quiet) => vm.count)
      onCount(next: number, prev: number | undefined): void {
        onCount(next, prev);
      }
    }
    const vm = new Quiet();
    flushSync();
    expect(onCount).not.toHaveBeenCalled();
    vm.count = 1;
    flushSync();
    expect(onCount).toHaveBeenCalledTimes(1);
    expect(onCount).toHaveBeenCalledWith(1, 0);
  });

  it("dispose store останавливает отслеживание", () => {
    const vm = new Model();
    flushSync();
    vm.count = 2;
    flushSync();
    expect(vm.calls).toHaveLength(2);
    storeFor(vm).dispose();
    vm.count = 3;
    flushSync();
    expect(vm.calls).toHaveLength(2);
  });

  it("кастомный equals группирует значения", () => {
    const vm = new Tolerance();
    flushSync();
    vm.value = 5;
    flushSync();
    expect(vm.calls).toHaveLength(0);
    vm.value = 12;
    flushSync();
    expect(vm.calls).toEqual([12]);
    vm.value = 19;
    flushSync();
    expect(vm.calls).toEqual([12]);
  });

  it("без двойной регистрации при наследовании", () => {
    const derived = new Derived();
    flushSync();
    expect(derived.calls).toEqual([1]);
    derived.value = 2;
    flushSync();
    expect(derived.calls).toEqual([1, 2]);
  });
});
