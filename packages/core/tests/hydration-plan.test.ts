import { afterEach, describe, expect, it } from "vitest";
import {
  createRoot,
  createSignal,
  flushSync,
} from "@ivlev-dev/silent-reactivity";
import {
  attr,
  insert,
  setServerMode,
  template,
  templateHoles,
  type TemplateClone,
} from "../src/dom.js";
import {
  createComponent,
  whenIdle,
  type ComponentResult,
} from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import type { MountHandle } from "../src/mount.js";
import { HydrationMismatchError } from "../src/hydration.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function holeParent(template: TemplateClone, index: number): Node {
  const hole = template.holes[index] as Comment | undefined;
  return hole?.parentNode ?? template.node;
}

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Test" };
}

function build(app: AnyComponent): ComponentResult {
  let result: ComponentResult | null = null;
  createRoot(() => {
    result = createComponent(app, {});
    return null;
  });
  if (result === null) {
    throw new Error("component was not created");
  }
  return result;
}

async function renderServer(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    const result = build(app);
    await result.ready;
    await whenIdle();
    flushSync();
    await whenIdle();
    flushSync();
    const container = document.createElement("div");
    container.appendChild(result.node);
    const html = container.innerHTML;
    result.dispose();
    return html;
  } finally {
    setServerMode(false);
  }
}

const [title, setTitle] = createSignal("Title");
const [rows, setRows] = createSignal([0, 1]);

function appComponent(): Node {
  const template = templateHoles(
    '<div class="app"><h1><!--silent-hole-0--></h1><ul class="list"><!--silent-hole-1--></ul></div>',
  )();
  insert(holeParent(template, 0), () => title(), template.holes[0]);
  insert(
    holeParent(template, 1),
    () =>
      rows().map((index) => {
        const row = templateHoles("<li><!--silent-hole-0--></li>")();
        insert(holeParent(row, 0), () => String(index), row.holes[0]);
        return row.node;
      }),
    template.holes[1],
  );
  return template.node;
}

const APP = appComponent as unknown as AnyComponent;

function resetApp(): void {
  setTitle("Title");
  setRows([0, 1]);
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
  for (const element of Array.from(document.head.querySelectorAll("title"))) {
    element.remove();
  }
  setServerMode(false);
});

describe("гидрация по плану частей", () => {
  it("переиспользует узлы шаблона без метаданных", async () => {
    resetApp();
    const target = host(await renderServer(APP));
    const serverHeading = target.querySelector("h1");
    const serverRows = Array.from(target.querySelectorAll("li"));
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, APP, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("h1")).toBe(serverHeading);
    expect(Array.from(target.querySelectorAll("li"))).toEqual(serverRows);
    expect(target.textContent).toBe("Title01");
  });

  it("обновляет регион вставки после гидрации", async () => {
    resetApp();
    const target = host(await renderServer(APP));

    const handle = await hydrate(target, APP, { onMismatch: () => undefined });
    handles.push(handle);

    setTitle("Next");
    flushSync();
    expect(target.querySelector("h1")?.textContent).toBe("Next");
  });

  it("обновляет список после гидрации", async () => {
    resetApp();
    const target = host(await renderServer(APP));

    const handle = await hydrate(target, APP, { onMismatch: () => undefined });
    handles.push(handle);

    setRows([0, 1, 2]);
    flushSync();
    const next = Array.from(target.querySelectorAll("li"));
    expect(next.length).toBe(3);
    expect(next[2]?.textContent).toBe("2");
    expect(target.querySelector("h1")?.textContent).toBe("Title");
  });

  it("снимает маркеры атрибутов при гидрации", async () => {
    function Button(): Node {
      const template = templateHoles('<button class="btn" data-silent-a-0="">click</button>')();
      attr(template.node as Element, "title", () => "hint");
      return template.node;
    }

    const app = Button as unknown as AnyComponent;
    const target = host(await renderServer(app));
    const serverButton = target.querySelector("button");
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("button")).toBe(serverButton);
    expect(target.innerHTML.includes("data-silent-a-")).toBe(false);
    expect(serverButton?.getAttribute("title")).toBe("hint");
  });

  it("гидратирует шаблон с несколькими корневыми узлами", async () => {
    class MultiVM {}
    function Multi(this: { vm: MultiVM }): Node {
      void this.vm;
      const template = templateHoles("<h1>Title</h1><p><!--silent-hole-0--></p>")();
      insert(holeParent(template, 0), () => "Body", template.holes[0]);
      return template.node;
    }
    attachMeta(Multi, MultiVM);
    const app = Multi as unknown as AnyComponent;

    const target = host(await renderServer(app));
    const serverHeading = target.querySelector("h1");
    const serverParagraph = target.querySelector("p");
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("h1")).toBe(serverHeading);
    expect(target.querySelector("p")).toBe(serverParagraph);
    expect(target.textContent).toBe("TitleBody");
  });

  it("гидратирует шаблон со встроенными маркерами вставки", async () => {
    const marked = templateHoles(
      '<div class="marked"><!--silent-insert-->static<!--silent-insert-end--><!--silent-hole-0--></div>',
    );
    function Marked(): Node {
      const template = marked();
      insert(holeParent(template, 0), () => "value", template.holes[0]);
      return template.node;
    }
    const app = Marked as unknown as AnyComponent;

    const target = host(await renderServer(app));
    const serverDiv = target.querySelector("div");
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("div")).toBe(serverDiv);
    expect(target.textContent).toBe("staticvalue");
  });

  it("гидратирует шаблон без дыр через быстрый путь", async () => {
    const staticTemplate = template('<div class="static"><span>hello</span></div>');
    function Static(): Node {
      return staticTemplate();
    }
    const app = Static as unknown as AnyComponent;

    const target = host(await renderServer(app));
    const serverDiv = target.querySelector("div");
    const serverSpan = target.querySelector("span");
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("div")).toBe(serverDiv);
    expect(target.querySelector("span")).toBe(serverSpan);
    expect(target.textContent).toBe("hello");
  });

  it("находит несовпадение статического текста и рендерит заново", async () => {
    const staticTemplate = template('<div class="text"><span>hello</span></div>');
    function StaticText(): Node {
      return staticTemplate();
    }

    const target = host('<div class="text"><span>bye</span></div>');
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, StaticText as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches.length).toBeGreaterThan(0);
    expect(target.querySelector("span")?.textContent).toBe("hello");
  });

  it("находит несовпадение атрибутов и рендерит заново", async () => {
    resetApp();
    const target = host('<div class="other"><h1>Title</h1></div>');
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, APP, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches.length).toBeGreaterThan(0);
    expect(target.querySelector("div")?.getAttribute("class")).toBe("app");
  });
});

describe("гидрация шаблона с метаданными", () => {
  it("переносит title в head через полный обход", async () => {
    class PageVM {}
    function Page(this: { vm: PageVM }): Node {
      void this.vm;
      return templateHoles('<div class="page"><title>Page</title><h1>Body</h1></div>')().node;
    }
    attachMeta(Page, PageVM);
    const app = Page as unknown as AnyComponent;

    const target = host(await renderServer(app));
    expect(target.querySelector("title")).toBeNull();
    expect(document.title).toBe("");

    const serverDiv = target.querySelector("div");
    const mismatches: HydrationMismatchError[] = [];

    const handle = await hydrate(target, app, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelector("div")).toBe(serverDiv);
    expect(target.querySelector("h1")?.textContent).toBe("Body");
    expect(target.querySelector("title")).toBeNull();
    expect(document.title).toBe("Page");

    handle.dispose();
    handles.pop();
    expect(document.title).toBe("");
  });
});
