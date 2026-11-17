import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "@ivlev-dev/silent-reactivity";
import { For, Show } from "../src/control-flow";
import { mount, type MountHandle } from "../src/mount";
import { lazy, Suspense } from "../src/suspense";
import { setErrorHandler } from "../src/component";
import { whenIdle } from "../src/component-state";
import type { AnyComponent } from "../src/types";

const hosts: HTMLElement[] = [];
const handles: MountHandle[] = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await whenIdle();
  await Promise.resolve();
  await Promise.resolve();
}

function spinner(): Node {
  return document.createTextNode("loading");
}

function page(text: string): () => Node {
  return (): Node => {
    const section = document.createElement("section");
    section.textContent = text;
    return section;
  };
}

afterEach(() => {
  while (handles.length > 0) {
    handles.pop()?.dispose();
  }
  while (hosts.length > 0) {
    hosts.pop()?.remove();
  }
  document.body.replaceChildren();
  setErrorHandler(null);
});

describe("открытые баги 0.7.5: Suspense/lazy/Show", () => {
  it("убирает содержимое lazy внутри Show после выключения", async () => {
    const gate = deferred();
    const [open, setOpen] = createSignal(true);
    const LazyPage = lazy(() => gate.promise.then(() => page("lazy")));

    const target = host();
    handles.push(await mount(target, (() =>
      Show({
        when: open,
        children: () =>
          Suspense({
            fallback: () => spinner(),
            children: () => LazyPage({}),
          }),
      })) as unknown as AnyComponent));

    gate.resolve();
    await flush();
    expect(target.textContent).toContain("lazy");

    setOpen(false);
    await flush();
    expect(target.textContent).not.toContain("lazy");
  });

  it("показывает fallback при повторном lazy-переходе в общем Suspense", async () => {
    const first = deferred();
    const second = deferred();
    const LazyA = lazy(() => first.promise.then(() => page("page-a")));
    const LazyB = lazy(() => second.promise.then(() => page("page-b")));
    const [route, setRoute] = createSignal<"a" | "b">("a");

    const target = host();
    handles.push(await mount(target, (() =>
      Suspense({
        fallback: () => spinner(),
        children: () =>
          Show({
            when: () => route() === "a",
            fallback: () => LazyB({}),
            children: () => LazyA({}),
          }),
      })) as unknown as AnyComponent));

    first.resolve();
    await flush();
    expect(target.textContent).toContain("page-a");

    setRoute("b");
    await flush();
    expect(target.textContent).toContain("loading");

    second.resolve();
    await flush();
    expect(target.textContent).toContain("page-b");
  });

  it("переживает опустошение For внутри Show и возврат данных", async () => {
    const [rows, setRows] = createSignal<string[]>(["first", "second"]);

    const target = host();
    handles.push(await mount(target, (() =>
      Show({
        when: () => rows().length > 0,
        fallback: () => {
          const empty = document.createElement("p");
          empty.textContent = "empty";
          return empty;
        },
        children: () => {
          const table = document.createElement("table");
          const body = document.createElement("tbody");
          table.appendChild(body);
          body.appendChild(
            For({
              each: rows,
              children: (row: string) => {
                const tr = document.createElement("tr");
                const td = document.createElement("td");
                td.textContent = row;
                tr.appendChild(td);
                return tr;
              },
            }) as unknown as Node,
          );
          return table;
        },
      })) as unknown as AnyComponent));

    expect(target.querySelectorAll("td").length).toBe(2);

    setRows([]);
    await flush();
    expect(target.textContent).toContain("empty");

    setRows(["third"]);
    await flush();
    expect(target.querySelector("td")?.textContent).toBe("third");
  });

  it("не логирует ошибку при первом рендере lazy-страницы", async () => {
    const errors: unknown[] = [];
    setErrorHandler((error) => {
      errors.push(error);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const gate = deferred();
      const LazyPage = lazy(() => gate.promise.then(() => page("late")));
      const target = host();
      handles.push(await mount(target, (() =>
        Suspense({
          fallback: () => spinner(),
          children: () => LazyPage({}),
        })) as unknown as AnyComponent));

      gate.resolve();
      await flush();

      expect(target.textContent).toContain("late");
      expect(errors).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("повторяет загрузку lazy после ошибки", async () => {
    let attempts = 0;
    const LazyPage = lazy(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("boom");
      }
      return page("recovered");
    });
    const [open, setOpen] = createSignal(true);

    const target = host();
    handles.push(await mount(target, (() =>
      Show({
        when: open,
        children: () => LazyPage({}),
      })) as unknown as AnyComponent));

    await flush();
    expect(attempts).toBe(1);
    expect(target.textContent).toContain("Error: boom");

    setOpen(false);
    await flush();
    setOpen(true);
    await flush();

    expect(attempts).toBe(2);
    expect(target.textContent).toContain("recovered");
    expect(target.textContent).not.toContain("Error: boom");
  });
});
