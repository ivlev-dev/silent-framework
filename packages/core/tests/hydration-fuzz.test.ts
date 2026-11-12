// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, flushSync } from "@ivlev-dev/silent-reactivity";
import {
  createComponent,
  whenIdle,
  type ComponentResult,
} from "../src/component.js";
import { For } from "../src/control-flow.js";
import {
  attr,
  insert,
  setServerMode,
  templateHoles,
  type TemplateClone,
} from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import type { HydrationMismatchError } from "../src/hydration.js";
import type { MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const SEED = 0x5eed1234;
const ITERATIONS = 150;
const ITEMS = ["alpha", "beta"] as const;

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

function host(markup = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = markup;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function attachMeta(componentFn: unknown, vm: unknown): void {
  (componentFn as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Fuzz" };
}

function holeParent(template: TemplateClone, index: number): Node {
  const hole = template.holes[index];
  const parent = hole === undefined ? null : (hole.parentNode as Node | null);
  return parent ?? template.node;
}

function build(app: AnyComponent, props: Record<string, unknown> = {}): ComponentResult {
  let result: ComponentResult | null = null;
  createRoot(() => {
    result = createComponent(app, props);
    return null;
  });
  if (result === null) {
    throw new Error("component was not created");
  }
  return result;
}

async function renderServer(
  app: AnyComponent,
  props: Record<string, unknown> = {},
): Promise<string> {
  setServerMode(true);
  try {
    const result = build(app, props);
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

class AppVM {
  readonly label = "fuzz";
}

function AppView(this: { vm: AppVM }): Node {
  void this.vm;
  const template = templateHoles(
    '<main class="app"><h1 data-silent-a-0=""><!--silent-hole-0--></h1><ul class="items"><!--silent-hole-1--></ul></main>',
  )();
  attr(template.attrs[0]!, "data-label", () => "fuzz");
  insert(holeParent(template, 0), () => "title", template.holes[0]);
  insert(
    holeParent(template, 1),
    () =>
      For({
        each: ITEMS,
        children: (item: string): Node => templateHoles(`<li>${item}</li>`)().node,
      }),
    template.holes[1],
  );
  return template.node;
}

attachMeta(AppView, AppVM);

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function collectNodes(root: Node, filter: (node: Node) => boolean): Node[] {
  const found: Node[] = [];
  const walk = (node: Node): void => {
    let child = node.firstChild;
    while (child !== null) {
      const next = child.nextSibling;
      if (filter(child)) {
        found.push(child);
      }
      walk(child);
      child = next;
    }
  };
  walk(root);
  return found;
}

function collectElements(root: Node): Element[] {
  return collectNodes(root, (node) => node.nodeType === Node.ELEMENT_NODE) as Element[];
}

function pick<T>(values: readonly T[], random: () => number): T {
  const index = Math.min(values.length - 1, Math.floor(random() * values.length));
  const value = values[index];
  if (value === undefined) {
    throw new Error("пустой набор кандидатов");
  }
  return value;
}

type Corruptor = (root: HTMLElement, random: () => number) => string;

const removeMarker: Corruptor = (root, random) => {
  const markers = collectNodes(
    root,
    (node) =>
      node.nodeType === Node.COMMENT_NODE &&
      (node as Comment).data.startsWith("silent-"),
  );
  if (markers.length === 0) {
    return "remove-marker:нет маркеров";
  }
  const marker = pick(markers, random);
  marker.parentNode?.removeChild(marker);
  return `remove-marker:${(marker as Comment).data}`;
};

const swapNodes: Corruptor = (root, random) => {
  const parents = collectElements(root).filter((element) => {
    let count = 0;
    let child = element.firstChild;
    while (child !== null) {
      if (child.nodeType !== Node.COMMENT_NODE) {
        count += 1;
      }
      child = child.nextSibling;
    }
    return count >= 2;
  });
  const parent = pick(parents, random);
  const children = Array.from(parent.childNodes).filter(
    (node) => node.nodeType !== Node.COMMENT_NODE,
  );
  const index = Math.min(children.length - 2, Math.floor(random() * (children.length - 1)));
  const first = children[index]!;
  const second = children[index + 1]!;
  const marker = second.nextSibling;
  parent.insertBefore(second, first);
  parent.insertBefore(first, marker);
  return `swap-nodes:${parent.tagName}:${index}`;
};

const replaceText: Corruptor = (root, random) => {
  const texts = collectNodes(
    root,
    (node) => node.nodeType === Node.TEXT_NODE && (node as Text).data.trim() !== "",
  );
  if (texts.length === 0) {
    return "replace-text:нет текста";
  }
  const text = pick(texts, random) as Text;
  const previous = text.data;
  text.data = "corrupted";
  return `replace-text:${previous}`;
};

const extraNode: Corruptor = (root, random) => {
  const parents = collectElements(root);
  const parent = pick(parents, random);
  const extra = document.createElement("div");
  extra.setAttribute("data-fuzz-extra", "1");
  extra.textContent = "extra";
  parent.appendChild(extra);
  return `extra-node:${parent.tagName}`;
};

const removeAttributeMarker: Corruptor = (root, random) => {
  const elements = collectElements(root).filter((element) =>
    Array.from(element.attributes).some((entry) => entry.name.startsWith("data-silent-a-")),
  );
  if (elements.length === 0) {
    return "remove-attr-marker:нет маркеров";
  }
  const element = pick(elements, random);
  const marker = Array.from(element.attributes).find((entry) =>
    entry.name.startsWith("data-silent-a-"),
  );
  if (marker === undefined) {
    return "remove-attr-marker:нет маркеров";
  }
  element.removeAttribute(marker.name);
  return `remove-attr-marker:${marker.name}`;
};

const CORRUPTORS: readonly Corruptor[] = [
  removeMarker,
  swapNodes,
  replaceText,
  extraNode,
  removeAttributeMarker,
];

function hasSilentMarkers(element: Element): boolean {
  for (const node of element.querySelectorAll("*")) {
    for (const attribute of node.attributes) {
      if (attribute.name.startsWith("data-silent-")) {
        return true;
      }
    }
  }
  return false;
}

async function renderClientReference(): Promise<string> {
  const target = host();
  const handle = await hydrate(target, AppView as unknown as AnyComponent, {
    onMismatch: () => undefined,
  });
  const html = target.innerHTML;
  handle.dispose();
  return html;
}

describe("fuzz гидрации", () => {
  it("переживает детерминированные повреждения серверной разметки", async () => {
    const serverHtml = await renderServer(AppView as unknown as AnyComponent);
    const referenceHtml = await renderClientReference();
    const random = mulberry32(SEED);
    let successCount = 0;
    let mismatchCount = 0;

    const pristine = host(serverHtml);
    const pristineMismatches: HydrationMismatchError[] = [];
    const pristineHandle = await hydrate(pristine, AppView as unknown as AnyComponent, {
      onMismatch: (error) => pristineMismatches.push(error),
    });
    expect(
      pristineMismatches.map((error) => error.message),
      "исходная серверная разметка должна гидрироваться без несовпадений",
    ).toEqual([]);
    pristineHandle.dispose();

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const target = host(serverHtml);
      const corruptor = CORRUPTORS[Math.floor(random() * CORRUPTORS.length)] ?? removeMarker;
      const operation = corruptor(target, random);
      const corruptedHtml = target.innerHTML;

      const mismatches: HydrationMismatchError[] = [];
      const warnings: string[] = [];
      const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        warnings.push(args.map((value) => String(value)).join(" "));
      });

      let handle: MountHandle | null = null;
      let thrown: unknown = null;
      try {
        handle = await hydrate(target, AppView as unknown as AnyComponent, {
          onMismatch: (error) => mismatches.push(error),
        });
      } catch (error) {
        thrown = error;
      } finally {
        warnSpy.mockRestore();
      }

      if (thrown !== null) {
        throw new Error(
          `итерация ${iteration} (${operation}): hydrate бросил исключение`,
          { cause: thrown },
        );
      }

      expect(corruptedHtml, `итерация ${iteration}: повреждение не применилось`).not.toBe(
        "",
      );

      for (const message of warnings) {
        expect(message, `итерация ${iteration} (${operation}): предупреждение`).not.toContain(
          "[silent]",
        );
      }

      if (mismatches.length > 0) {
        mismatchCount += 1;
        expect(
          target.innerHTML,
          `итерация ${iteration} (${operation}): после onMismatch ожидался клиентский рендер`,
        ).toBe(referenceHtml);
      } else {
        successCount += 1;
      }

      if (handle !== null) {
        handle.dispose();
        expect(
          target.childNodes.length === 0 || !hasSilentMarkers(target),
          `итерация ${iteration} (${operation}): после dispose остались маркеры`,
        ).toBe(true);
      }
    }

    expect(successCount).toBeGreaterThan(0);
    expect(mismatchCount).toBeGreaterThan(0);
  });
});
