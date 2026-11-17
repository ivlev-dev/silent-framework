import { describe, expect, it } from "vitest";
import {
  beginHydration,
  countClientNodes,
  endHydration,
  markClientNodes,
} from "../src/hydration-state";

describe("учёт клиентских узлов гидрации", () => {
  it("считает созданные узлы в текущем контексте", () => {
    const context = beginHydration();
    expect(countClientNodes()).toBe(0);

    markClientNodes();
    markClientNodes(2);
    expect(countClientNodes()).toBe(3);

    endHydration(context);
    expect(countClientNodes()).toBe(0);
  });

  it("начинает новый контекст с нуля", () => {
    const first = beginHydration();
    markClientNodes(4);
    endHydration(first);

    const second = beginHydration();
    expect(countClientNodes()).toBe(0);
    endHydration(second);
  });
});
