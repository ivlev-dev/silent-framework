// @vitest-environment jsdom
import {
  createRoot,
  createSignal,
  flushSync,
  type Accessor,
} from "@ivlev-dev/silent-reactivity";
import { afterEach, describe, expect, it } from "vitest";
import { For, Show, type ForProps } from "../src/control-flow.js";
import { Index, type IndexProps } from "../src/index-list.js";
import {
  insert,
  isServerMode,
  setServerMode,
  templateHoles,
  type TemplateClone,
  type TemplatePlan,
} from "../src/dom.js";
import { createComponent, whenIdle } from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import type { AnyComponent } from "../src/types.js";

const LIST_HTML = "<ul><!--silent-hole-0--></ul>";
const LIST_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

const ROW_HTML = "<li><!--silent-hole-0--></li>";
const ROW_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

const SHOW_HTML = "<div><!--silent-hole-0--></div>";
const SHOW_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1], key: "silent-hole-0" }],
  attrs: [],
  strips: [],
};

const EMPTY_PLAN: TemplatePlan = { roots: 1, holes: [], attrs: [], strips: [] };

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

function emptyBlock(tag: "b" | "span"): Node {
  return templateHoles(`<${tag}>empty</${tag}>`, EMPTY_PLAN)().node;
}

async function renderServer(
  app: AnyComponent,
  props: Record<string, unknown> = {},
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

interface ListCase {
  readonly app: AnyComponent;
  readonly items: ReturnType<typeof createSignal<readonly string[]>>;
  readonly reads: () => number;
}

function listCase(
  kind: "For" | "Index",
  direct: boolean,
  initial: readonly string[],
): ListCase {
  const items = createSignal<readonly string[]>(initial);
  let reads = 0;
  const row = (value: string): Node => {
    const clone = templateHoles(ROW_HTML, ROW_PLAN)();
    const hole = holeOf(clone);
    insert(parentOf(clone, hole), () => value, hole);
    return clone.node;
  };
  function App(): Node {
    const clone = templateHoles(LIST_HTML, LIST_PLAN)();
    const hole = holeOf(clone);
    const parent = parentOf(clone, hole);
    const props = {
      each: () => items[0](),
      get children() {
        return kind === "For"
          ? (item: string): Node => row(item)
          : (item: Accessor<string>): Node => row(item());
      },
      get fallback() {
        reads += 1;
        return emptyBlock("b");
      },
    };
    if (direct && !isServerMode()) {
      const targeted = {
        each: () => items[0](),
        get children() {
          return props.children;
        },
        get fallback() {
          return props.fallback;
        },
        parent,
        marker: hole,
      };
      if (kind === "For") {
        For(targeted as ForProps<string>);
      } else {
        Index(targeted as IndexProps<string>);
      }
    } else if (kind === "For") {
      insert(parent, () => For(props as ForProps<string>), hole);
    } else {
      insert(parent, () => Index(props as IndexProps<string>), hole);
    }
    return clone.node;
  }
  return { app: App as unknown as AnyComponent, items, reads: () => reads };
}

describe("JSX fallback списка при гидрации", () => {
  for (const kind of ["For", "Index"] as const) {
    for (const direct of [false, true]) {
      const label = `${kind} ${direct ? "direct" : "non-direct"}`;
      it(`${label}: не читает fallback при непустом списке`, async () => {
        const test = listCase(kind, direct, ["a", "b"]);
        const html = await renderServer(test.app);
        const target = host(html);
        const mismatches: string[] = [];
        const handle = await hydrate(target, test.app, {
          onMismatch: (error) => mismatches.push(error.message),
        });
        handles.push(handle);

        expect(mismatches).toEqual([]);
        expect(test.reads()).toBe(0);
        expect(target.textContent).toBe("ab");

        test.items[1]([]);
        flushSync();
        expect(target.textContent).toBe("empty");
        const firstEmptyReads = test.reads();
        expect(firstEmptyReads).toBeGreaterThanOrEqual(1);

        test.items[1](["a"]);
        flushSync();
        expect(target.textContent).toBe("a");

        test.items[1]([]);
        flushSync();
        expect(target.textContent).toBe("empty");
        expect(test.reads()).toBeGreaterThan(firstEmptyReads);
      });

      it(`${label}: показывает fallback пустого списка после гидрации`, async () => {
        const test = listCase(kind, direct, []);
        const html = await renderServer(test.app);
        const target = host(html);
        const mismatches: string[] = [];
        const handle = await hydrate(target, test.app, {
          onMismatch: (error) => mismatches.push(error.message),
        });
        handles.push(handle);

        expect(mismatches).toEqual([]);
        expect(test.reads()).toBeGreaterThanOrEqual(1);
        expect(target.textContent).toBe("empty");

        test.items[1](["a"]);
        flushSync();
        expect(target.textContent).toBe("a");

        test.items[1]([]);
        flushSync();
        expect(target.textContent).toBe("empty");
      });
    }
  }
});

describe("JSX children и fallback Show при гидрации", () => {
  function showCase(when: boolean): {
    app: AnyComponent;
    reads: { children: number; fallback: number };
    set: (value: boolean) => void;
  } {
    const visible = createSignal(when);
    const reads = { children: 0, fallback: 0 };
    function App(): Node {
      const clone = templateHoles(SHOW_HTML, SHOW_PLAN)();
      const hole = holeOf(clone);
      insert(
        parentOf(clone, hole),
        () =>
          Show({
            when: visible[0],
            get children() {
              reads.children += 1;
              return templateHoles("<i>yes</i>", EMPTY_PLAN)().node;
            },
            get fallback() {
              reads.fallback += 1;
              return templateHoles("<b>no</b>", EMPTY_PLAN)().node;
            },
          }),
        hole,
      );
      return clone.node;
    }
    return { app: App as unknown as AnyComponent, reads, set: visible[1] };
  }

  it("гидратирует активную ветку без mismatch", async () => {
    const test = showCase(true);
    const html = await renderServer(test.app);
    const target = host(html);
    const mismatches: string[] = [];
    const handle = await hydrate(target, test.app, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(test.reads.children).toBe(2);
    expect(test.reads.fallback).toBe(0);
    expect(target.textContent).toBe("yes");

    test.set(false);
    flushSync();
    expect(target.textContent).toBe("no");
  });

  it("гидратирует fallback без mismatch", async () => {
    const test = showCase(false);
    const html = await renderServer(test.app);
    const target = host(html);
    const mismatches: string[] = [];
    const handle = await hydrate(target, test.app, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(test.reads.fallback).toBe(2);
    expect(test.reads.children).toBe(0);
    expect(target.textContent).toBe("no");

    test.set(true);
    flushSync();
    expect(target.textContent).toBe("yes");
  });
});
