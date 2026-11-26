import { describe, expect, it } from "vitest";
import {
  computeToolbarLayout,
  splitToolbarItems,
} from "../src/components/rich-text-editor/internal/toolbar-layout.js";
import type { ToolbarItem } from "../src/components/rich-text-editor/index.js";

const BASE = {
  buttonWidth: 28,
  separatorWidth: 1,
  moreWidth: 28,
  gap: 2,
} as const;

describe("RichTextEditor: раскладка тулбара", () => {
  it("широкий тулбар показывает все команды и разделители", () => {
    const items: readonly ToolbarItem[] = ["bold", "italic", "|", "h1"];
    const layout = computeToolbarLayout({
      items,
      availableWidth: 200,
      widths: {},
      ...BASE,
    });
    expect(layout.visible).toEqual(items);
    expect(layout.overflow).toEqual([]);
  });

  it("узкий тулбар оставляет приоритетные команды, остальное — в overflow", () => {
    const items: readonly ToolbarItem[] = ["bold", "italic", "|", "h1"];
    const layout = computeToolbarLayout({
      items,
      availableWidth: 60,
      widths: {},
      ...BASE,
    });
    expect(layout.visible).toEqual(["bold"]);
    expect(layout.overflow).toEqual(["italic", "h1"]);
  });

  it("приоритеты и разделители работают вместе", () => {
    const items: readonly ToolbarItem[] = [
      "bold",
      "|",
      "h1",
      "|",
      "undo",
    ];
    const layout = computeToolbarLayout({
      items,
      availableWidth: 67,
      widths: { bold: 20, h1: 20, undo: 20 },
      priority: ["h1", "undo"],
      buttonWidth: 20,
      separatorWidth: 1,
      moreWidth: 20,
      gap: 2,
    });
    expect(layout.visible).toEqual(["h1", "|", "undo"]);
    expect(layout.overflow).toEqual(["bold"]);
  });

  it("позиционная форма splitToolbarItems поддерживается", () => {
    const items: readonly ToolbarItem[] = ["bold", "italic"];
    const layout = splitToolbarItems(items, 0, {}, BASE);
    expect(layout.visible).toEqual([]);
    expect(layout.overflow).toEqual(["bold", "italic"]);
  });
});
