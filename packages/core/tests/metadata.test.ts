import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { mount, type MountHandle } from "../src/mount.js";
import { prop, templateHoles } from "../src/dom.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const handles: MountHandle[] = [];
const hosts: HTMLElement[] = [];

beforeAll(() => {
  for (const title of Array.from(document.head.querySelectorAll("title"))) {
    title.remove();
  }
  const base = document.createElement("title");
  base.textContent = "base";
  document.head.appendChild(base);
});

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

function headTitles(): Element[] {
  return Array.from(document.head.querySelectorAll("title")).filter(
    (title) => title.textContent !== "base",
  );
}

function attachMeta(target: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm: class {}, name: "Test" };
}

function pageHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

async function mountComponent(app: AnyComponent): Promise<HTMLElement> {
  const host = pageHost();
  const handle = await mount(host, app);
  handles.push(handle);
  return host;
}

describe("metadata hoisting", () => {
  it("переносит вложенный title в head и убирает из разметки", async () => {
    function Page(this: { vm: object }): Node {
      void this.vm;
      return templateHoles('<div class="page"><title>Page</title><h1>Body</h1></div>')().node;
    }
    attachMeta(Page);

    const host = await mountComponent(Page as unknown as AnyComponent);

    expect(headTitles().map((title) => title.textContent)).toEqual(["Page"]);
    expect(document.title).toBe("Page");
    expect(host.querySelector("title")).toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("Body");

    handles.at(-1)?.dispose();
    handles.pop();
    expect(headTitles()).toEqual([]);
    expect(document.title).toBe("base");
  });

  it("обновляет заголовок реактивно", async () => {
    const name = createSignal("Ann");
    function Page(this: { vm: object }): Node {
      void this.vm;
      const template = templateHoles(
        '<div class="page"><title data-silent-a-0="" data-silent-text=""></title><h1>Body</h1></div>',
      )();
      prop(template.attrs[0]!, "textContent", () => name[0]());
      return template.node;
    }
    attachMeta(Page);
    await mountComponent(Page as unknown as AnyComponent);

    expect(document.title).toBe("Ann");
    name[1]("Bob");
    flushSync();
    expect(document.title).toBe("Bob");
  });

  it("держит несколько заголовков одновременно", async () => {
    function First(this: { vm: object }): Node {
      void this.vm;
      return templateHoles("<div><title>First</title></div>")().node;
    }
    function Second(this: { vm: object }): Node {
      void this.vm;
      return templateHoles("<div><title>Second</title></div>")().node;
    }
    attachMeta(First);
    attachMeta(Second);

    await mountComponent(First as unknown as AnyComponent);
    await mountComponent(Second as unknown as AnyComponent);

    expect(headTitles().map((title) => title.textContent)).toEqual(["First", "Second"]);
  });

  it("не переносит title внутри svg", async () => {
    function Icon(this: { vm: object }): Node {
      void this.vm;
      return templateHoles(
        '<div class="icon"><svg><title>icon label</title><path></path></svg></div>',
      )().node;
    }
    attachMeta(Icon);

    const host = await mountComponent(Icon as unknown as AnyComponent);
    expect(headTitles()).toEqual([]);
    expect(host.querySelector("svg title")?.textContent).toBe("icon label");
  });

  it("не переносит title с itemprop", async () => {
    function Meta(this: { vm: object }): Node {
      void this.vm;
      return templateHoles(
        '<div class="book"><title itemprop="name">Book</title><h1>Body</h1></div>',
      )().node;
    }
    attachMeta(Meta);

    const host = await mountComponent(Meta as unknown as AnyComponent);
    expect(headTitles()).toEqual([]);
    expect(host.querySelector("title")?.textContent).toBe("Book");
  });
});
