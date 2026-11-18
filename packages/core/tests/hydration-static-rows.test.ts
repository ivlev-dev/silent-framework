// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createRoot,
  createSignal,
  deepReactive,
  flushSync,
  getReactivityStats,
} from "@ivlev-dev/silent-reactivity";
import {
  attr,
  insert,
  on,
  setServerMode,
  templateHoles,
  type TemplateClone,
  type TemplatePlan,
} from "../src/dom.js";
import { For } from "../src/control-flow.js";
import { component } from "../src/component-lite.js";
import { createComponent, whenIdle, type ComponentResult } from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import { HydrationMismatchError } from "../src/hydration.js";
import type { AnyComponent } from "../src/types.js";

interface Row {
  readonly label: string;
  readonly id: string;
}

const ROW_HTML = '<li class="row" data-silent-a-0=""><!--silent-hole-0--></li>';

const ROW_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1] }],
  attrs: [{ path: [0], counts: [1] }],
  strips: [{ path: [0], counts: [1], names: ["data-silent-a-0"] }],
};

const rows = createSignal<readonly Row[]>([]);
const revision = createSignal(0);
const hosts: HTMLElement[] = [];
let clicks = 0;

afterEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
  rows[1]([]);
  revision[1](0);
  clicks = 0;
  flushSync();
});

function host(markup: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function holeParent(template: TemplateClone, index: number): Node {
  const hole = template.holes[index];
  if (hole === undefined) {
    throw new Error("шаблон строки не собран");
  }
  return (hole.parentNode as Node | null) ?? template.node;
}

function rowNode(row: Row, withHandler: boolean, reactive: boolean): Node {
  const template = templateHoles(ROW_HTML, ROW_PLAN)();
  const element = template.attrs[0];
  const hole = template.holes[0];
  if (element === undefined || hole === undefined) {
    throw new Error("шаблон строки не собран");
  }
  attr(element, "data-id", () => row.id);
  insert(
    holeParent(template, 0),
    reactive ? () => `${row.label}${String(revision[0]())}` : () => row.label,
    hole,
  );
  if (withHandler) {
    on(element, "onClick", () => () => {
      clicks += 1;
    });
  }
  return template.node;
}

function makeApp(
  staticRows: boolean,
  withHandler = false,
  reactive = false,
): AnyComponent {
  return function App(): Node {
    return component(For as never, {
      get each() {
        return rows[0]();
      },
      keyOf: (row: Row) => row.id,
      staticRows,
      get children() {
        return (row: Row): Node => rowNode(row, withHandler, reactive);
      },
    } as never);
  } as unknown as AnyComponent;
}

async function serverMarkup(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    let result: ComponentResult | null = null;
    createRoot(() => {
      result = createComponent(app, {});
      return null;
    });
    if (result === null) {
      throw new Error("компонент не создан");
    }
    const created: ComponentResult = result;
    await created.ready;
    await whenIdle();
    flushSync();
    const container = document.createElement("div");
    container.appendChild(created.node);
    const html = container.innerHTML;
    created.dispose();
    return html;
  } finally {
    setServerMode(false);
  }
}

async function hydrateApp(
  app: AnyComponent,
  mismatches: HydrationMismatchError[] = [],
): Promise<{ root: HTMLElement; created: number; dispose: () => void }> {
  const root = host(await serverMarkup(app));
  const before = getReactivityStats().renderEffectsCreated;
  const handle = await hydrate(root, app, {
    onMismatch: (error) => mismatches.push(error),
  });
  return {
    root,
    created: getReactivityStats().renderEffectsCreated - before,
    dispose: () => handle.dispose(),
  };
}

function items(labels: readonly string[]): Row[] {
  return labels.map((label) => ({ label, id: label }));
}

describe("статическая гидратация строк For", () => {
  it("адоптирует серверные строки без эффектов на строку", async () => {
    const labels = ["0", "1", "2", "3", "4"];
    rows[1](items(labels));
    const app = makeApp(true);
    const mismatches: HydrationMismatchError[] = [];
    const { root, created, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("01234");
    expect(
      Array.from(root.querySelectorAll("li")).map((row) => row.getAttribute("data-id")),
    ).toEqual(labels);
    expect(created).toBeLessThanOrEqual(1);
    dispose();
  });

  it("не создаёт эффекты строк, которые читают сигналы", async () => {
    rows[1](items(["0", "1", "2", "3"]));
    const plain = await hydrateApp(makeApp(false, false, true));
    const statics = await hydrateApp(makeApp(true, false, true));

    expect(plain.created).toBeGreaterThanOrEqual(4);
    expect(statics.created).toBeLessThanOrEqual(1);
    plain.dispose();
    statics.dispose();
  });

  it("сообщает о несовпадении текста строки", async () => {
    rows[1](items(["a", "b"]));
    const app = makeApp(true);
    const root = host(await serverMarkup(app));
    rows[1]([
      { label: "a", id: "a" },
      { label: "changed", id: "b" },
    ]);

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    expect(root.textContent).toBe("achanged");
    handle.dispose();
  });

  it("сравнивает атрибут строки без эффекта и сообщает о расхождении", async () => {
    rows[1]([
      { label: "a", id: "first" },
      { label: "b", id: "second" },
    ]);
    const app = makeApp(true);
    const root = host(await serverMarkup(app));
    rows[1]([
      { label: "a", id: "first" },
      { label: "b", id: "other" },
    ]);

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    expect(
      Array.from(root.querySelectorAll("li")).map((row) => row.getAttribute("data-id")),
    ).toEqual(["first", "other"]);
    handle.dispose();
  });

  it("не включает статический режим для реактивного item", async () => {
    rows[1](items(["a", "b", "c"]));
    const app = makeApp(true);
    const root = host(await serverMarkup(app));
    rows[1](items(["a", "b", "c"]).map((row) => deepReactive(row)));

    const mismatches: HydrationMismatchError[] = [];
    const before = getReactivityStats().renderEffectsCreated;
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    const created = getReactivityStats().renderEffectsCreated - before;

    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("abc");
    expect(created).toBeGreaterThanOrEqual(3);
    handle.dispose();
  });

  it("не включает статический режим для экземпляра класса", async () => {
    const [label, setLabel] = createSignal("a");
    class RowItem {
      readonly id = "row";
      get label(): string {
        return label();
      }
    }
    rows[1]([new RowItem()]);
    const app = makeApp(true);
    const mismatches: HydrationMismatchError[] = [];
    const { root, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("a");
    setLabel("b");
    flushSync();
    expect(root.textContent).toBe("b");
    dispose();
  });

  it("навешивает обработчик события на статическую строку", async () => {
    rows[1](items(["a", "b"]));
    const mismatches: HydrationMismatchError[] = [];
    const { root, dispose } = await hydrateApp(makeApp(true, true), mismatches);

    expect(mismatches).toEqual([]);
    root.querySelectorAll("li")[0]?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(clicks).toBe(1);
    dispose();
  });

  it("сравнивает текст региона вставки без создания региона", async () => {
    function regionRow(row: Row): Node {
      const template = templateHoles(
        '<li class="row">label: <!--silent-hole-0--></li>',
        {
          roots: 1,
          holes: [{ path: [0, 1], counts: [1, 2] }],
          attrs: [],
          strips: [],
        },
      )();
      const hole = template.holes[0];
      if (hole === undefined) {
        throw new Error("шаблон строки не собран");
      }
      insert(holeParent(template, 0), () => row.label, hole);
      return template.node;
    }
    function App(): Node {
      return component(For as never, {
        get each() {
          return rows[0]();
        },
        keyOf: (row: Row) => row.id,
        staticRows: true,
        get children() {
          return (row: Row): Node => regionRow(row);
        },
      } as never);
    }
    const app = App as unknown as AnyComponent;
    rows[1](items(["a", "b"]));
    const mismatches: HydrationMismatchError[] = [];
    const { root, created, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("label: alabel: b");
    expect(created).toBeLessThanOrEqual(1);
    dispose();
  });

  it("сообщает о несовпадении текста региона вставки", async () => {
    function regionRow(row: Row): Node {
      const template = templateHoles(
        '<li class="row">label: <!--silent-hole-0--></li>',
        {
          roots: 1,
          holes: [{ path: [0, 1], counts: [1, 2] }],
          attrs: [],
          strips: [],
        },
      )();
      const hole = template.holes[0];
      if (hole === undefined) {
        throw new Error("шаблон строки не собран");
      }
      insert(holeParent(template, 0), () => row.label, hole);
      return template.node;
    }
    function App(): Node {
      return component(For as never, {
        get each() {
          return rows[0]();
        },
        keyOf: (row: Row) => row.id,
        staticRows: true,
        get children() {
          return (row: Row): Node => regionRow(row);
        },
      } as never);
    }
    const app = App as unknown as AnyComponent;
    rows[1](items(["a", "b"]));
    const root = host(await serverMarkup(app));
    rows[1]([
      { label: "a", id: "a" },
      { label: "changed", id: "b" },
    ]);
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    expect(root.textContent).toBe("label: alabel: changed");
    handle.dispose();
  });

  it("пере-рендеривает статические строки после изменения each", async () => {
    rows[1](items(["a", "b", "c"]));
    const app = makeApp(true);
    const mismatches: HydrationMismatchError[] = [];
    const root = host(await serverMarkup(app));
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    expect(mismatches).toEqual([]);
    const serverRows = Array.from(root.querySelectorAll("li"));

    rows[1](items(["c", "a", "b"]));
    flushSync();
    expect(root.textContent).toBe("cab");
    expect(Array.from(root.querySelectorAll("li"))).toEqual([
      serverRows[2],
      serverRows[0],
      serverRows[1],
    ]);

    rows[1](items(["c", "a", "b", "d"]));
    flushSync();
    expect(root.textContent).toBe("cabd");
    expect(root.querySelectorAll("li").length).toBe(4);

    rows[1](items(["c", "a2", "b", "d"]));
    flushSync();
    expect(root.textContent).toBe("ca2bd");
    expect(root.querySelectorAll("li").length).toBe(4);

    rows[1](items(["c", "b"]));
    flushSync();
    expect(root.textContent).toBe("cb");
    expect(root.querySelectorAll("li").length).toBe(2);
    handle.dispose();
  });

  it("без staticRows гидратирует и обновляет строки как раньше", async () => {
    rows[1](items(["a", "b"]));
    const app = makeApp(false, false, true);
    const mismatches: HydrationMismatchError[] = [];
    const root = host(await serverMarkup(app));
    const serverRows = Array.from(root.querySelectorAll("li"));
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    expect(Array.from(root.querySelectorAll("li"))).toEqual(serverRows);
    expect(root.textContent).toBe("a0b0");

    revision[1](1);
    flushSync();
    expect(root.textContent).toBe("a1b1");

    rows[1](items(["b"]));
    flushSync();
    expect(root.textContent).toBe("b1");
    handle.dispose();
  });
});
