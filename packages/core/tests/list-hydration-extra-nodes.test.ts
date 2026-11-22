// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { listHydration } from "../src/list-hydration.js";
import {
  HydrationMismatchError,
  LIST_END,
  type HydrationWindow,
} from "../src/hydration-state.js";
import type { ListItemHandle } from "../src/list-hydration-state.js";

function setup(markup: string): { outer: HydrationWindow; parent: HTMLElement } {
  const parent = document.createElement("div");
  parent.innerHTML = markup;
  const start = document.createComment("start");
  parent.insertBefore(start, parent.firstChild);
  const boundary = document.createComment("end");
  parent.appendChild(boundary);
  return {
    outer: { start, end: boundary, cursor: start.nextSibling },
    parent,
  };
}

function makeState(): ListItemHandle {
  return {
    anchor: document.createComment("silent-item"),
    index: () => 0,
    cleanup: () => {},
  };
}

describe("For: остаток серверного списка", () => {
  it("сообщает mismatch, если пустой список окружён лишними узлами", () => {
    const { outer } = setup(`<span>stale</span><!--${LIST_END}-->`);

    expect(() =>
      listHydration.preseed(
        { each: [], children: (() => null) as never },
        () => null,
        false,
        outer,
        null,
        () => makeState(),
      ),
    ).toThrow(HydrationMismatchError);
  });

  it("не падает на пустом корректном списке", () => {
    const { outer } = setup(`<!--${LIST_END}-->`);

    const result = listHydration.preseed(
      { each: [], children: (() => null) as never },
      () => null,
      false,
      outer,
      null,
      () => makeState(),
    );
    expect(result.states).toEqual([]);
  });
});
