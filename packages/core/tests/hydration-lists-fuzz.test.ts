// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createRoot,
  createSignal,
  deepReactive,
  flushSync,
  getReactivityStats,
  isReactive,
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
import { Index } from "../src/index-list.js";
import { component } from "../src/component-lite.js";
import { createComponent, whenIdle, type ComponentResult } from "../src/component.js";
import { hydrate } from "../src/hydrate.js";
import { isStaticHydration } from "../src/dom-hydration-state.js";
import { HydrationMismatchError } from "../src/hydration.js";
import type { AnyComponent } from "../src/types.js";

const ROW_HTML = '<li class="row" data-silent-a-0=""><!--silent-hole-0--></li>';
const ROW_PLAN: TemplatePlan = {
  roots: 1,
  holes: [{ path: [0, 0], counts: [1, 1] }],
  attrs: [{ path: [0], counts: [1] }],
  strips: [{ path: [0], counts: [1], names: ["data-silent-a-0"] }],
};

const FALLBACK_HTML = '<li class="fallback">empty</li>';

interface RowView {
  id: string;
  label: string;
  flag: boolean;
}

type FuzzItem = RowView | string;
type Variant = "plain" | "reactive" | "class" | "primitive";
type ListKind = "for" | "index";

interface FuzzConfig {
  readonly kind: ListKind;
  readonly staticRows: boolean;
  readonly useIndex: boolean;
  readonly keyed: boolean;
  readonly fallback: boolean;
  readonly handler: boolean;
}

interface Counter {
  value: number;
}

interface ExpectedRow {
  readonly kind: "row" | "fallback";
  readonly id: string;
  readonly label: string;
  readonly flag: string;
}

class RowInstance implements RowView {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly flag: boolean,
  ) {}
}

const hosts: HTMLElement[] = [];
const clicked: string[] = [];

const SEED = 0x1f2e3d4c;
const STICKY_SEED = 0xa5b6c7d8;
const ITERATIONS = 240;
const STICKY_ROUNDS = 50;
const STATS_TOLERANCE = 8;

afterEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
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

function pick(random: () => number, limit: number): number {
  return Math.min(limit - 1, Math.floor(random() * limit));
}

function holeParent(template: TemplateClone): Node {
  const hole = template.holes[0];
  if (hole === undefined) {
    throw new Error("шаблон строки не собран");
  }
  return (hole.parentNode as Node | null) ?? template.node;
}

function viewOf(item: FuzzItem): RowView {
  if (typeof item === "string") {
    return { id: item, label: item, flag: item.length % 2 === 0 };
  }
  return item;
}

function makeRow(item: FuzzItem, withHandler: boolean): Node {
  const view = viewOf(item);
  const template = templateHoles(ROW_HTML, ROW_PLAN)();
  const element = template.attrs[0];
  const hole = template.holes[0];
  if (element === undefined || hole === undefined) {
    throw new Error("шаблон строки не собран");
  }
  attr(element, "data-id", () => view.id);
  attr(element, "data-flag", () => (view.flag ? "1" : "0"));
  insert(
    holeParent(template),
    () => view.label,
    hole,
  );
  if (withHandler) {
    on(element, "onClick", () => () => {
      clicked.push(view.id);
    });
  }
  return template.node;
}

function fallbackNode(): Node {
  return templateHoles(FALLBACK_HTML)().node;
}

function makeApp(
  config: FuzzConfig,
  list: () => readonly FuzzItem[],
): AnyComponent {
  return function App(): Node {
    if (config.kind === "index") {
      return component(Index as never, {
        get each() {
          return list();
        },
        index: config.useIndex,
        ...(config.fallback
          ? {
              fallback: (): Node => fallbackNode(),
            }
          : {}),
        get children() {
          return (item: () => FuzzItem): Node => makeRow(item(), config.handler);
        },
      } as never);
    }
    const keyOf = config.keyed ? (item: FuzzItem): string => viewOf(item).id : undefined;
    return component(For as never, {
      get each() {
        return list();
      },
      ...(keyOf === undefined ? {} : { keyOf }),
      index: config.useIndex,
      staticRows: config.staticRows,
      ...(config.fallback
        ? {
            fallback: (): Node => fallbackNode(),
          }
        : {}),
      get children() {
        return (item: FuzzItem): Node => makeRow(item, config.handler);
      },
    } as never);
  } as unknown as AnyComponent;
}

async function serverMarkup(app: AnyComponent): Promise<string> {
  setServerMode(true);
  try {
    let result: ComponentResult | null = null;
    const disposeRoot = createRoot((dispose) => {
      result = createComponent(app, {});
      return dispose;
    });
    if (result === null) {
      disposeRoot();
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
    disposeRoot();
    return html;
  } finally {
    setServerMode(false);
  }
}

function randomConfig(random: () => number): FuzzConfig {
  const kind: ListKind = random() < 0.5 ? "for" : "index";
  return {
    kind,
    staticRows: kind === "for" && random() < 0.5,
    useIndex: random() < 0.5,
    keyed: kind === "for" && random() < 0.7,
    fallback: random() < 0.4,
    handler: random() < 0.5,
  };
}

function newToken(counter: Counter): string {
  counter.value += 1;
  return `t${String(counter.value)}`;
}

function pickVariant(random: () => number, allowPrimitive: boolean): Variant {
  const roll = random();
  if (allowPrimitive && roll < 0.15) {
    return "primitive";
  }
  if (roll < 0.35) {
    return "reactive";
  }
  if (roll < 0.5) {
    return "class";
  }
  return "plain";
}

function makeItem(
  variant: Variant,
  idToken: string,
  labelToken: string,
  flag: boolean,
): FuzzItem {
  const label = `L${labelToken}`;
  if (variant === "primitive") {
    return label;
  }
  if (variant === "class") {
    return new RowInstance(idToken, label, flag);
  }
  if (variant === "reactive") {
    return deepReactive<RowView>({ id: idToken, label, flag });
  }
  return { id: idToken, label, flag };
}

function makeItems(
  random: () => number,
  counter: Counter,
  length: number,
): FuzzItem[] {
  const items: FuzzItem[] = [];
  for (let index = 0; index < length; index += 1) {
    items.push(
      makeItem(
        pickVariant(random, true),
        newToken(counter),
        newToken(counter),
        random() < 0.5,
      ),
    );
  }
  return items;
}

function replaceItem(
  items: readonly FuzzItem[],
  position: number,
  random: () => number,
  counter: Counter,
  sameKey: boolean,
): FuzzItem[] {
  const next = items.slice();
  const current = items[position];
  if (current === undefined) {
    return next;
  }
  const currentView = viewOf(current);
  if (sameKey && typeof current !== "string") {
    next[position] = makeItem(
      pickVariant(random, false),
      currentView.id,
      newToken(counter),
      !currentView.flag,
    );
    return next;
  }
  next[position] = makeItem(
    pickVariant(random, true),
    newToken(counter),
    newToken(counter),
    !currentView.flag,
  );
  return next;
}

interface MutationResult {
  readonly items: FuzzItem[];
  readonly operation: string;
}

function mutateItems(
  items: readonly FuzzItem[],
  random: () => number,
  counter: Counter,
): MutationResult {
  const next = items.slice();
  const roll = random();

  if (roll < 0.1) {
    return { items: [], operation: "clear" };
  }

  if (roll < 0.24) {
    if (next.length >= 2) {
      const from = pick(random, next.length);
      const to = pick(random, next.length);
      const moved = next.splice(from, 1)[0];
      if (moved !== undefined) {
        next.splice(to, 0, moved);
      }
      return { items: next, operation: `move:${String(from)}->${String(to)}` };
    }
    return { items: next, operation: "move:noop" };
  }

  if (roll < 0.42) {
    const position = pick(random, next.length + 1);
    next.splice(
      position,
      0,
      makeItem(
        pickVariant(random, true),
        newToken(counter),
        newToken(counter),
        random() < 0.5,
      ),
    );
    return { items: next, operation: `insert:${String(position)}` };
  }

  if (roll < 0.54) {
    if (next.length > 0) {
      const position = pick(random, next.length);
      next.splice(position, 1);
      return { items: next, operation: `remove:${String(position)}` };
    }
    return { items: next, operation: "remove:noop" };
  }

  if (roll < 0.7) {
    if (next.length > 0) {
      const position = pick(random, next.length);
      return {
        items: replaceItem(next, position, random, counter, true),
        operation: `replace-same:${String(position)}`,
      };
    }
    return { items: next, operation: "replace-same:noop" };
  }

  if (roll < 0.82) {
    if (next.length > 0) {
      const position = pick(random, next.length);
      return {
        items: replaceItem(next, position, random, counter, false),
        operation: `replace-new:${String(position)}`,
      };
    }
    return { items: next, operation: "replace-new:noop" };
  }

  if (roll < 0.92) {
    for (let index = 0; index < next.length; index += 1) {
      const item = next[index];
      if (item !== undefined && typeof item === "object" && isReactive(item)) {
        item.label = `L${newToken(counter)}`;
        item.flag = !item.flag;
        return { items: next, operation: `poke-reactive:${String(index)}` };
      }
    }
    return { items: next, operation: "poke-reactive:none" };
  }

  const length = Math.floor(random() * 9);
  return {
    items: makeItems(random, counter, length),
    operation: `bulk:${String(length)}`,
  };
}

function expectedRows(items: readonly FuzzItem[], hasFallback: boolean): ExpectedRow[] {
  if (items.length === 0) {
    return hasFallback
      ? [{ kind: "fallback", id: "fallback", label: "empty", flag: "-" }]
      : [];
  }
  return items.map((item) => {
    const view = viewOf(item);
    return {
      kind: "row" as const,
      id: view.id,
      label: view.label,
      flag: view.flag ? "1" : "0",
    };
  });
}

function readRows(root: ParentNode): ExpectedRow[] {
  return Array.from(root.querySelectorAll("li")).map((element) => {
    if (element.classList.contains("fallback")) {
      return {
        kind: "fallback" as const,
        id: "fallback",
        label: element.textContent ?? "",
        flag: "-",
      };
    }
    return {
      kind: "row" as const,
      id: element.getAttribute("data-id") ?? "",
      label: element.textContent ?? "",
      flag: element.getAttribute("data-flag") ?? "",
    };
  });
}

function assertDom(
  root: HTMLElement,
  items: readonly FuzzItem[],
  hasFallback: boolean,
  context: string,
): void {
  const expected = expectedRows(items, hasFallback);
  expect(readRows(root), `${context}: строки`).toEqual(expected);
  expect(root.textContent, `${context}: текст`).toBe(
    expected.map((row) => row.label).join(""),
  );
}

function assertClicks(
  root: HTMLElement,
  items: readonly FuzzItem[],
  handler: boolean,
  context: string,
): void {
  clicked.length = 0;
  for (const element of Array.from(root.querySelectorAll("li.row"))) {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  const ids = items.map((item) => viewOf(item).id);
  expect(clicked, `${context}: обработчики кликов`).toEqual(handler ? ids : []);
}

function assertNoStaticStick(context: string): void {
  expect(isStaticHydration(), `${context}: статический режим залип`).toBe(false);
}

function assertContainerClean(root: HTMLElement, context: string): void {
  expect(root.querySelectorAll("*").length, `${context}: остались элементы`).toBe(0);
  expect(root.textContent, `${context}: остался текст`).toBe("");
  const leftovers = Array.from(root.childNodes);
  for (const node of leftovers) {
    expect(node.nodeType, `${context}: остался не комментарий`).toBe(Node.COMMENT_NODE);
    expect((node as Comment).data, `${context}: остался служебный маркер`).toBe("silent-end");
  }
}

describe("фаззинг гидратации списков", () => {
  it("переживает детерминированные конфигурации For/Index со staticRows", async () => {
    const random = mulberry32(SEED);
    const counter: Counter = { value: 0 };
    const base = getReactivityStats();
    let maxEffectsDrift = 0;
    let maxOwnersDrift = 0;

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const config = randomConfig(random);
      const context = `итерация ${String(iteration)} (${config.kind}, static=${String(
        config.staticRows,
      )}, keyed=${String(config.keyed)}, index=${String(config.useIndex)}, fb=${String(
        config.fallback,
      )}, handler=${String(config.handler)})`;
      const initial = makeItems(random, counter, Math.floor(random() * 9));
      const [list, setList] = createSignal<readonly FuzzItem[]>(initial);
      const app = makeApp(config, list);

      const markup = await serverMarkup(app);
      const root = host(markup);
      const serverRows = Array.from(root.querySelectorAll("li"));
      const before = getReactivityStats().renderEffectsCreated;
      const mismatches: HydrationMismatchError[] = [];
      const handle = await hydrate(root, app, {
        onMismatch: (error) => mismatches.push(error),
      });
      const created = getReactivityStats().renderEffectsCreated - before;

      assertNoStaticStick(`${context}: после гидрации`);
      expect(mismatches, `${context}: несовпадения при чистой гидрации`).toEqual([]);
      expect(
        Array.from(root.querySelectorAll("li")),
        `${context}: серверные узлы должны быть адоптированы`,
      ).toEqual(serverRows);

      if (
        config.staticRows &&
        config.kind === "for" &&
        !config.handler &&
        initial.every((item) => typeof item !== "object" || !isReactive(item))
      ) {
        expect(created, `${context}: staticRows не должен создавать эффекты строк`).toBeLessThanOrEqual(
          1,
        );
      }
      if (
        !config.staticRows &&
        config.kind === "index" &&
        !config.handler &&
        initial.length > 0
      ) {
        expect(created, `${context}: Index должен создать эффект строки`).toBeGreaterThanOrEqual(
          initial.length,
        );
      }

      assertDom(root, initial, config.fallback, `${context}: после гидрации`);
      assertClicks(root, initial, config.handler, `${context}: после гидрации`);

      let current = initial;
      const mutations = config.kind === "index" ? 0 : 1 + Math.floor(random() * 3);
      for (let step = 0; step < mutations; step += 1) {
        const mutation = mutateItems(current, random, counter);
        current = mutation.items;
        setList(current);
        flushSync();
        const mutationContext = `${context}: мутация ${String(step)} ${mutation.operation}`;
        if (iteration === 39) {
          console.log(
            "DEBUG39",
            mutation.operation,
            JSON.stringify(current.map((item) => viewOf(item).label)),
            JSON.stringify(root.innerHTML),
          );
        }
        assertNoStaticStick(mutationContext);
        assertDom(root, current, config.fallback, mutationContext);
        assertClicks(root, current, config.handler, mutationContext);
        expect(
          Array.from(root.querySelectorAll("li.row")).length,
          `${mutationContext}: число строк`,
        ).toBe(current.length);
      }

      handle.dispose();
      assertNoStaticStick(`${context}: после dispose`);
      assertContainerClean(root, `${context}: после dispose`);

      const stats = getReactivityStats();
      expect(stats.activeEffects, `${context}: утечка эффектов`).toBeLessThanOrEqual(
        base.activeEffects + STATS_TOLERANCE,
      );
      expect(stats.activeOwners, `${context}: утечка владельцев`).toBeLessThanOrEqual(
        base.activeOwners + STATS_TOLERANCE,
      );
      maxEffectsDrift = Math.max(maxEffectsDrift, stats.activeEffects - base.activeEffects);
      maxOwnersDrift = Math.max(maxOwnersDrift, stats.activeOwners - base.activeOwners);
      root.remove();
    }

    const final = getReactivityStats();
    expect(maxEffectsDrift, "накопленный дрейф activeEffects").toBeLessThanOrEqual(
      STATS_TOLERANCE,
    );
    expect(maxOwnersDrift, "накопленный дрейф activeOwners").toBeLessThanOrEqual(
      STATS_TOLERANCE,
    );
    expect(Math.abs(final.activeEffects - base.activeEffects)).toBeLessThanOrEqual(
      STATS_TOLERANCE,
    );
    expect(Math.abs(final.activeOwners - base.activeOwners)).toBeLessThanOrEqual(
      STATS_TOLERANCE,
    );
    assertNoStaticStick("конец фаззинга");
  });

  it("не залипает в статическом режиме после mismatch", async () => {
    const random = mulberry32(STICKY_SEED);
    const counter: Counter = { value: 0 };
    const base = getReactivityStats();
    const [pulse, setPulse] = createSignal(0);

    const makePulseRow = (item: FuzzItem): Node => {
      const view = viewOf(item);
      const template = templateHoles(ROW_HTML, ROW_PLAN)();
      const element = template.attrs[0];
      const hole = template.holes[0];
      if (element === undefined || hole === undefined) {
        throw new Error("шаблон строки не собран");
      }
      attr(element, "data-id", () => view.id);
      attr(element, "data-flag", () => (view.flag ? "1" : "0"));
      insert(
        holeParent(template),
        () => (pulse() === 0 ? view.label : `${view.label}!`),
        hole,
      );
      return template.node;
    };

    for (let round = 0; round < STICKY_ROUNDS; round += 1) {
      const context = `раунд ${String(round)}`;
      const staticRows = round % 4 === 0 || round % 4 === 1;
      const bad = round % 2 === 1;
      const length = 2 + Math.floor(random() * 3);
      const items: FuzzItem[] = [];
      for (let index = 0; index < length; index += 1) {
        items.push({
          id: newToken(counter),
          label: `L${newToken(counter)}`,
          flag: random() < 0.5,
        });
      }
      const [list] = createSignal<readonly FuzzItem[]>(items);
      function App(): Node {
        return component(For as never, {
          get each() {
            return list();
          },
          keyOf: (item: FuzzItem): string => viewOf(item).id,
          staticRows,
          get children() {
            return (item: FuzzItem): Node => makePulseRow(item);
          },
        } as never);
      }
      const app = App as unknown as AnyComponent;
      const markup = await serverMarkup(app);
      const root = host(markup);

      if (bad) {
        const first = root.querySelector("li");
        if (first === null) {
          throw new Error("строка не найдена");
        }
        first.textContent = "corrupted";
      }

      const mismatches: HydrationMismatchError[] = [];
      const before = getReactivityStats().renderEffectsCreated;
      const handle = await hydrate(root, app, {
        onMismatch: (error) => mismatches.push(error),
      });
      const created = getReactivityStats().renderEffectsCreated - before;

      expect(mismatches.length > 0, `${context}: ожидался mismatch`).toBe(bad);
      assertNoStaticStick(`${context}: после гидрации`);
      assertDom(root, items, false, context);

      if (!bad && !staticRows) {
        expect(created, `${context}: гидрация обязана создать эффекты строк`).toBeGreaterThanOrEqual(
          items.length,
        );
        const expected = items
          .map((item) => `${viewOf(item).label}!`)
          .join("");
        setPulse(1);
        flushSync();
        expect(root.textContent, `${context}: эффекты не сработали`).toBe(expected);
        setPulse(0);
        flushSync();
        expect(root.textContent, `${context}: текст не вернулся`).toBe(
          items.map((item) => viewOf(item).label).join(""),
        );
      } else if (!bad && staticRows) {
        expect(created, `${context}: staticRows не должен создавать эффекты строк`).toBeLessThanOrEqual(
          1,
        );
      }

      handle.dispose();
      assertNoStaticStick(`${context}: после dispose`);
      assertContainerClean(root, `${context}: после dispose`);
      root.remove();
    }

    setPulse(0);
    flushSync();
    const final = getReactivityStats();
    expect(Math.abs(final.activeEffects - base.activeEffects)).toBeLessThanOrEqual(
      STATS_TOLERANCE,
    );
    expect(Math.abs(final.activeOwners - base.activeOwners)).toBeLessThanOrEqual(
      STATS_TOLERANCE,
    );
  });

  it("возвращает счётчики реактивности после dispose всех рутов", async () => {
    const random = mulberry32(0x0badf00d);
    const counter: Counter = { value: 0 };
    const base = getReactivityStats();
    const handles: Array<{ root: HTMLElement; dispose: () => void }> = [];

    for (let index = 0; index < 12; index += 1) {
      const config = randomConfig(random);
      const items = makeItems(random, counter, 1 + Math.floor(random() * 8));
      const [list] = createSignal<readonly FuzzItem[]>(items);
      const app = makeApp(config, list);
      const root = host(await serverMarkup(app));
      const handle = await hydrate(root, app, {
        onMismatch: () => undefined,
      });
      handles.push({ root, dispose: () => handle.dispose() });
    }

    const live = getReactivityStats();
    expect(live.activeEffects, "до dispose должны жить эффекты").toBeGreaterThanOrEqual(
      base.activeEffects,
    );
    expect(live.activeOwners, "до dispose должны жить владельцы").toBeGreaterThanOrEqual(
      base.activeOwners,
    );

    for (const entry of handles) {
      entry.dispose();
      assertContainerClean(entry.root, "после dispose");
      entry.root.remove();
    }
    flushSync();

    const final = getReactivityStats();
    expect(Math.abs(final.activeEffects - base.activeEffects)).toBeLessThanOrEqual(
      STATS_TOLERANCE,
    );
    expect(Math.abs(final.activeOwners - base.activeOwners)).toBeLessThanOrEqual(
      STATS_TOLERANCE,
    );
    assertNoStaticStick("после dispose всех рутов");
  });
});
