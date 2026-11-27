import { afterEach, describe, expect, it } from "vitest";
import meta, {
  BulkOverlay,
  LockedColumn,
  PaginationActive,
  StickyFooter,
} from "../src/data-table.stories.js";
import { disposeStory, mountStory } from "../src/silent-story.js";

function canvas(): Element {
  const element = document.createElement("section");
  document.body.appendChild(element);
  return element;
}

function mount(story: unknown, overrides: Record<string, unknown> = {}): Element {
  const element = canvas();
  const record = story as { render?: unknown; args?: Record<string, unknown> };
  mountStory(
    record.render,
    { ...(meta.args as Record<string, unknown>), ...(record.args ?? {}), ...overrides },
    element,
  );
  return element;
}

function click(element: Element | null | undefined): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

afterEach(() => {
  disposeStory();
  document.body.replaceChildren();
});

describe("DataTable stories", () => {
  it("PaginationActive помечает текущую страницу и держит подвал", () => {
    const element = mount(PaginationActive, {
      tableKey: "storybook-test-pagination",
      page: 2,
      pageSize: 5,
    });
    const current = element.querySelector(".sui-pagination__page[aria-current='page']");
    expect(current?.textContent).toBe("2");
    expect(current?.hasAttribute("data-current")).toBe(true);
    expect(element.querySelector(".sui-pagination")).not.toBeNull();
    expect(
      element.querySelector(".sui-data-table__footer .sui-data-table__pagination-controls"),
    ).not.toBeNull();
  });

  it("StickyFooter закрепляет подвал", () => {
    const element = mount(StickyFooter, {
      tableKey: "storybook-test-sticky",
      stickyFooter: true,
    });
    const footer = element.querySelector(".sui-data-table__footer");
    expect(footer?.hasAttribute("data-sticky")).toBe(true);
  });

  it("BulkOverlay кладёт панель выбора в подвал над пагинацией", () => {
    const element = mount(BulkOverlay, {
      tableKey: "storybook-test-bulk",
      selectionEnabled: true,
      stickyFooter: true,
      pageSize: 10,
    });
    const bar = element.querySelector(".sui-data-table__selection-bar");
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("data-position")).toBe("bottom");
    expect(bar?.nextElementSibling?.classList.contains("sui-data-table__footer-main")).toBe(true);
    expect(element.querySelector(".sui-data-table__footer")?.hasAttribute("data-sticky")).toBe(true);
    expect(element.querySelector(".sui-data-table__selection-count")?.textContent).toContain("3");
  });

  it("LockedColumn запрещает drag и показывает lock в настройках", () => {
    const element = mount(LockedColumn, {
      tableKey: "storybook-test-locked",
      pageSize: 5,
    });
    const locked = element.querySelector("th[data-column-key='name']");
    const free = element.querySelector("th[data-column-key='role']");
    expect(locked?.hasAttribute("data-reorderable")).toBe(false);
    expect(free?.hasAttribute("data-reorderable")).toBe(true);
    expect(element.querySelector(".sui-data-table__drag-grip")).toBeNull();

    click(element.querySelector("button[aria-label='Настройки таблицы']"));
    const row = element.querySelector(
      ".sui-data-table__settings-row[data-column-key='name']",
    );
    expect(row?.hasAttribute("data-locked")).toBe(true);
    expect(row?.querySelector(".sui-data-table__settings-lock")).not.toBeNull();
    expect(row?.querySelector("input[type='checkbox']")).toBeNull();
    expect(
      element.querySelector(
        ".sui-data-table__settings-row[data-column-key='role']",
      )?.textContent,
    ).toContain("Должность");
  });
});
