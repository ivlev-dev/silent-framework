import { afterEach, describe, expect, it } from "vitest";
import { container, DI_CREATE } from "@ivlev-dev/silent-di";
import { insert, templateHoles, type TemplateClone } from "../src/dom.js";
import { hydrate } from "../src/hydrate.js";
import { isHydrating, type HydrationMismatchError } from "../src/hydration.js";
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

function attachMeta(target: unknown, vm: unknown): void {
  (target as Record<PropertyKey, unknown>)[VIEW] = { vm, name: "Concurrent" };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function holeParent(template: TemplateClone, index: number): Node {
  return (template.holes[index]?.parentNode as Node | undefined) ?? template.node;
}

function makeView(getValue: (vm: { value: string }) => string) {
  return function View(this: { vm: { value: string } }): Node {
    const template = templateHoles('<p class="value"><!--silent-hole-0--></p>')();
    insert(holeParent(template, 0), () => getValue(this.vm), template.holes[0]!);
    return template.node;
  };
}

class QuickVM {
  value = "quick";
  static [DI_CREATE] = async (): Promise<QuickVM> => new QuickVM();
}
const QuickView = makeView((vm) => vm.value);
attachMeta(QuickView, QuickVM);

class ThirdVM {
  value = "third";
  static [DI_CREATE] = async (): Promise<ThirdVM> => new ThirdVM();
}
const ThirdView = makeView((vm) => vm.value);
attachMeta(ThirdView, ThirdVM);

const slowStarted = deferred();
const slowGate = deferred();

class SlowVM {
  value = "slow";
  static [DI_CREATE] = async (): Promise<SlowVM> => {
    slowStarted.resolve();
    await slowGate.promise;
    return new SlowVM();
  };
}
const SlowView = makeView((vm) => vm.value);
attachMeta(SlowView, SlowVM);

const VALID_MARKUP =
  '<!--silent-view--><p class="value">quick<!--silent-hole-0--></p><!--silent-view-end-->';
const THIRD_MARKUP =
  '<!--silent-view--><p class="value">third<!--silent-hole-0--></p><!--silent-view-end-->';
const STALE_MARKUP =
  '<!--silent-view--><span class="stale">old</span><!--silent-view-end-->';

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("очередь гидрации", () => {
  it("третий вызов во время второго не перезаписывает контекст", async () => {
    const firstHost = host(VALID_MARKUP);
    const slowHost = host(STALE_MARKUP);
    const thirdHost = host(THIRD_MARKUP);
    const thirdParagraph = thirdHost.querySelector("p.value");
    const slowMismatches: HydrationMismatchError[] = [];
    const thirdMismatches: HydrationMismatchError[] = [];

    const first = hydrate(firstHost, QuickView as unknown as AnyComponent, {
      container,
      onMismatch: () => undefined,
    });
    handles.push(await first);

    const slow = hydrate(slowHost, SlowView as unknown as AnyComponent, {
      container,
      onMismatch: (error) => slowMismatches.push(error),
    });
    // Гарантируем, что второй вызов уже вошёл в гидрацию и ждёт DI.
    await slowStarted.promise;

    const third = hydrate(thirdHost, ThirdView as unknown as AnyComponent, {
      container,
      onMismatch: (error) => thirdMismatches.push(error),
    });

    slowGate.resolve();
    const [slowHandle, thirdHandle] = await Promise.all([slow, third]);
    handles.push(slowHandle, thirdHandle);

    expect(slowMismatches.length).toBe(1);
    expect(thirdMismatches).toEqual([]);
    expect(slowHost.textContent).toBe("slow");
    expect(thirdHost.querySelector("p.value")).toBe(thirdParagraph);
    expect(thirdHost.textContent).toBe("third");
    expect(isHydrating()).toBe(false);
  });
});
