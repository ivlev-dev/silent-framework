import { afterEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { createComponent, whenIdle as waitIdle } from "../src/component.js";
import { insert, setServerMode, templateHoles } from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import { lazy } from "../src/suspense.js";
import type { HydrationMismatchError } from "../src/hydration.js";
import type { MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const VIEW = Symbol.for("silent.view");
const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

const [clicks, setClicks] = createSignal(0);

function holeParent(template: { node: Node; holes: readonly Node[] }, index: number): Node {
  return template.holes[index]?.parentNode ?? template.node;
}

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "LazyMismatch" };
}

const ServerLazy = lazy(async () => ({
  default: (() => {
    const span = document.createElement("span");
    span.className = "server";
    span.textContent = "server";
    return span;
  }) as unknown as AnyComponent,
}));

class ServerLazyVM {}
function ServerLazyView(this: { vm: ServerLazyVM }): Node {
  void this.vm;
  const template = templateHoles('<div class="wrap"><!--silent-hole-0--></div>')();
  insert(holeParent(template, 0), () => ServerLazy({}), template.holes[0]!);
  return template.node;
}
attachMeta(ServerLazyView, ServerLazyVM);

const ClientLazy = lazy(async () => ({
  default: (() => {
    const button = document.createElement("button");
    button.className = "lazy";
    button.addEventListener("click", () => setClicks((value) => value + 1));
    return button;
  }) as unknown as AnyComponent,
}));

class ClientLazyVM {}
function ClientLazyView(this: { vm: ClientLazyVM }): Node {
  void this.vm;
  const template = templateHoles('<div class="wrap"><!--silent-hole-0--></div>')();
  insert(holeParent(template, 0), () => ClientLazy({}), template.holes[0]!);
  return template.node;
}
attachMeta(ClientLazyView, ClientLazyVM);

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
    await result.ready;
    await waitIdle();
    flushSync();
    await waitIdle();
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

function host(markup = ""): HTMLElement {
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

describe("гидрация lazy-чанка", () => {
  it("при mismatch перерисовывает регион и оставляет его интерактивным", async () => {
    setClicks(0);
    const html = await renderServer(ServerLazyView as unknown as AnyComponent);
    const target = host(html);

    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, ClientLazyView as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches.length).toBe(1);
    expect(target.querySelector("span.server")).toBeNull();
    const button = target.querySelector("button.lazy");
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    expect(clicks()).toBe(1);
  });
});
