// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { handleFor } from "../src/mount-core";
import { RESOLVED_READY } from "../src/component-state";
import type { ComponentResult } from "../src/component-state";

describe("handleFor", () => {
  it("вызывает rootDispose, даже если dispose результата бросает", () => {
    let rootDisposed = 0;
    const result: ComponentResult = {
      node: document.createComment("result"),
      ready: RESOLVED_READY,
      settled: RESOLVED_READY,
      update: () => undefined,
      dispose: () => {
        throw new Error("boom");
      },
    };
    const handle = handleFor(result, () => {
      rootDisposed += 1;
    });

    expect(() => handle.dispose()).toThrowError("boom");
    expect(rootDisposed).toBe(1);
    expect(() => handle.dispose()).not.toThrow();
  });
});
