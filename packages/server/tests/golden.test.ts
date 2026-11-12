import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  For,
  Show,
  attr,
  component,
  insert,
  on,
  templateHoles,
  type AnyComponent,
  type TemplateClone,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";

const VIEW = Symbol.for("silent.view");
const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");
const UPDATE = process.env["SILENT_UPDATE_GOLDEN"] === "1";

function attachMeta(componentFn: unknown, vm: unknown): void {
  (componentFn as Record<PropertyKey, unknown>)[VIEW] = { vm };
}

function holeParent(template: TemplateClone, index: number): Node {
  const hole = template.holes[index];
  const parent = hole === undefined ? null : (hole.parentNode as Node | null);
  return parent ?? template.node;
}

function render(app: AnyComponent, props: Record<string, unknown> = {}): Promise<string> {
  return renderToString(app, { props }).then((result) => result.html);
}

function TextHole(): Node {
  const template = templateHoles('<p class="greeting"><!--silent-hole-0--></p>')();
  insert(holeParent(template, 0), () => "Hello, SSR", template.holes[0]);
  return template.node;
}

function DynamicAttribute(): Node {
  const template = templateHoles(
    '<div data-silent-a-0="" class="card"><span>body</span></div>',
  )();
  attr(template.attrs[0]!, "data-state", () => "ready");
  return template.node;
}

function ListFor(): Node {
  return For({
    each: ["alpha", "beta"],
    children: (item: string): Node => {
      const element = document.createElement("li");
      element.textContent = item;
      return element;
    },
  });
}

function ShowBranch(props: { visible: boolean }): Node {
  return Show({
    when: props.visible,
    children: (): Node => {
      const element = document.createElement("strong");
      element.textContent = "visible";
      return element;
    },
    fallback: (): Node => {
      const element = document.createElement("em");
      element.textContent = "hidden";
      return element;
    },
  });
}

class ChildVM {
  readonly label = "nested";
}

function ChildView(this: { vm: ChildVM }): Node {
  const element = document.createElement("span");
  element.setAttribute("class", "child");
  element.textContent = this.vm.label;
  return element;
}

attachMeta(ChildView, ChildVM);

function NestedComponent(): Node {
  const section = document.createElement("section");
  section.setAttribute("class", "parent");
  section.appendChild(component(ChildView as unknown as AnyComponent, {}));
  return section;
}

class CardVM {
  readonly title = "profile";
  readonly count = 3;
}

function CardView(this: { vm: CardVM }): Node {
  const template = templateHoles(
    '<section class="profile"><h2><!--silent-hole-0--></h2><p data-silent-a-0=""><!--silent-hole-1--></p></section>',
  )();
  insert(holeParent(template, 0), () => this.vm.title, template.holes[0]);
  attr(template.attrs[0]!, "data-count", () => String(this.vm.count));
  insert(holeParent(template, 1), () => this.vm.count, template.holes[1]);
  return template.node;
}

attachMeta(CardView, CardVM);

function EmptyFragment(): Node {
  const template = templateHoles("")();
  return template.node;
}

function EventClick(): Node {
  const template = templateHoles(
    '<button data-silent-a-0="" type="button">Click</button>',
  )();
  on(template.attrs[0]!, "onClick", () => () => undefined);
  return template.node;
}

interface GoldenCase {
  readonly name: string;
  readonly render: () => Promise<string>;
}

const CASES: readonly GoldenCase[] = [
  { name: "text-hole", render: () => render(TextHole as unknown as AnyComponent) },
  {
    name: "dynamic-attribute",
    render: () => render(DynamicAttribute as unknown as AnyComponent),
  },
  { name: "list-for", render: () => render(ListFor as unknown as AnyComponent) },
  {
    name: "show-true",
    render: () =>
      render(ShowBranch as unknown as AnyComponent, { visible: true }),
  },
  {
    name: "show-false",
    render: () =>
      render(ShowBranch as unknown as AnyComponent, { visible: false }),
  },
  {
    name: "nested-component",
    render: () => render(NestedComponent as unknown as AnyComponent),
  },
  { name: "view-model", render: () => render(CardView as unknown as AnyComponent) },
  {
    name: "empty-fragment",
    render: () => render(EmptyFragment as unknown as AnyComponent),
  },
  { name: "event-click", render: () => render(EventClick as unknown as AnyComponent) },
];

describe("SSR golden-разметка", () => {
  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const actual = await testCase.render();
      const file = join(GOLDEN_DIR, `${testCase.name}.html`);
      if (UPDATE) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(file, actual);
        return;
      }
      expect(existsSync(file), `нет эталона ${file}; запустите с SILENT_UPDATE_GOLDEN=1`).toBe(
        true,
      );
      expect(actual).toBe(readFileSync(file, "utf8"));
    });
  }
});
