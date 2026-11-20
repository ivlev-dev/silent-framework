// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { setFlagsFromString } from "node:v8";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { Show } from "../src/control-flow";
import { component } from "../src/component-lite";
import { mount } from "../src/mount";
import type { AnyComponent } from "../src/types";

interface Payload {
  readonly id: number;
}

function resolveGc(): (() => void) | null {
  try {
    setFlagsFromString("--expose-gc");
    const candidate: unknown = runInNewContext("gc");
    return typeof candidate === "function" ? (candidate as () => void) : null;
  } catch {
    return null;
  }
}

const gc = resolveGc();

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

function BranchA(props: { readonly payload: Payload }): HTMLElement {
  const span = document.createElement("span");
  span.textContent = `a${props.payload.id}`;
  return span;
}

function BranchB(): HTMLElement {
  const span = document.createElement("span");
  span.textContent = "b";
  return span;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("кэш light-компонентов", () => {
  it.skipIf(gc === null)("не удерживает освобождённые инстансы", async () => {
    const collect = gc as () => void;
    const refs: WeakRef<Payload>[] = [];
    const [branch, setBranch] = createSignal(0);

    function App(): HTMLElement {
      const root = document.createElement("div");
      root.appendChild(
        Show({
          when: () => branch() === 0,
          children: () => {
            const payload: Payload = { id: refs.length };
            refs.push(new WeakRef(payload));
            return component(BranchA as unknown as AnyComponent, { payload });
          },
          fallback: () => component(BranchB as unknown as AnyComponent, {}),
        }),
      );
      return root;
    }

    const target = host();
    const handle = await mount(target, App as unknown as AnyComponent);
    flushSync();

    // Первый рендер идёт в пробном owner-е эффекта, у которого своя кэш-запись;
    // дальше переключения идут через один устойчивый owner.
    refs.length = 0;
    for (let step = 1; step <= 6; step += 1) {
      setBranch(step % 2);
      flushSync();
    }
    expect(branch()).toBe(0);
    expect(refs.length).toBe(3);

    setBranch(1);
    flushSync();
    expect(target.textContent).toBe("b");

    // deref() удерживает цель до конца текущего job-а, поэтому проверяем
    // только после сборки и перехода в следующий job.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      collect();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const alive = refs
      .map((ref, index) => (ref.deref() === undefined ? -1 : index))
      .filter((index) => index >= 0);
    expect(alive).toEqual([]);
    handle.dispose();
  });

  it("переживает многократные переключения ветки", async () => {
    const [branch, setBranch] = createSignal(0);
    function App(): HTMLElement {
      const root = document.createElement("div");
      root.appendChild(
        Show({
          when: () => branch() === 0,
          children: () =>
            component(BranchA as unknown as AnyComponent, { payload: { id: 0 } }),
          fallback: () => component(BranchB as unknown as AnyComponent, {}),
        }),
      );
      return root;
    }

    const target = host();
    const handle = await mount(target, App as unknown as AnyComponent);
    flushSync();
    expect(target.textContent).toBe("a0");

    for (let step = 0; step < 12; step += 1) {
      const next = step % 2 === 0 ? 1 : 0;
      setBranch(next);
      flushSync();
      expect(target.textContent).toBe(next === 0 ? "a0" : "b");
    }

    handle.dispose();
    expect(target.textContent).toBe("");
  });
});
