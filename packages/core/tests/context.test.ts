// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createEffect,
  createRoot,
  flushSync,
  getOwner,
  onCleanup,
  runWithOwner,
} from "@ivlev-dev/silent-reactivity";
import {
  Context,
  ContextMissingError,
  Provider,
  createContext,
} from "../src/context.js";
import { component } from "../src/component-lite.js";
import { mount } from "../src/mount.js";
import { lazy } from "../src/suspense.js";
import type { AnyComponent } from "../src/types.js";

const hosts: HTMLElement[] = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

afterEach(() => {
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
});

describe("Context", () => {
  it("возвращает значение по умолчанию и сообщает об отсутствии провайдера", () => {
    const theme = createContext({ defaultValue: "light" });
    expect(theme.get()).toBe("light");
    expect(theme.tryGet()).toBe("light");
    expect(theme.has()).toBe(true);

    const session = new Context<string>({ name: "Session" });
    expect(session.has()).toBe(false);
    expect(session.tryGet()).toBeUndefined();
    expect(() => session.get()).toThrow(ContextMissingError);
    expect(() => session.get()).toThrow(/Session/);
    expect(() => session.bind()).toThrow(ContextMissingError);
  });

  it("вкладывает провайдеры и восстанавливает внешнее значение", () => {
    const theme = new Context<string>({ name: "Theme" });
    const captured: string[] = [];

    const result = theme.provide("outer", () => {
      captured.push(theme.get());
      const inner = theme.provide("inner", () => theme.get());
      captured.push(inner);
      captured.push(theme.get());
      return "done";
    });

    expect(result).toBe("done");
    expect(captured).toEqual(["outer", "inner", "outer"]);
    expect(theme.tryGet()).toBeUndefined();
  });

  it("резолвит вложенные Provider в дереве компонентов", async () => {
    const theme = new Context({ defaultValue: "default", name: "Theme" });

    function Leaf(): Node {
      return document.createTextNode(theme.get());
    }

    function view(): Node {
      return Provider({
        context: theme,
        value: "outer",
        children: () =>
          Provider({
            context: theme,
            value: "inner",
            children: () => Leaf(),
          }),
      });
    }

    const target = host();
    const handle = await mount(target, view);
    expect(target.textContent).toBe("inner");
    handle.dispose();
  });

  it("сохраняет контекст в эффектах после выхода из scope", () => {
    const theme = new Context<string>({ name: "Theme" });
    const seen: string[] = [];

    const root = createRoot((dispose) => {
      theme.provide("dark", () => {
        createEffect(() => {
          seen.push(theme.get());
        });
      });
      return () => dispose();
    });

    flushSync();
    expect(seen).toEqual(["dark"]);
    root();
  });

  it("передаёт контекст вложенному компоненту через component()", async () => {
    const theme = new Context<string>({ name: "Theme" });
    const effectSeen: string[] = [];

    function Child(): Node {
      createEffect(() => {
        effectSeen.push(theme.get());
      });
      return document.createTextNode(theme.get());
    }

    const target = host();
    const handle = await mount(target, () =>
      theme.provide("dark", () => component(Child as unknown as AnyComponent, {})),
    );
    flushSync();
    expect(target.textContent).toBe("dark");
    expect(effectSeen).toEqual(["dark"]);
    handle.dispose();
  });

  it("сохраняет контекст после await через bind и owner", async () => {
    const theme = new Context<string>({ name: "Theme" });
    const observed: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    function AsyncChild(): Node {
      const bound = theme.bind();
      const owner = getOwner();
      void (async () => {
        await gate;
        observed.push(bound.get());
        runWithOwner(owner, () => {
          observed.push(theme.get());
        });
      })();
      return document.createTextNode("");
    }

    const target = host();
    const handle = await mount(target, () =>
      theme.provide("dark", () => AsyncChild()),
    );

    release();
    await gate;
    await Promise.resolve();

    expect(observed).toEqual(["dark", "dark"]);
    handle.dispose();
  });

  it("передаёт контекст в ленивый асинхронный компонент", async () => {
    const theme = new Context<string>({ name: "Theme" });
    let loadedRead: string | null = null;

    const Child = lazy(async () => {
      await Promise.resolve();
      return function Loaded(): Node {
        loadedRead = theme.get();
        return document.createTextNode(theme.get());
      };
    });

    const target = host();
    const handle = await mount(target, () =>
      theme.provide("dark", () => component(Child as unknown as AnyComponent, {})),
    );
    await handle.settled;

    expect(loadedRead).toBe("dark");
    expect(target.textContent).toBe("dark");
    handle.dispose();
  });

  it("освобождает scope контекста вместе с владельцем", () => {
    const theme = new Context<string>({ name: "Theme" });
    let cleaned = 0;

    const dispose = createRoot((disposeRoot) => {
      theme.provide("dark", () => {
        onCleanup(() => {
          cleaned += 1;
        });
      });
      return disposeRoot;
    });

    expect(cleaned).toBe(0);
    dispose();
    expect(cleaned).toBe(1);
  });

  it("не протекает между соседними провайдерами", () => {
    const theme = new Context<string>({ name: "Theme" });
    const first = theme.provide("one", () => theme.get());
    const second = theme.provide("two", () => theme.get());
    expect([first, second]).toEqual(["one", "two"]);
    expect(theme.tryGet()).toBeUndefined();
  });
});
