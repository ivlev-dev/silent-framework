// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createRoot,
  createSignal,
  flushSync,
} from "@ivlev-dev/silent-reactivity";
import { For } from "../src/control-flow.js";
import {
  insert,
  setServerMode,
  templateHoles,
  type TemplateClone,
  type TemplatePlan,
} from "../src/dom.js";
import { createComponent, whenIdle } from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import type { AnyComponent } from "../src/types.js";

const MIDDLE_HTML = "<section>a</section><!--silent-hole-0--><span>b</span>";
const MIDDLE_PLAN: TemplatePlan = {
  roots: 3,
  holes: [{ path: [1], counts: [3], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

const END_HTML = "<section>a</section><span>b</span><!--silent-hole-0-->";
const END_PLAN: TemplatePlan = {
  roots: 3,
  holes: [{ path: [2], counts: [3], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

const OUTER_HTML = '<div class="outer"><!--silent-hole-0--><i>tail</i></div>';
const OUTER_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

const LIST_HTML = "<ul><!--silent-hole-0--></ul>";
const LIST_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

const HOLE_ONLY_HTML = "<!--silent-hole-0-->";
const HOLE_ONLY_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0], counts: [1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

function holeOf(clone: TemplateClone): Comment {
  const hole = clone.holes[0];
  if (hole === undefined || !(hole instanceof Comment)) {
    throw new Error("не найдена дыра шаблона");
  }
  return hole;
}

function parentOf(clone: TemplateClone, hole: Comment): Node {
  return hole.parentNode ?? clone.node;
}

function multiRoot(html: string, plan: TemplatePlan, value: unknown): Node {
  const clone = templateHoles(html, plan)();
  const hole = holeOf(clone);
  insert(parentOf(clone, hole), () => value, hole);
  return clone.node;
}

async function renderServer(
  app: AnyComponent,
  props: Record<string, unknown>,
): Promise<string> {
  setServerMode(true);
  try {
    let result: ReturnType<typeof createComponent> | null = null;
    createRoot(() => {
      result = createComponent(app, props);
      return null;
    });
    const created = result as ReturnType<typeof createComponent> | null;
    if (created === null) {
      throw new Error("компонент не создан");
    }
    await created.ready;
    await whenIdle();
    flushSync();
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

function expectSameNodes(actual: NodeListOf<ChildNode> | readonly Node[], expected: readonly Node[]): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBe(expected[index]);
  }
}

const hosts: HTMLElement[] = [];
const handles: { dispose(): void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const host of hosts.splice(0)) {
    host.remove();
  }
  document.body.replaceChildren();
});

function host(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

describe("гидрация multi-root шаблона с корневой дырой", () => {
  it("сохраняет порядок и identity при дыре в середине", async () => {
    function View(props: Record<string, unknown>): Node {
      return multiRoot(MIDDLE_HTML, MIDDLE_PLAN, props["value"]);
    }
    const html = await renderServer(View as unknown as AnyComponent, { value: "x" });
    const target = host(html);
    const serverNodes = Array.from(target.childNodes);
    const mismatches: string[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      props: { value: "x" },
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expectSameNodes(target.childNodes, serverNodes);
    expect(target.textContent).toBe("axb");
    expect(target.firstChild?.nodeName).toBe("SECTION");
    expect(target.lastChild?.nodeName).toBe("SPAN");
  });

  it("сохраняет порядок и identity при дыре в конце", async () => {
    function View(props: Record<string, unknown>): Node {
      return multiRoot(END_HTML, END_PLAN, props["value"]);
    }
    const html = await renderServer(View as unknown as AnyComponent, { value: "x" });
    const target = host(html);
    const serverNodes = Array.from(target.childNodes);
    const mismatches: string[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      props: { value: "x" },
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expectSameNodes(target.childNodes, serverNodes);
    expect(target.textContent).toBe("abx");
    const last = target.lastChild;
    expect(last?.nodeType).toBe(Node.COMMENT_NODE);
    expect(last?.previousSibling?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("гидратирует вложенный компонент с multi-root фрагментом", async () => {
    function Inner(props: Record<string, unknown>): Node {
      return multiRoot(MIDDLE_HTML, MIDDLE_PLAN, props["value"]);
    }
    function View(props: Record<string, unknown>): Node {
      const clone = templateHoles(OUTER_HTML, OUTER_PLAN)();
      const hole = holeOf(clone);
      insert(parentOf(clone, hole), () => Inner(props), hole);
      return clone.node;
    }
    const html = await renderServer(View as unknown as AnyComponent, { value: "x" });
    const target = host(html);
    const outer = target.firstElementChild;
    const serverNodes = Array.from(outer?.childNodes ?? []);
    const mismatches: string[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      props: { value: "x" },
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expectSameNodes(outer?.childNodes ?? [], serverNodes);
    expect(outer?.textContent).toBe("axbtail");
    expect(outer?.lastChild?.nodeName).toBe("I");
  });

  it("рендерит For со строками multi-root и сохраняет порядок", async () => {
    const rows = createSignal<readonly string[]>(["x", "y"]);
    function Row(item: string): Node {
      const clone = templateHoles(MIDDLE_HTML, MIDDLE_PLAN)();
      const hole = holeOf(clone);
      insert(parentOf(clone, hole), () => item, hole);
      return clone.node;
    }
    function View(): Node {
      const clone = templateHoles(LIST_HTML, LIST_PLAN)();
      const hole = holeOf(clone);
      insert(
        parentOf(clone, hole),
        () => For({ each: rows[0], children: (item: string) => Row(item) }),
        hole,
      );
      return clone.node;
    }
    const html = await renderServer(View as unknown as AnyComponent, {});
    const target = host(html);
    const list = target.firstElementChild;
    const serverNodes = Array.from(list?.childNodes ?? []);
    const mismatches: string[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expectSameNodes(list?.childNodes ?? [], serverNodes);
    expect(target.textContent).toBe("axbayb");
    expect(Array.from(target.querySelectorAll("section")).map((node) => node.textContent)).toEqual([
      "a",
      "a",
    ]);
    expect(Array.from(target.querySelectorAll("span")).map((node) => node.textContent)).toEqual([
      "b",
      "b",
    ]);

    rows[1](["x", "y", "z"]);
    flushSync();
    expect(target.textContent).toBe("axbaybazb");
  });
});

describe("гидрация шаблона, корень которого — дыра", () => {
  it("забирает insert-регион и маркер для не-текстового ребёнка", async () => {
    function Child(): Node {
      return templateHoles("<i>child</i>", {
        roots: 1,
        holes: [],
        attrs: [],
        strips: [],
      })().node;
    }
    function View(): Node {
      const clone = templateHoles(HOLE_ONLY_HTML, HOLE_ONLY_PLAN)();
      const hole = holeOf(clone);
      insert(parentOf(clone, hole), () => Child(), hole);
      return clone.node;
    }
    const html = await renderServer(View as unknown as AnyComponent, {});
    const target = host(html);
    const serverNodes = Array.from(target.childNodes);
    const mismatches: string[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expectSameNodes(target.childNodes, serverNodes);
    expect(target.querySelector("i")).toBe(serverNodes[1]);
    expect(target.textContent).toBe("child");
  });

  it("гидратирует условный не-текстовый ребёнок", async () => {
    function View(props: Record<string, unknown>): Node {
      const clone = templateHoles(HOLE_ONLY_HTML, HOLE_ONLY_PLAN)();
      const hole = holeOf(clone);
      insert(parentOf(clone, hole), () => {
        if (props["show"] !== true) {
          return false;
        }
        return templateHoles("<i>on</i>", {
          roots: 1,
          holes: [],
          attrs: [],
          strips: [],
        })().node;
      }, hole);
      return clone.node;
    }
    for (const show of [true, false]) {
      const html = await renderServer(View as unknown as AnyComponent, { show });
      const target = host(html);
      const serverNodes = Array.from(target.childNodes);
      const mismatches: string[] = [];
      const handle = await hydrate(target, View as unknown as AnyComponent, {
        props: { show },
        onMismatch: (error) => mismatches.push(error.message),
      });
      handles.push(handle);

      expect(mismatches).toEqual([]);
      expectSameNodes(target.childNodes, serverNodes);
      expect(target.textContent).toBe(show ? "on" : "");
      target.remove();
    }
  });
});
