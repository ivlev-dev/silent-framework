// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createRoot,
  createSignal,
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
import { isStaticHydration } from "../src/dom-hydration-state.js";
import { HydrationMismatchError } from "../src/hydration.js";
import type { AnyComponent } from "../src/types.js";

interface Cell {
  readonly id: string;
  readonly value?: unknown;
  readonly extra?: unknown;
}

const data = createSignal<readonly Cell[]>([]);
const hosts: HTMLElement[] = [];
const clicked: string[] = [];

afterEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
  data[1]([]);
  clicked.length = 0;
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

function appFor(
  build: (cell: Cell) => Node,
  staticRows = true,
  keyOf: (cell: Cell) => unknown = (cell) => cell.id,
): AnyComponent {
  return function App(): Node {
    return component(For as never, {
      get each() {
        return data[0]();
      },
      keyOf,
      staticRows,
      get children() {
        return (cell: Cell): Node => build(cell);
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

function cells(values: readonly unknown[]): Cell[] {
  return values.map((value, index) => ({ id: String(index), value }));
}

const BARE_HTML = "<li><!--silent-hole-0--></li>";
const BARE_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1] }],
  attrs: [],
  strips: [],
};

const REGION_HTML = "<li>prefix <!--silent-hole-0--></li>";
const REGION_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 1], counts: [1, 2] }],
  attrs: [],
  strips: [],
};

const TWO_HOLE_HTML = "<li><!--silent-hole-0--><!--silent-hole-1--></li>";
const TWO_HOLE_PLAN: TemplatePlan = {
  roots: 1,
  holes: [
    { path: [0, 0], counts: [1, 1] },
    { path: [0, 1], counts: [1, 2] },
  ],
  attrs: [],
  strips: [],
};

function bareRow(template: TemplateClone, cell: Cell): Node {
  const hole = template.holes[0];
  if (hole === undefined) {
    throw new Error("шаблон строки не собран");
  }
  insert(holeParent(template, 0), () => cell.value, hole);
  return template.node;
}

const STYLE_HTML =
  '<li data-silent-a-0="" data-silent-a-1=""><!--silent-hole-0--></li>';
const STYLE_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1] }],
  attrs: [
    { path: [0], counts: [1] },
    { path: [0], counts: [1] },
  ],
  strips: [
    { path: [0], counts: [1], names: ["data-silent-a-0", "data-silent-a-1"] },
  ],
};

const FORM_HTML =
  '<li data-silent-a-0=""><input data-silent-a-1="" data-silent-a-2=""><!--silent-hole-0--></li>';
const FORM_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 1], counts: [1, 2] }],
  attrs: [
    { path: [0], counts: [1] },
    { path: [0, 0], counts: [1, 0] },
    { path: [0, 0], counts: [1, 0] },
  ],
  strips: [
    { path: [0], counts: [1], names: ["data-silent-a-0"] },
    { path: [0, 0], counts: [1, 0], names: ["data-silent-a-1", "data-silent-a-2"] },
  ],
};

const SELECT_HTML =
  '<li><select data-silent-a-0=""><option value="x" data-silent-a-1=""></option><option value="y"></option></select><!--silent-hole-0--></li>';
const SELECT_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 1], counts: [1, 2] }],
  attrs: [
    { path: [0, 0], counts: [1, 0] },
    { path: [0, 0, 0], counts: [1, 0, 0] },
  ],
  strips: [
    { path: [0, 0], counts: [1, 0], names: ["data-silent-a-0"] },
    { path: [0, 0, 0], counts: [1, 0, 0], names: ["data-silent-a-1"] },
  ],
};

const CHECKBOX_HTML =
  '<li><input data-silent-a-0="" type="checkbox"><!--silent-hole-0--></li>';
const CHECKBOX_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 1], counts: [1, 2] }],
  attrs: [{ path: [0, 0], counts: [1, 0] }],
  strips: [{ path: [0, 0], counts: [1, 0], names: ["data-silent-a-0"] }],
};

const SVG_HTML =
  '<li><svg><linearGradient data-silent-a-0="" data-silent-a-1=""></linearGradient></svg><!--silent-hole-0--></li>';
const SVG_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 1], counts: [1, 2] }],
  attrs: [
    { path: [0, 0, 0], counts: [1, 0, 0] },
    { path: [0, 0, 0], counts: [1, 0, 0] },
  ],
  strips: [
    {
      path: [0, 0, 0],
      counts: [1, 0, 0],
      names: ["data-silent-a-0", "data-silent-a-1"],
    },
  ],
};

describe("текст статических строк", () => {
  it("принимает пустые, ложные и нулевые значения", async () => {
    data[1](cells(["", null, undefined, false, true, 0]));
    const mismatches: HydrationMismatchError[] = [];
    const app = appFor((cell) => bareRow(templateHoles(BARE_HTML, BARE_PLAN)(), cell));
    const { root, created, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("0");
    expect(created).toBeLessThanOrEqual(1);
    dispose();
  });

  it("принимает несколько текстовых дыр подряд", async () => {
    data[1](cells(["", null, 0]));
    const app = appFor((cell) => {
      const template = templateHoles(TWO_HOLE_HTML, TWO_HOLE_PLAN)();
      const first = template.holes[0];
      const second = template.holes[1];
      if (first === undefined || second === undefined) {
        throw new Error("шаблон строки не собран");
      }
      insert(holeParent(template, 0), () => cell.value, first);
      insert(holeParent(template, 1), () => cell.id, second);
      return template.node;
    });
    const mismatches: HydrationMismatchError[] = [];
    const { root, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("0102");
    dispose();
  });

  it("принимает whitespace-only текст и регион", async () => {
    data[1](cells([" ", "  "]));
    const bare = await hydrateApp(
      appFor((cell) => bareRow(templateHoles(BARE_HTML, BARE_PLAN)(), cell)),
    );
    expect(bare.root.textContent).toBe("   ");
    bare.dispose();

    data[1](cells([" "]));
    const regionMismatches: HydrationMismatchError[] = [];
    const region = await hydrateApp(
      appFor((cell) => bareRow(templateHoles(REGION_HTML, REGION_PLAN)(), cell)),
      regionMismatches,
    );
    expect(regionMismatches).toEqual([]);
    expect(region.root.textContent).toBe("prefix  ");
    region.dispose();
  });

  it("принимает регион вставки, разбитый на несколько текстовых узлов", async () => {
    data[1](cells(["ab"]));
    const app = appFor((cell) => bareRow(templateHoles(REGION_HTML, REGION_PLAN)(), cell));
    const root = host(await serverMarkup(app));
    const listItem = root.querySelector("li");
    if (listItem === null) {
      throw new Error("строка не найдена");
    }
    const end = Array.from(listItem.childNodes).find(
      (node) => node.nodeType === Node.COMMENT_NODE && (node as Comment).data === "silent-insert-end",
    );
    const text = end?.previousSibling;
    if (text === null || text === undefined || text.nodeType !== Node.TEXT_NODE) {
      throw new Error("регион вставки не найден");
    }
    (text as Text).data = "a";
    text.parentNode?.insertBefore(document.createTextNode("b"), end ?? null);

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("prefix ab");
    handle.dispose();
  });

  it("сообщает о пропавшем текстовом узле, не мутируя разметку до броска", async () => {
    data[1](cells(["a", "b"]));
    const app = appFor((cell) => bareRow(templateHoles(BARE_HTML, BARE_PLAN)(), cell));
    const root = host(await serverMarkup(app));
    const second = root.querySelectorAll("li")[1];
    second?.firstChild?.remove();

    const observer = new MutationObserver(() => {});
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    const records = observer.takeRecords();
    observer.disconnect();

    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    expect(root.textContent).toBe("ab");
    const edits = records.filter(
      (record) =>
        record.type === "characterData"
        || (record.type === "attributes"
          && !(record.attributeName ?? "").startsWith("data-silent-")),
    );
    expect(edits).toEqual([]);
    handle.dispose();
  });

  it("не статизирует смешанный регион вставки, но обновляет его", async () => {
    data[1](cells([["a", "b"], ["c", "d"]]));
    const app = appFor((cell) => {
      const template = templateHoles(BARE_HTML, BARE_PLAN)();
      const hole = template.holes[0];
      if (hole === undefined) {
        throw new Error("шаблон строки не собран");
      }
      insert(holeParent(template, 0), () => {
        const value = cell.value as readonly [string, string];
        const text = document.createTextNode(value[0]);
        const bold = document.createElement("b");
        bold.textContent = value[1];
        return [text, bold];
      }, hole);
      return template.node;
    });
    const mismatches: HydrationMismatchError[] = [];
    const { root, created, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("abcd");
    expect(created).toBeGreaterThanOrEqual(2);
    expect(root.querySelectorAll("b").length).toBe(2);
    dispose();
  });
});

describe("атрибуты статических строк", () => {
  it("сравнивает class по токенам: порядок и дубли допустимы", async () => {
    data[1](cells([{ a: true, b: true }]));
    const app = appFor((cell) => {
      const template = templateHoles(STYLE_HTML, STYLE_PLAN)();
      const element = template.attrs[0];
      if (element === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(element, "class", () => cell.value);
      attr(element, "style", () => ({ color: "red" }));
      return bareRow(template, cell);
    });
    const root = host(await serverMarkup(app));
    root.querySelector("li")?.setAttribute("class", "b  a b");
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches).toEqual([]);
    handle.dispose();
  });

  it("сообщает о лишнем class-токене", async () => {
    data[1](cells([{ a: true }]));
    const app = appFor((cell) => {
      const template = templateHoles(STYLE_HTML, STYLE_PLAN)();
      const element = template.attrs[0];
      if (element === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(element, "class", () => cell.value);
      attr(element, "style", () => ({ color: "red" }));
      return bareRow(template, cell);
    });
    const root = host(await serverMarkup(app));
    root.querySelector("li")?.setAttribute("class", "a extra");
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    handle.dispose();
  });

  it("сравнивает style с единицами и сокращениями", async () => {
    data[1](cells([{ width: 10, opacity: 0.5, margin: "1px 2px" }]));
    const app = appFor((cell) => {
      const template = templateHoles(STYLE_HTML, STYLE_PLAN)();
      const element = template.attrs[0];
      if (element === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(element, "class", () => "row");
      attr(element, "style", () => cell.value);
      return bareRow(template, cell);
    });
    const mismatches: HydrationMismatchError[] = [];
    const { root, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(root.querySelector("li")?.getAttribute("style")).toContain("width: 10px");
    dispose();
  });

  it("сообщает о лишних inline-стилях", async () => {
    data[1](cells([{ color: "red" }]));
    const app = appFor((cell) => {
      const template = templateHoles(STYLE_HTML, STYLE_PLAN)();
      const element = template.attrs[0];
      if (element === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(element, "class", () => "row");
      attr(element, "style", () => cell.value);
      return bareRow(template, cell);
    });
    const root = host(await serverMarkup(app));
    root.querySelector("li")?.setAttribute("style", "color: red; background: blue;");
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });

    expect(mismatches.length).toBeGreaterThan(0);
    expect(root.querySelector("li")?.getAttribute("style")).toBe("color: red;");
    handle.dispose();
  });

  it("применяет value и indeterminate, которые не попадают в разметку", async () => {
    data[1](cells([{ value: "abc", checked: true, indeterminate: true }, { value: "", indeterminate: false }]));
    const app = appFor((cell) => {
      const template = templateHoles(FORM_HTML, FORM_PLAN)();
      const input = template.attrs[1];
      if (input === undefined) {
        throw new Error("шаблон строки не собран");
      }
      const value = cell.value as { value: string; checked: boolean; indeterminate: boolean };
      attr(input, "value", () => value.value);
      attr(input, "checked", () => value.checked);
      return bareRow(template, cell);
    });
    const formMismatches: HydrationMismatchError[] = [];
    const form = await hydrateApp(app, formMismatches);
    expect(formMismatches).toEqual([]);
    const inputs = Array.from(form.root.querySelectorAll("input"));
    expect(inputs.map((input) => input.value)).toEqual(["abc", ""]);
    expect(inputs.map((input) => input.checked)).toEqual([true, false]);
    form.dispose();

    data[1](cells([{ indeterminate: true }, { indeterminate: false }]));
    const checkApp = appFor((cell) => {
      const template = templateHoles(CHECKBOX_HTML, CHECKBOX_PLAN)();
      const input = template.attrs[0];
      if (input === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(input, "indeterminate", () => (cell.value as { indeterminate: boolean }).indeterminate);
      return bareRow(template, cell);
    });
    const checkMismatches: HydrationMismatchError[] = [];
    const checks = await hydrateApp(checkApp, checkMismatches);
    expect(checkMismatches).toEqual([]);
    expect(
      Array.from(checks.root.querySelectorAll("input")).map((input) => input.indeterminate),
    ).toEqual([true, false]);
    checks.dispose();
  });

  it("применяет значение select и selected опции", async () => {
    data[1](cells(["x", "y"]));
    const app = appFor((cell) => {
      const template = templateHoles(SELECT_HTML, SELECT_PLAN)();
      const select = template.attrs[0];
      const option = template.attrs[1];
      if (select === undefined || option === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(select, "value", () => cell.value);
      attr(option, "selected", () => cell.value === "x");
      return bareRow(template, cell);
    });
    const mismatches: HydrationMismatchError[] = [];
    const { root, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(Array.from(root.querySelectorAll("select")).map((select) => select.value)).toEqual([
      "x",
      "y",
    ]);
    dispose();
  });

  it("сравнивает boolean-атрибуты по наличию в разметке", async () => {
    data[1](cells([true, false]));
    const app = appFor((cell) => {
      const template = templateHoles(FORM_HTML, FORM_PLAN)();
      const listItem = template.attrs[0];
      const input = template.attrs[1];
      if (listItem === undefined || input === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(listItem, "disabled", () => cell.value);
      attr(input, "value", () => "");
      attr(input, "checked", () => false);
      return bareRow(template, cell);
    });
    const mismatches: HydrationMismatchError[] = [];
    const { root, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(
      Array.from(root.querySelectorAll("li")).map((element) => element.hasAttribute("disabled")),
    ).toEqual([true, false]);
    dispose();
  });

  it("сохраняет регистр SVG-атрибутов и xlink", async () => {
    data[1](cells([{ units: "userSpaceOnUse", transform: "rotate(1)" }]));
    const app = appFor((cell) => {
      const template = templateHoles(SVG_HTML, SVG_PLAN)();
      const gradient = template.attrs[0];
      if (gradient === undefined) {
        throw new Error("шаблон строки не собран");
      }
      const value = cell.value as { units: string; transform: string };
      attr(gradient, "gradientUnits", () => value.units);
      attr(gradient, "gradientTransform", () => value.transform);
      return bareRow(template, cell);
    });
    const mismatches: HydrationMismatchError[] = [];
    const { root, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    const gradient = root.querySelector("linearGradient");
    expect(gradient?.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
    expect(gradient?.getAttribute("gradientTransform")).toBe("rotate(1)");
    expect(gradient?.hasAttribute("gradient-units")).toBe(false);
    dispose();
  });

  it("передаёт xlink:href и числовые data-* при клиентском рендере", () => {
    const hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    hosts.push(hostElement);
    data[1](cells([{ href: "#icon", count: 0 }]));
    const container = component(For as never, {
      get each() {
        return data[0]();
      },
      keyOf: (cell: Cell) => cell.id,
      staticRows: true,
      get children() {
        return (cell: Cell): Node => {
          const template = templateHoles(
            '<li><svg><use data-silent-a-0=""></use></svg></li>',
            {
              roots: 1,
              holes: [],
              attrs: [{ path: [0, 0, 0], counts: [1, 0, 0] }],
              strips: [
                { path: [0, 0, 0], counts: [1, 0, 0], names: ["data-silent-a-0"] },
              ],
            },
          )();
          const use = template.attrs[0];
          if (use === undefined) {
            throw new Error("шаблон строки не собран");
          }
          const value = cell.value as { href: string; count: number };
          attr(use, "xlink:href", () => value.href);
          attr(template.node as Element, "data-count", () => value.count);
          return template.node;
        };
      },
    } as never);
    hostElement.appendChild(container);
    flushSync();

    const use = hostElement.querySelector("use");
    expect(use?.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#icon");
    const listItem = hostElement.querySelector("li");
    expect(listItem?.getAttribute("data-count")).toBe("0");
    expect(isStaticHydration()).toBe(false);
  });
});

describe("состояние статического режима", () => {
  it("восстанавливает статический режим после mismatch и следующей гидрации", async () => {
    const app = appFor((cell) => bareRow(templateHoles(BARE_HTML, BARE_PLAN)(), cell));
    data[1](cells(["a", "b"]));
    const bad = host(await serverMarkup(app));
    bad.querySelectorAll("li")[1]?.firstChild?.remove();
    const badErrors: HydrationMismatchError[] = [];
    const badHandle = await hydrate(bad, app, {
      onMismatch: (error) => badErrors.push(error),
    });
    expect(badErrors.length).toBeGreaterThan(0);
    expect(isStaticHydration()).toBe(false);
    expect(bad.textContent).toBe("ab");

    data[1](cells(["c", "d"]));
    const goodErrors: HydrationMismatchError[] = [];
    const good = await hydrateApp(app, goodErrors);
    expect(goodErrors).toEqual([]);
    expect(good.created).toBeLessThanOrEqual(1);
    expect(good.root.textContent).toBe("cd");
    expect(isStaticHydration()).toBe(false);
    badHandle.dispose();
    good.dispose();
  });

  it("не залипает между последовательными и повторными гидрациями", async () => {
    const app = appFor((cell) => bareRow(templateHoles(BARE_HTML, BARE_PLAN)(), cell));
    data[1](cells(["a", "b"]));
    const first = await hydrateApp(app);
    const second = await hydrateApp(app);

    expect(first.created).toBeLessThanOrEqual(1);
    expect(second.created).toBeLessThanOrEqual(1);
    expect(isStaticHydration()).toBe(false);
    first.dispose();

    const markup = await serverMarkup(app);
    const again = host(markup);
    const mismatches: HydrationMismatchError[] = [];
    const before = getReactivityStats().renderEffectsCreated;
    const handle = await hydrate(again, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    const created = getReactivityStats().renderEffectsCreated - before;
    expect(mismatches).toEqual([]);
    expect(created).toBeLessThanOrEqual(1);
    expect(again.textContent).toBe("ab");
    handle.dispose();
    second.dispose();
    expect(isStaticHydration()).toBe(false);
  });
});

describe("обновления после статической гидрации", () => {
  it("обновляет текст и атрибуты элемента с тем же ключом", async () => {
    const [list, setList] = createSignal<readonly Cell[]>([
      { id: "a", value: "one", extra: "first" },
      { id: "b", value: "two", extra: "second" },
    ]);
    const app = ((): AnyComponent =>
      function App(): Node {
        return component(For as never, {
          get each() {
            return list();
          },
          keyOf: (cell: Cell) => cell.id,
          staticRows: true,
          get children() {
            return (cell: Cell): Node => {
              const template = templateHoles(STYLE_HTML, STYLE_PLAN)();
              const element = template.attrs[0];
              if (element === undefined) {
                throw new Error("шаблон строки не собран");
              }
              attr(element, "data-id", () => cell.extra);
              return bareRow(template, cell);
            };
          },
        } as never);
      } as unknown as AnyComponent)();
    const mismatches: HydrationMismatchError[] = [];
    const root = host(await serverMarkup(app));
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    expect(mismatches).toEqual([]);

    setList([{ id: "a", value: "one+", extra: "first+" }, { id: "b", value: "two", extra: "second" }]);
    flushSync();
    expect(root.textContent).toBe("one+two");
    expect(
      Array.from(root.querySelectorAll("li")).map((element) => element.getAttribute("data-id")),
    ).toEqual(["first+", "second"]);

    setList([]);
    flushSync();
    expect(root.textContent).toBe("");

    setList([{ id: "c", value: "three", extra: "third" }]);
    flushSync();
    expect(root.textContent).toBe("three");
    expect(root.querySelectorAll("li")[0]?.getAttribute("data-id")).toBe("third");
    handle.dispose();
  });

  it("сохраняет обработчики после перестановки и вставки", async () => {
    const build = (cell: Cell): Node => {
      const template = templateHoles(STYLE_HTML, STYLE_PLAN)();
      const element = template.attrs[0];
      if (element === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(element, "class", () => "row");
      attr(element, "style", () => ({ color: "red" }));
      on(element, "onClick", () => () => {
        clicked.push(cell.id);
      });
      return bareRow(template, cell);
    };
    data[1](cells(["a", "b", "c"]));
    const app = appFor(build);
    const mismatches: HydrationMismatchError[] = [];
    const root = host(await serverMarkup(app));
    const before = getReactivityStats().renderEffectsCreated;
    const handle = await hydrate(root, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    const created = getReactivityStats().renderEffectsCreated - before;
    expect(mismatches).toEqual([]);
    expect(created).toBeLessThanOrEqual(4);

    const original = cells(["a", "b", "c"]);
    data[1]([original[2]!, original[0]!, original[1]!]);
    flushSync();
    for (const element of Array.from(root.querySelectorAll("li"))) {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(clicked).toEqual(["2", "0", "1"]);

    clicked.length = 0;
    data[1]([
      { id: "0", value: "a+" },
      { id: "2", value: "c" },
      { id: "1", value: "b" },
    ]);
    flushSync();
    root.querySelectorAll("li")[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toEqual(["0"]);
    expect(root.textContent).toBe("a+cb");
    handle.dispose();
  });
});

describe("область действия staticRows", () => {
  it("не включает статический режим вне гидрации", () => {
    const [list, setList] = createSignal<readonly Cell[]>([{ id: "a", value: "one" }]);
    const container = For({
      each: list,
      keyOf: (cell: Cell) => cell.id,
      staticRows: true,
      children: (cell: Cell): Node => {
        const template = templateHoles(BARE_HTML, BARE_PLAN)();
        return bareRow(template, cell);
      },
    } as never);
    const hostElement = document.createElement("div");
    document.body.appendChild(hostElement);
    hosts.push(hostElement);
    hostElement.appendChild(container);
    expect(hostElement.textContent).toBe("one");
    expect(isStaticHydration()).toBe(false);

    setList([{ id: "a", value: "two" }, { id: "b", value: "three" }]);
    flushSync();
    expect(hostElement.textContent).toBe("twothree");
    expect(isStaticHydration()).toBe(false);
  });

  it("не статизирует item-массив с геттерами", async () => {
    const [label, setLabel] = createSignal("array");
    const item = [] as unknown as Cell & unknown[];
    Object.defineProperty(item, "id", { value: "row", enumerable: true });
    Object.defineProperty(item, "value", {
      get: () => label(),
      enumerable: true,
    });
    data[1]([item]);
    const mismatches: HydrationMismatchError[] = [];
    const app = appFor((cell) => bareRow(templateHoles(BARE_HTML, BARE_PLAN)(), cell));
    const { root, dispose } = await hydrateApp(app, mismatches);
    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("array");

    setLabel("changed");
    flushSync();
    expect(root.textContent).toBe("changed");
    dispose();
  });

  it("статизирует замороженный объект и объект без прототипа", async () => {
    const frozen = Object.freeze({ id: "frozen", value: "f" });
    const dict = Object.create(null) as Cell;
    Object.assign(dict, { id: "dict", value: "d" });
    data[1]([frozen, dict]);
    const mismatches: HydrationMismatchError[] = [];
    const app = appFor((cell) => bareRow(templateHoles(BARE_HTML, BARE_PLAN)(), cell));
    const { root, created, dispose } = await hydrateApp(app, mismatches);

    expect(mismatches).toEqual([]);
    expect(root.textContent).toBe("fd");
    expect(created).toBeLessThanOrEqual(1);

    data[1]([frozen, { id: "next", value: "n" }]);
    flushSync();
    expect(root.textContent).toBe("fn");
    dispose();
  });
});
