import {
  batch,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  deepReactive,
  flushSync,
  type Setter,
} from "@ivlev-dev/silent-reactivity";
import { For, text } from "@ivlev-dev/silent-core";
import { createHost, documentRef } from "./env";
import type { BenchSuite, BenchTask } from "./suite";

interface Row {
  readonly id: number;
}

function createRows(count: number): Row[] {
  return Array.from({ length: count }, (_, id) => ({ id }));
}

function renderRow(row: Row): Node {
  const element = documentRef.createElement("div");
  element.textContent = String(row.id);
  return element;
}

interface KeyedList {
  readonly setItems: Setter<readonly Row[]>;
  readonly dispose: () => void;
}

function setupKeyedList(initial: readonly Row[]): KeyedList {
  const host = createHost();
  const [items, setItems] = createSignal<readonly Row[]>(initial);
  const dispose = createRoot((disposeRoot) => {
    host.appendChild(For({ each: items, children: renderRow }));
    return disposeRoot;
  });
  return { setItems, dispose };
}

const SIGNAL_WRITES = 10_000;
const MEMO_WRITES = 5_000;
const STORE_WRITES = 10_000;
const TEXT_WRITES = 10_000;
const LIST_SIZE = 1_000;
const APPEND_SIZE = 100;

const signalWrites: BenchTask = {
  name: "signal: 10k writes",
  fn: () => {
    const [value, setValue] = createSignal(0);
    let sink = 0;
    const dispose = createRoot((disposeRoot) => {
      createRenderEffect(() => {
        sink += value();
      });
      return disposeRoot;
    });
    for (let index = 0; index < SIGNAL_WRITES; index += 1) {
      setValue(index);
      flushSync();
    }
    dispose();
    if (sink < 0) {
      throw new Error("unreachable");
    }
  },
};

const batchedWrites: BenchTask = {
  name: "signal: 10k batched writes",
  fn: () => {
    const [value, setValue] = createSignal(0);
    let sink = 0;
    const dispose = createRoot((disposeRoot) => {
      createRenderEffect(() => {
        sink += value();
      });
      return disposeRoot;
    });
    batch(() => {
      for (let index = 0; index < SIGNAL_WRITES; index += 1) {
        setValue(index);
      }
    });
    flushSync();
    dispose();
    if (sink < 0) {
      throw new Error("unreachable");
    }
  },
};

const memoChain: BenchTask = {
  name: "memo chain: 5k writes",
  fn: () => {
    const [value, setValue] = createSignal(1);
    let sink = 0;
    const dispose = createRoot((disposeRoot) => {
      const double = createMemo(() => value() * 2);
      const quadruple = createMemo(() => double() * 2);
      const shifted = createMemo(() => quadruple() + 1);
      createRenderEffect(() => {
        sink += shifted();
      });
      return disposeRoot;
    });
    for (let index = 0; index < MEMO_WRITES; index += 1) {
      setValue(index);
      flushSync();
    }
    dispose();
    if (sink < 0) {
      throw new Error("unreachable");
    }
  },
};

const deepStore: BenchTask = {
  name: "deep reactive: 10k path writes",
  fn: () => {
    const state = deepReactive({ counter: { value: 0 } });
    let sink = 0;
    const dispose = createRoot((disposeRoot) => {
      createRenderEffect(() => {
        sink += state.counter.value;
      });
      return disposeRoot;
    });
    for (let index = 0; index < STORE_WRITES; index += 1) {
      state.counter.value = index;
      flushSync();
    }
    dispose();
    if (sink < 0) {
      throw new Error("unreachable");
    }
  },
};

const textUpdates: BenchTask = {
  name: "effect → textContent: 10k updates",
  fn: () => {
    const node = documentRef.createTextNode("");
    const [value, setValue] = createSignal("");
    const dispose = createRoot((disposeRoot) => {
      text(node, value);
      return disposeRoot;
    });
    for (let index = 0; index < TEXT_WRITES; index += 1) {
      setValue(String(index));
      flushSync();
    }
    dispose();
    if (node.data !== String(TEXT_WRITES - 1)) {
      throw new Error("unreachable");
    }
  },
};

const createList: BenchTask = {
  name: "keyed list: create 1000 rows",
  fn: () => {
    const host = createHost();
    const [items] = createSignal<readonly Row[]>(createRows(LIST_SIZE));
    const dispose = createRoot((disposeRoot) => {
      host.appendChild(For({ each: items, children: renderRow }));
      return disposeRoot;
    });
    flushSync();
    dispose();
  },
};

const appendList = setupKeyedList(createRows(LIST_SIZE));
const appendRows = createRows(APPEND_SIZE);
const appendTask: BenchTask = {
  name: "keyed list: append 100 rows",
  fn: () => {
    appendList.setItems((previous) => [...previous, ...appendRows]);
    flushSync();
    appendList.setItems((previous) => previous.slice(0, LIST_SIZE));
    flushSync();
  },
};

const reorderBase = createRows(LIST_SIZE);
const reorderList = setupKeyedList(reorderBase);
let reorderOffset = 0;
const reorderTask: BenchTask = {
  name: "keyed list: reorder 1000 rows",
  fn: () => {
    reorderOffset = (reorderOffset + 1) % LIST_SIZE;
    const rotated = [
      ...reorderBase.slice(reorderOffset),
      ...reorderBase.slice(0, reorderOffset),
    ];
    reorderList.setItems(rotated);
    flushSync();
    reorderList.setItems(reorderBase);
    flushSync();
  },
};

export const silentSuite: BenchSuite = {
  name: "silent",
  tasks: [
    signalWrites,
    batchedWrites,
    memoChain,
    deepStore,
    textUpdates,
    createList,
    appendTask,
    reorderTask,
  ],
};
