import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:async_hooks", () => ({
  get AsyncLocalStorage(): never {
    throw new Error("AsyncLocalStorage недоступен в этом окружении");
  },
}));

import {
  createResource,
  getRuntimeOptions,
  getServerStreamCollector,
  isServerMode,
  text,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { getRuntimeContextStore } from "@ivlev-dev/silent-core/runtime-context-provider";
import {
  ensureRuntimeContext,
  getRuntimeContextStatus,
  resetRuntimeContextForTests,
} from "../src/runtime-context.js";
import { renderToString } from "../src/render.js";

afterEach(() => {
  resetRuntimeContextForTests();
  vi.restoreAllMocks();
});

function asyncApp(label: string, seen: string[]): AnyComponent {
  return function App(): Node {
    const resource = createResource(async () => {
      await Promise.resolve();
      seen.push(label);
      return label;
    });
    const element = document.createElement("div");
    const labelNode = document.createTextNode("");
    element.appendChild(labelNode);
    text(labelNode, () => resource.data() ?? "loading");
    return element;
  } as unknown as AnyComponent;
}

describe("SSR context: fallback без AsyncLocalStorage", () => {
  it("рендерит через последовательный fallback и предупреждает один раз", async () => {
    resetRuntimeContextForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const seen: string[] = [];
    const first = await renderToString(asyncApp("fallback-first", seen));
    expect(first.html).toBe("<div>fallback-first</div>");
    expect(getRuntimeContextStatus()).toBe("fallback");
    expect(getRuntimeContextStore()).toBeNull();

    const warnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes("AsyncLocalStorage"),
    );
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("fallback");

    const second = await renderToString(asyncApp("fallback-second", seen));
    expect(second.html).toBe("<div>fallback-second</div>");
    expect(getRuntimeContextStatus()).toBe("fallback");
    expect(
      warn.mock.calls.filter((call) => String(call[0]).includes("AsyncLocalStorage")),
    ).toHaveLength(1);

    expect(seen).toEqual(["fallback-first", "fallback-second"]);
    expect(getRuntimeOptions()).toEqual({});
    expect(isServerMode()).toBe(false);
    expect(getServerStreamCollector()).toBeNull();
  });

  it("повторная инициализация после reset снова уходит в fallback", async () => {
    resetRuntimeContextForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = await ensureRuntimeContext();
    expect(first).toBeUndefined();
    expect(getRuntimeContextStatus()).toBe("fallback");

    resetRuntimeContextForTests();
    expect(getRuntimeContextStatus()).toBe("fallback");
    expect(getRuntimeContextStore()).toBeNull();

    const { html } = await renderToString(asyncApp("after-reset", []));
    expect(html).toBe("<div>after-reset</div>");
    expect(getRuntimeContextStatus()).toBe("fallback");
  });
});
