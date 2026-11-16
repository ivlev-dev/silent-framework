import { afterEach, describe, expect, it } from "vitest";
import {
  createRenderEffect,
  createSignal,
  flushSync,
  onCleanup,
} from "@ivlev-dev/silent-reactivity";
import { template } from "../src/dom.js";
import { setReady } from "../src/component-state.js";
import { hydrate } from "../src/hydrate.js";
import { HydrationMismatchError } from "../src/hydration.js";
import type { MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

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

describe("откат гидрации", () => {
  it("не оставляет живых эффектов и слушателей первой попытки", async () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    let disposed = 0;

    function View(): Node {
      createRenderEffect(() => {
        value();
        runs += 1;
      });
      onCleanup(() => {
        disposed += 1;
      });
      return template("<section>fresh</section>")();
    }

    const target = host('<div class="server">stale</div>');
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    expect(target.querySelector("section")?.textContent).toBe("fresh");
    expect(target.querySelector("div")).toBeNull();
    expect(runs).toBe(2);
    expect(disposed).toBe(1);

    setValue(1);
    flushSync();
    expect(runs).toBe(3);

    handle.dispose();
    handles.pop();
    expect(disposed).toBe(2);
  });

  it("освобождает эффекты первой попытки при позднем несовпадении", async () => {
    const [value, setValue] = createSignal(0);
    let runs = 0;
    let disposed = 0;
    let attempts = 0;

    function View(): Node {
      attempts += 1;
      const element = document.createElement("div");
      createRenderEffect(() => {
        value();
        runs += 1;
      });
      onCleanup(() => {
        disposed += 1;
      });
      if (attempts === 1) {
        setReady(element, Promise.reject(new HydrationMismatchError("late")));
      }
      return element;
    }

    const target = host("<span>server</span>");
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, View as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(attempts).toBe(2);
    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toBeInstanceOf(HydrationMismatchError);
    expect(target.querySelector("div")).not.toBeNull();
    expect(target.querySelector("span")).toBeNull();
    expect(runs).toBe(2);
    expect(disposed).toBe(1);

    setValue(1);
    flushSync();
    expect(runs).toBe(3);
  });
});
