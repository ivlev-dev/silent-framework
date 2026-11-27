import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Контракт оформления для оверлеев, навигации и extras. jsdom не считает
 * layout, поэтому проверяем то, что действительно является контрактом:
 * слой, токены, touch-цели, safe-area, overflow-хуки и reduced-motion.
 */
const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, "..", "src", "components");

const scoped = [
  "dialog/dialog.css",
  "alert-dialog/alert-dialog.css",
  "sheet/sheet.css",
  "drawer/drawer.css",
  "popover/popover.css",
  "menu/menu.css",
  "tooltip/tooltip.css",
  "snackbar/snackbar.css",
  "tabs/tabs.css",
  "top-app-bar/top-app-bar.css",
  "navigation-bar/navigation-bar.css",
  "navigation-rail/navigation-rail.css",
  "breadcrumbs/breadcrumbs.css",
  "pagination/pagination.css",
  "fab/fab.css",
  "chip/chip.css",
  "segmented-button/segmented-button.css",
  "empty-state/empty-state.css",
  "tag/tag.css",
] as const;

function css(file: string): string {
  return readFileSync(join(components, file), "utf8");
}

describe("Контракт оформления", () => {
  it.each(scoped)("%s живёт в sui.components без hex и !important", (file) => {
    const source = css(file);
    expect(source).toContain("@layer sui.components {");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(source).not.toContain("!important");
  });

  it.each([
    "dialog/dialog.css",
    "alert-dialog/alert-dialog.css",
    "sheet/sheet.css",
    "drawer/drawer.css",
    "popover/popover.css",
    "menu/menu.css",
    "tooltip/tooltip.css",
    "snackbar/snackbar.css",
  ])("%s уважает reduced-motion", (file) => {
    expect(css(file)).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it.each([
    "dialog/dialog.css",
    "sheet/sheet.css",
    "drawer/drawer.css",
    "snackbar/snackbar.css",
  ])("%s держит close-кнопку 44px через токен", (file) => {
    expect(css(file)).toContain("var(--sui-touch-target)");
  });

  it.each([
    "dialog/dialog.css",
    "sheet/sheet.css",
    "drawer/drawer.css",
    "snackbar/snackbar.css",
  ])("%s учитывает safe-area", (file) => {
    expect(css(file)).toContain("env(safe-area-inset");
  });

  it("оверлеи ограничивают размер и не выпускают текст", () => {
    expect(css("dialog/dialog.css")).toContain("--sui-dialog-max-inline");
    expect(css("sheet/sheet.css")).toContain("--sui-sheet-inline");
    expect(css("popover/popover.css")).toContain("--sui-popover-max-inline");
    expect(css("popover/popover.css")).toContain("var(--sui-floating-inline-shift");
    expect(css("menu/menu.css")).toContain("data-side");
    expect(css("tooltip/tooltip.css")).toContain("overflow-wrap: anywhere");
    expect(css("tooltip/tooltip.css")).toContain("--sui-tooltip-max-inline");
  });

  it("навигация имеет overflow-хуки и компактный мобильный режим", () => {
    const tabs = css("tabs/tabs.css");
    expect(tabs).toContain('data-overflow="both"');
    expect(tabs).toContain("--sui-tabs-indicator");
    expect(tabs).toContain('data-size="sm"');

    const pagination = css("pagination/pagination.css");
    expect(pagination).toContain("[data-ellipsis]");
    expect(pagination).toContain(":dir(rtl)");

    const rail = css("navigation-rail/navigation-rail.css");
    expect(rail).toContain("clamp(");
    expect(rail).toContain("text-overflow: ellipsis");

    const breadcrumbs = css("breadcrumbs/breadcrumbs.css");
    expect(breadcrumbs).toContain("text-overflow: ellipsis");
    expect(breadcrumbs).toContain("flex-wrap: wrap");
  });

  it("extras не раздуваются длинными подписями и дают touch-цель удаления", () => {
    expect(css("fab/fab.css")).toContain("text-overflow: ellipsis");
    expect(css("fab/fab.css")).toContain("env(safe-area-inset");
    expect(css("chip/chip.css")).toContain("var(--sui-touch-target)");
    expect(css("tag/tag.css")).toContain("var(--sui-touch-target)");
    expect(css("segmented-button/segmented-button.css")).toContain(
      "overflow-x: auto",
    );
    expect(css("empty-state/empty-state.css")).toContain(
      "--sui-empty-state-max",
    );
  });

  it("4K ограничен мерой, а не растянут на всю ширину", () => {
    expect(css("top-app-bar/top-app-bar.css")).toContain(
      "--sui-top-app-bar-max",
    );
    expect(css("empty-state/empty-state.css")).toContain("max-inline-size");
  });

  it("кнопки не pill по умолчанию, оверлеи компактнее", () => {
    expect(css("button/button.css")).toContain(
      "--sui-button-radius: var(--sui-radius-md);",
    );
    expect(css("button/button.css")).not.toContain(
      "--sui-button-radius: var(--sui-radius-full);",
    );
    expect(css("icon-button/icon-button.css")).toContain(
      "--sui-icon-button-radius: var(--sui-radius-md);",
    );

    for (const file of [
      "dialog/dialog.css",
      "sheet/sheet.css",
      "alert-dialog/alert-dialog.css",
    ]) {
      expect(css(file), file).not.toContain("var(--sui-space-6) var(--sui-space-6)");
    }
  });

  it("swatch красит цвет поверх checkerboard", () => {
    const source = css("color-picker/color-picker.css");
    expect(source).toContain("--sui-color-picker-swatch");
    expect(source).toContain("linear-gradient(");
    expect(source).toContain("conic-gradient(");
    expect(source).toContain("var(--sui-color-picker-swatch, transparent)");
  });

  it("календарь держит диапазон круглым и контрастным", () => {
    const source = css("date-picker/date-picker.css");
    expect(source).not.toContain("border-radius: 0");
    expect(source).toContain(
      ".sui-date-picker__cell[data-in-range] .sui-date-picker__day",
    );
    expect(source).toContain("background-color: var(--sui-date-picker-range)");
    expect(source).toContain("color: var(--sui-date-picker-selected-text)");
    expect(source).toContain(
      ".sui-date-picker__cell[data-range-start] .sui-date-picker__day",
    );
  });
});
