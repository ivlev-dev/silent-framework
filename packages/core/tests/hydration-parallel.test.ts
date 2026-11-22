import { afterEach, describe, expect, it } from "vitest";
import { flushSync } from "@ivlev-dev/silent-reactivity";
import { container, DI_CREATE } from "@ivlev-dev/silent-di";
import { insert, templateHoles, type TemplateClone } from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import { HydrationMismatchError, isHydrating } from "../src/hydration.js";
import { beginHydration, currentWindow, endHydration } from "../src/hydration-state.js";
import type { MountHandle } from "../src/mount.js";
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
  const hole = template.holes[index];
  return (hole?.parentNode as Node | undefined) ?? template.node;
}

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Test" };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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

describe("параллельная гидрация", () => {
  it("endHydration не сбрасывает контекст другого вызова", () => {
    const first = beginHydration();
    expect(isHydrating()).toBe(true);

    const second = beginHydration(() => undefined);
    endHydration(first);

    expect(isHydrating()).toBe(true);
    expect(currentWindow()).toBeNull();

    endHydration(second);
    expect(isHydrating()).toBe(false);
  });

  it("изолирует два hydrate на разных контейнерах", async () => {
    const gate = deferred();
    class SlowVM {
      value = "hydrated";
      static [DI_CREATE] = async (): Promise<SlowVM> => {
        await gate.promise;
        return new SlowVM();
      };
    }
    function View(this: { vm: SlowVM }): Node {
      const template = templateHoles('<p class="value"><!--silent-hole-0--></p>')();
      insert(holeParent(template, 0), () => this.vm.value, template.holes[0]);
      return template.node;
    }
    attachMeta(View, SlowVM);

    const stale = host('<!--silent-view--><span class="stale">old</span><!--silent-view-end-->');
    const fresh = host(
      '<!--silent-view--><p class="value">hydrated<!--silent-hole-0--></p><!--silent-view-end-->',
    );
    const serverParagraph = fresh.querySelector("p.value");
    const staleMismatches: HydrationMismatchError[] = [];
    const freshMismatches: HydrationMismatchError[] = [];

    const first = hydrate(stale, View as unknown as AnyComponent, {
      container: container,
      onMismatch: (error) => staleMismatches.push(error),
    });
    const second = hydrate(fresh, View as unknown as AnyComponent, {
      container: container,
      onMismatch: (error) => freshMismatches.push(error),
    });

    gate.resolve();
    const firstHandle = await first;
    const secondHandle = await second;
    handles.push(firstHandle, secondHandle);

    expect(staleMismatches.length).toBe(1);
    expect(freshMismatches).toEqual([]);
    expect(stale.querySelector("span")).toBeNull();
    expect(stale.textContent).toBe("hydrated");
    expect(fresh.querySelector("p.value")).toBe(serverParagraph);
    expect(fresh.textContent).toBe("hydrated");
    expect(isHydrating()).toBe(false);
  });

  it("сохраняет серверную разметку второго контейнера до его очереди", async () => {
    const gate = deferred();
    class SlowVM {
      value = "ready";
      static [DI_CREATE] = async (): Promise<SlowVM> => {
        await gate.promise;
        return new SlowVM();
      };
    }
    function View(this: { vm: SlowVM }): Node {
      const template = templateHoles('<p class="value"><!--silent-hole-0--></p>')();
      insert(holeParent(template, 0), () => this.vm.value, template.holes[0]);
      return template.node;
    }
    attachMeta(View, SlowVM);

    const first = host(
      '<!--silent-view--><p class="value">ready<!--silent-hole-0--></p><!--silent-view-end-->',
    );
    const second = host(
      '<!--silent-view--><p class="value">ready<!--silent-hole-0--></p><!--silent-view-end-->',
    );
    const firstParagraph = first.querySelector("p.value");
    const secondParagraph = second.querySelector("p.value");

    const pending = hydrate(first, View as unknown as AnyComponent, {
      onMismatch: () => undefined,
    });
    const queued = hydrate(second, View as unknown as AnyComponent, {
      onMismatch: () => undefined,
    });

    expect(second.textContent).toBe("ready");
    expect(second.querySelector("p.value")).toBe(secondParagraph);

    gate.resolve();
    const firstHandle = await pending;
    const secondHandle = await queued;
    handles.push(firstHandle, secondHandle);

    expect(first.querySelector("p.value")).toBe(firstParagraph);
    expect(second.querySelector("p.value")).toBe(secondParagraph);
    expect(second.textContent).toBe("ready");
  });
});
