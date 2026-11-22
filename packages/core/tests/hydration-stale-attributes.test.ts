// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, flushSync } from "@ivlev-dev/silent-reactivity";
import { createComponent, whenIdle as waitIdle } from "../src/component.js";
import {
  attr,
  insert,
  setServerMode,
  templateHoles,
  type TemplateClone,
  type TemplatePlan,
} from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import { removeStaleAttributes, type HydrationMismatchError } from "../src/hydration.js";
import type { MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const TEMPLATE =
  '<div class="app" data-silent-a-0=""><span>ok</span></div>';
const PLAN: TemplatePlan = {
  roots: 1,
  holes: [],
  attrs: [{ path: [0], counts: [1] }],
  strips: [{ path: [0], counts: [1], names: ["data-silent-a-0"] }],
};

class StaleVM {}
function StaleView(this: { vm: StaleVM }): Node {
  void this.vm;
  const template = templateHoles(TEMPLATE, PLAN)();
  attr(template.attrs[0]!, "title", () => "hint");
  return template.node;
}
(StaleView as unknown as Record<PropertyKey, unknown>)[VIEW] = {
  vm: StaleVM,
  name: "Stale",
};

const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

async function renderServer(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    let result: ReturnType<typeof createComponent> | null = null;
    createRoot(() => {
      result = createComponent(app, {});
      return null;
    });
    if (result === null) {
      throw new Error("компонент не создан");
    }
    const created: ReturnType<typeof createComponent> = result;
    await created.ready;
    await waitIdle();
    flushSync();
    await waitIdle();
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

function host(markup: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("гидрация: stale-атрибуты", () => {
  it("удаляет исполняемые stale-атрибуты, доверяя прочим", async () => {
    const serverHtml = await renderServer(StaleView as unknown as AnyComponent);
    const tampered = serverHtml
      .replace('<div class="app"', '<div class="app" onerror="alert(1)"')
      .replace("<span", '<span onload="alert(2)" data-stale="1" href="javascript:alert(3)"');
    const target = host(tampered);

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, StaleView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.innerHTML).not.toContain("onerror");
    expect(target.innerHTML).not.toContain("onload");
    expect(target.innerHTML).not.toContain("javascript:");
    // Обычные статические атрибуты считаются доверенными (см. hydration.ts).
    expect(target.innerHTML).toContain('data-stale="1"');
    expect(target.querySelector("div.app")?.getAttribute("title")).toBe("hint");
  });
});

function element(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as Element;
}

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Stale" };
}

function viewMarkup(html: string): string {
  return `<!--silent-view-->${html}<!--silent-view-end-->`;
}

function holeParent(template: TemplateClone, index: number): Node {
  const hole = template.holes[index] as { parentNode?: Node } | undefined;
  return hole?.parentNode ?? template.node;
}

describe("removeStaleAttributes: свежий шаблон — источник доверия", () => {
  it("сохраняет исполняемые атрибуты, совпадающие со fresh", () => {
    const fresh = element(
      '<a href="data:text/plain,hi" srcdoc="<p>hi</p>"></a>',
    );
    const claimed = element(
      '<a href="data:text/plain,hi" srcdoc="<p>hi</p>"></a>',
    );

    removeStaleAttributes(fresh, claimed);

    expect(claimed.getAttribute("href")).toBe("data:text/plain,hi");
    expect(claimed.getAttribute("srcdoc")).toBe("<p>hi</p>");
  });

  it("удаляет отсутствующие и подменённые исполняемые атрибуты", () => {
    const fresh = element(
      '<a href="data:text/plain,hi" srcdoc="<p>hi</p>"></a>',
    );
    const claimed = element(
      '<a onclick="alert(1)" href="javascript:alert(2)" srcdoc="<script>x</script>"></a>',
    );

    removeStaleAttributes(fresh, claimed);

    expect(claimed.hasAttribute("onclick")).toBe(false);
    expect(claimed.hasAttribute("href")).toBe(false);
    expect(claimed.hasAttribute("srcdoc")).toBe(false);
  });

  it("сопоставляет атрибуты с учётом namespace", () => {
    const SVG = "http://www.w3.org/2000/svg";
    const XLINK = "http://www.w3.org/1999/xlink";
    const fresh = document.createElementNS(SVG, "use");
    fresh.setAttributeNS(XLINK, "xlink:href", "data:image/svg+xml,ok");
    const claimed = document.createElementNS(SVG, "use");
    claimed.setAttributeNS(XLINK, "xlink:href", "data:image/svg+xml,ok");

    removeStaleAttributes(fresh, claimed);
    expect(claimed.getAttributeNS(XLINK, "href")).toBe("data:image/svg+xml,ok");

    claimed.setAttributeNS(XLINK, "xlink:href", "javascript:alert(1)");
    removeStaleAttributes(fresh, claimed);
    expect(claimed.hasAttributeNS(XLINK, "href")).toBe(false);
  });
});

describe("гидрация: легитимные исполняемые атрибуты из свежего шаблона", () => {
  const TEMPLATE =
    '<div class="safe">'
    + '<a href="data:text/plain,hi">text</a>'
    + '<img src="blob:https://example.test/y">'
    + '<iframe srcdoc="<p>hi</p>"></iframe>'
    + "</div>";
  const PLAN: TemplatePlan = { roots: 1, holes: [], attrs: [], strips: [] };

  class SafeVM {}
  function SafeView(this: { vm: SafeVM }): Node {
    void this.vm;
    return templateHoles(TEMPLATE, PLAN)().node;
  }
  attachMeta(SafeView, SafeVM);

  it("сохраняет srcdoc, data: и blob: из свежего шаблона", async () => {
    const target = host(viewMarkup(TEMPLATE));
    const originals = Array.from(target.querySelectorAll("*"));

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, SafeView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(Array.from(target.querySelectorAll("*"))).toEqual(originals);
    expect(target.querySelector("a")?.getAttribute("href")).toBe(
      "data:text/plain,hi",
    );
    expect(target.querySelector("img")?.getAttribute("src")).toBe(
      "blob:https://example.test/y",
    );
    expect(target.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
      "<p>hi</p>",
    );
  });

  it("удаляет подменённые исполняемые атрибуты", async () => {
    const tampered = TEMPLATE
      .replace('href="data:text/plain,hi"', 'onclick="alert(1)" href="javascript:alert(2)"')
      .replace('src="blob:https://example.test/y"', 'src="blob:https://example.test/y" onerror="alert(3)"')
      .replace('srcdoc="<p>hi</p>"', 'srcdoc="<script>alert(4)</script>"');
    const target = host(viewMarkup(tampered));

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, SafeView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.innerHTML).not.toContain("onclick");
    expect(target.innerHTML).not.toContain("onerror");
    expect(target.innerHTML).not.toContain("javascript:");
    expect(target.innerHTML).not.toContain("<script>");
    expect(target.querySelector("img")?.getAttribute("src")).toBe(
      "blob:https://example.test/y",
    );
    expect(target.querySelector("iframe")?.hasAttribute("srcdoc")).toBe(false);
  });
});

describe("гидрация: plan-less шаблоны со stale-атрибутами", () => {
  const TEMPLATE =
    '<div class="wrap">'
    + '<a class="link" href="/docs">docs</a>'
    + '<a class="cta" href="/start">start</a>'
    + "</div>";
  const TAMPERED =
    '<div class="wrap">'
    + '<a class="link" href="/docs" onclick="alert(1)" srcdoc="<script>alert(2)</script>">docs</a>'
    + '<a class="cta" href="javascript:alert(3)">start</a>'
    + "</div>";

  for (const plan of [undefined, false] as const) {
    it(`чистит stale-атрибуты при plan=${String(plan)}`, async () => {
      class PlanlessVM {}
      function PlanlessView(this: { vm: PlanlessVM }): Node {
        void this.vm;
        return templateHoles(TEMPLATE, plan)().node;
      }
      attachMeta(PlanlessView, PlanlessVM);

      const target = host(viewMarkup(TAMPERED));
      const mismatches: HydrationMismatchError[] = [];
      const handle = await hydrate(target, PlanlessView as unknown as AnyComponent, {
        onMismatch: (error) => mismatches.push(error),
      });
      handles.push(handle);

      expect(mismatches).toEqual([]);
      expect(target.innerHTML).not.toContain("onclick");
      expect(target.innerHTML).not.toContain("srcdoc");
      expect(target.innerHTML).not.toContain("javascript:");
      const link = target.querySelector("a.link");
      expect(link?.getAttribute("class")).toBe("link");
      expect(link?.getAttribute("href")).toBe("/docs");
      expect(target.querySelector("a.cta")?.hasAttribute("href")).toBe(false);
    });
  }
});

describe("гидрация: маркеры вложенных компонентов", () => {
  const CHILD_TEMPLATE = '<span class="child" data-silent-a-0="">child</span>';
  const CHILD_PLAN: TemplatePlan = {
    roots: 1,
    holes: [],
    attrs: [{ path: [0], counts: [1] }],
    strips: [{ path: [0], counts: [1], names: ["data-silent-a-0"] }],
  };
  function ChildView(): Node {
    const template = templateHoles(CHILD_TEMPLATE, CHILD_PLAN)();
    attr(template.attrs[0]!, "title", () => "child-title");
    return template.node;
  }

  const PARENT_TEMPLATE =
    '<div class="parent" data-silent-a-0=""><!--silent-hole-0--></div>';
  const PARENT_PLAN: TemplatePlan = {
    roots: 1,
    holes: [{ path: [0, 0], counts: [1, 1] }],
    attrs: [{ path: [0], counts: [1] }],
    strips: [{ path: [0], counts: [1], names: ["data-silent-a-0"] }],
  };

  class ParentVM {}
  function ParentView(this: { vm: ParentVM }): Node {
    void this.vm;
    const template = templateHoles(PARENT_TEMPLATE, PARENT_PLAN)();
    attr(template.attrs[0]!, "title", () => "parent-title");
    insert(holeParent(template, 0), () => ChildView(), template.holes[0]!);
    return template.node;
  }
  attachMeta(ParentView, ParentVM);

  it("не снимает маркеры вложенного компонента до его гидрации", async () => {
    const serverHtml = await renderServer(ParentView as unknown as AnyComponent);
    expect(serverHtml).toContain("data-silent-a-0");
    const target = host(serverHtml);

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, ParentView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(target.querySelectorAll("span.child").length).toBe(1);
    expect(target.querySelector(".parent")?.getAttribute("title")).toBe("parent-title");
    expect(target.querySelector("span.child")?.getAttribute("title")).toBe("child-title");
    expect(target.innerHTML).not.toContain("data-silent-");
  });
});
