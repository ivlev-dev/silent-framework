// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToString } from "@ivlev-dev/silent-server";
import { Dialog } from "../src/components/dialog/index.js";
import { Sheet } from "../src/components/sheet/index.js";
import { Popover } from "../src/components/popover/index.js";
import { Menu } from "../src/components/menu/index.js";
import { Tooltip } from "../src/components/tooltip/index.js";
import { Snackbar } from "../src/components/snackbar/index.js";

/**
 * Оверлеи не трогают DOM на сервере: renderToString работает в чистом Node
 * (без jsdom), модальные компоненты рендерятся inline, поповеры закрыты.
 */
describe("SSR без DOM", () => {
  it("Dialog и Sheet рендерятся inline открытыми", async () => {
    const dialog = await renderToString(Dialog, {
      props: { defaultOpen: true, title: "Сервер", children: "Контент" },
    });
    expect(dialog.html).toContain("<dialog");
    expect(dialog.html).toContain("open");
    expect(dialog.html).toContain("Сервер");

    const sheet = await renderToString(Sheet, {
      props: { defaultOpen: true, side: "left", title: "Лист", children: "x" },
    });
    expect(sheet.html).toContain("sui-sheet");
    expect(sheet.html).toContain('data-side="left"');
    expect(sheet.html).toContain("data-open");
  });

  it("Popover, Menu и Tooltip закрыты на сервере", async () => {
    const popover = await renderToString(Popover, {
      props: { defaultOpen: true, trigger: "Триггер", children: "Панель" },
    });
    expect(popover.html).toContain('aria-expanded="false"');
    expect(popover.html).toContain("sui-popover__panel");
    expect(popover.html).toContain("hidden");

    const menu = await renderToString(Menu, {
      props: { defaultOpen: true, trigger: "Меню", children: "Пункт" },
    });
    expect(menu.html).toContain('aria-expanded="false"');
    expect(menu.html).toContain('role="menu"');
    expect(menu.html).toContain("hidden");

    const tooltip = await renderToString(Tooltip, {
      props: { content: "Подсказка", children: "Кнопка" },
    });
    expect(tooltip.html).toContain('role="tooltip"');
    expect(tooltip.html).toContain("hidden");
    expect(tooltip.html).not.toContain("aria-describedby");
  });

  it("Snackbar рендерит роль status и RU-кнопку", async () => {
    const { html } = await renderToString(Snackbar, {
      props: { open: true, message: "Готово" },
    });
    expect(html).toContain('role="status"');
    expect(html).toContain("Готово");
    expect(html).toContain("Закрыть");
  });
});
