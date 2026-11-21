// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { adoptPartsPlan } from "../src/dom-hydration";
import type { TemplatePlan } from "../src/dom";

function rootWithHole(): Node {
  const host = document.createElement("div");
  host.innerHTML = '<div class="x"><!--silent-hole-0--></div>';
  return host;
}

describe("adoptPartsPlan: мемо неудачной path-адоптации", () => {
  it("повторно не пробует path для того же плана", () => {
    let pathReads = 0;
    const hole = {
      counts: [1, 1] as readonly number[],
      key: "silent-hole-0",
    } as { path: readonly number[]; counts: readonly number[]; key: string };
    Object.defineProperty(hole, "path", {
      get(): readonly number[] {
        pathReads += 1;
        // Заведомо неверный путь: правильная дыра находится сканированием trie.
        return [0, 1];
      },
    });
    const plan: TemplatePlan = { roots: 1, holes: [hole], attrs: [], strips: [] };

    const first: { holes: Comment[]; attrs: Element[] } = { holes: [], attrs: [] };
    adoptPartsPlan(rootWithHole(), plan, first);
    expect(first.holes.length).toBe(1);
    expect(first.holes[0]?.data).toBe("silent-hole-0");
    // Здесь уже могли прочитать path при построении trie (кэш на плане).
    const afterFirst = pathReads;

    for (let index = 0; index < 9; index += 1) {
      const out: { holes: Comment[]; attrs: Element[] } = { holes: [], attrs: [] };
      adoptPartsPlan(rootWithHole(), plan, out);
      expect(out.holes.length).toBe(1);
      expect(out.holes[0]?.data).toBe("silent-hole-0");
    }

    expect(pathReads).toBe(afterFirst);
  });
});
