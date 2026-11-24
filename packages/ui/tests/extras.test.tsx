import { afterEach, describe, expect, it } from "vitest";
import {
  createComponent,
  createRoot,
  flushSync,
  hydrate,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { Accordion, type AccordionItemData } from "../src/components/accordion/index.js";
import { Chip, type ChipVariant } from "../src/components/chip/index.js";
import { EmptyState } from "../src/components/empty-state/index.js";
import { Fab, type FabVariant } from "../src/components/fab/index.js";
import { SearchField } from "../src/components/search-field/index.js";
import { SegmentedButton } from "../src/components/segmented-button/index.js";
import {
  Table,
  type TableColumn,
  type TableSortDirection,
} from "../src/components/table/index.js";
import { Tag, type TagVariant } from "../src/components/tag/index.js";
import { AddIcon } from "../src/icons/add.js";
import { InfoIcon } from "../src/icons/info.js";

interface Handle {
  readonly node: Node;
  update(props: Record<string, unknown>): void;
  dispose(): void;
}

const handles: Handle[] = [];

function mount(component: AnyComponent, props: Record<string, unknown> = {}): Handle {
  let result: ReturnType<typeof createComponent> | null = null;
  const disposeRoot = createRoot((dispose) => {
    result = createComponent(component, props);
    return dispose;
  });
  const created = result as unknown as ReturnType<typeof createComponent>;
  document.body.appendChild(created.node);
  flushSync();
  const handle: Handle = {
    get node() {
      return created.node;
    },
    update: (next) => {
      created.update(next);
    },
    dispose: () => {
      created.dispose();
      disposeRoot();
    },
  };
  handles.push(handle);
  return handle;
}

function rootOf(handle: Handle): Element {
  const node = handle.node;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  throw new Error(`ожидался элемент, получен nodeType=${node.nodeType}`);
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flushSync();
}

function keydown(element: Element, key: string): void {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

function typeInto(element: HTMLInputElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  flushSync();
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
});

describe("FloatingActionButton", () => {
  it.each(["primary", "secondary", "tertiary", "surface"] as const)(
    "вариант %s: data-variant, type=button и доступное имя",
    (variant: FabVariant) => {
      const fab = rootOf(
        mount(Fab, { variant, ariaLabel: "Создать", icon: <AddIcon /> }),
      );
      expect(fab.tagName).toBe("BUTTON");
      expect(fab.className).toBe("sui-fab");
      expect(fab.getAttribute("data-variant")).toBe(variant);
      expect(fab.getAttribute("data-size")).toBe("md");
      expect(fab.getAttribute("aria-label")).toBe("Создать");
      expect(fab.getAttribute("type")).toBe("button");
      expect(fab.querySelector(".sui-fab__label")).toBeNull();
    },
  );

  it("extended показывает подпись и оставляет иконку", () => {
    const fab = rootOf(
      mount(Fab, { extended: true, label: "Создать", icon: <AddIcon /> }),
    );
    expect(fab.hasAttribute("data-extended")).toBe(true);
    expect(fab.textContent).toContain("Создать");
    expect(fab.querySelector(".sui-fab__icon .sui-icon")).not.toBeNull();
  });

  it("position ставит data-position, не навязывая fixed-стиль", () => {
    const fab = rootOf(
      mount(Fab, { ariaLabel: "Наверх", position: "bottom-end", icon: <AddIcon /> }),
    );
    expect(fab.getAttribute("data-position")).toBe("bottom-end");
    expect(fab.getAttribute("style")).toBeNull();
  });

  it("disabled блокирует обработчик", () => {
    const calls: string[] = [];
    const fab = rootOf(
      mount(Fab, {
        ariaLabel: "Создать",
        disabled: true,
        icon: <AddIcon />,
        onClick: () => calls.push("click"),
      }),
    );
    expect((fab as HTMLButtonElement).disabled).toBe(true);
    click(fab);
    expect(calls).toEqual([]);
  });
});

describe("Chip", () => {
  it.each(["assist", "filter", "input", "suggestion"] as const)(
    "вариант %s и слоты leading/avatar",
    (variant: ChipVariant) => {
      const chip = rootOf(
        mount(Chip, {
          variant,
          selected: variant === "filter" ? true : undefined,
          leading: <InfoIcon />,
          children: "Метка",
        }),
      );
      expect(chip.getAttribute("data-variant")).toBe(variant);
      expect(chip.textContent).toContain("Метка");
      expect(chip.querySelector(".sui-chip__icon .sui-icon")).not.toBeNull();
      if (variant === "filter") {
        expect(chip.getAttribute("data-selected")).toBe("");
        expect(
          chip.querySelector(".sui-chip__action")?.getAttribute("aria-pressed"),
        ).toBe("true");
      }
    },
  );

  it("selected filter без leading показывает галочку", () => {
    const chip = rootOf(
      mount(Chip, { variant: "filter", selected: true, children: "Фильтр" }),
    );
    expect(chip.querySelector(".sui-chip__icon .sui-icon")).not.toBeNull();
  });

  it("cliс действия вызывает onClick, клик удаления — только onRemove", () => {
    const clicks: string[] = [];
    const removes: string[] = [];
    const chip = rootOf(
      mount(Chip, {
        variant: "input",
        removable: true,
        children: "Тег",
        onClick: () => clicks.push("click"),
        onRemove: () => removes.push("remove"),
      }),
    );
    const action = chip.querySelector(".sui-chip__action") as Element;
    const remove = chip.querySelector(".sui-chip__remove") as Element;
    expect(remove.getAttribute("aria-label")).toBe("Удалить");

    click(action);
    expect(clicks).toEqual(["click"]);
    click(remove);
    expect(removes).toEqual(["remove"]);
    expect(clicks).toEqual(["click"]);
  });

  it("disabled выключает кнопки и data-атрибут", () => {
    const removes: string[] = [];
    const chip = rootOf(
      mount(Chip, {
        removable: true,
        disabled: true,
        onClick: () => undefined,
        onRemove: () => removes.push("remove"),
        children: "Тег",
      }),
    );
    expect(chip.hasAttribute("data-disabled")).toBe(true);
    for (const button of chip.querySelectorAll("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
    click(chip.querySelector(".sui-chip__remove") as Element);
    expect(removes).toEqual([]);
  });
});

describe("SegmentedButton", () => {
  const options = [
    { key: "day", label: "День" },
    { key: "week", label: "Неделя" },
    { key: "month", label: "Месяц", disabled: true },
  ] as const;

  function items(root: Element): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(".sui-segmented-button__item"));
  }

  it("группа, aria-pressed и roving tabindex", () => {
    const root = rootOf(
      mount(SegmentedButton, { value: "day", options, label: "Период" }),
    );
    const buttons = items(root);
    expect(root.getAttribute("role")).toBe("group");
    expect(root.getAttribute("aria-label")).toBe("Период");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0]?.tabIndex).toBe(0);
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1]?.tabIndex).toBe(-1);
    expect(buttons[2]?.hasAttribute("disabled")).toBe(true);
  });

  it("клик сообщает значение, DOM меняется только при обновлении props", () => {
    const calls: string[] = [];
    const handle = mount(SegmentedButton, {
      value: "day",
      options,
      onValueChange: (value: string) => calls.push(value),
    });
    const root = rootOf(handle);
    click(items(root)[1] as Element);
    expect(calls).toEqual(["week"]);
    expect(items(root)[0]?.getAttribute("aria-pressed")).toBe("true");

    handle.update({ value: "week", options, onValueChange: (value: string) => calls.push(value) });
    flushSync();
    expect(items(root)[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(items(root)[1]?.tabIndex).toBe(0);
  });

  it("стрелки пропускают disabled и переносят фокус", () => {
    const calls: string[] = [];
    const root = rootOf(
      mount(SegmentedButton, {
        value: "week",
        options,
        onValueChange: (value: string) => calls.push(value),
      }),
    );
    const buttons = items(root);
    buttons[1]?.focus();

    keydown(buttons[1] as Element, "ArrowRight");
    expect(document.activeElement).toBe(buttons[0]);
    expect(calls).toEqual(["day"]);

    keydown(buttons[0] as Element, "End");
    expect(calls).toEqual(["day", "week"]);
    expect(document.activeElement).toBe(buttons[1]);

    keydown(buttons[1] as Element, "ArrowLeft");
    expect(document.activeElement).toBe(buttons[0]);
    expect(calls).toEqual(["day", "week", "day"]);
  });
});

describe("SearchField", () => {
  it("type=search, иконка, подпись и кнопка очистки", () => {
    const root = rootOf(mount(SearchField, { label: "Поиск", name: "q" }));
    const input = root.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).not.toBeNull();
    expect(input?.id).toBe("sui-q");
    expect(input?.getAttribute("aria-label")).toBeNull();
    expect(root.querySelector(".sui-search-field__icon .sui-icon")).not.toBeNull();
    expect(root.querySelector(".sui-search-field__clear")).toBeNull();
  });

  it("ввод сообщает значение и показывает кнопку «Очистить»", () => {
    const values: string[] = [];
    const changes: string[] = [];
    const root = rootOf(
      mount(SearchField, {
        label: "Поиск",
        onInput: (event: InputEvent) => {
          values.push((event.currentTarget as HTMLInputElement).value);
        },
        onValueChange: (value: string) => changes.push(value),
      }),
    );
    const input = root.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    typeInto(input, "таблетка");

    expect(values).toEqual(["таблетка"]);
    expect(changes).toEqual(["таблетка"]);
    expect(root.querySelector(".sui-search-field__clear")?.getAttribute("aria-label")).toBe(
      "Очистить",
    );
  });

  it("Enter отдаёт текущее значение в onSearch", () => {
    const searches: string[] = [];
    const root = rootOf(mount(SearchField, { label: "Поиск", onSearch: (value: string) => searches.push(value) }));
    const input = root.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    typeInto(input, "silent");
    keydown(input, "Enter");
    expect(searches).toEqual(["silent"]);
  });

  it("кнопка очистки стирает значение, зовёт onClear и возвращает фокус", () => {
    const cleared: string[] = [];
    const changes: string[] = [];
    const root = rootOf(
      mount(SearchField, {
        label: "Поиск",
        value: "запрос",
        onValueChange: (value: string) => changes.push(value),
        onClear: () => cleared.push("clear"),
      }),
    );
    const input = root.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    expect(input.value).toBe("запрос");

    click(root.querySelector(".sui-search-field__clear") as Element);
    expect(input.value).toBe("");
    expect(cleared).toEqual(["clear"]);
    expect(changes).toEqual([""]);
    expect(document.activeElement).toBe(input);
  });

  it("disabled/readOnly скрывают очистку", () => {
    for (const props of [{ disabled: true }, { readOnly: true }]) {
      const root = rootOf(mount(SearchField, { label: "Поиск", value: "текст", ...props }));
      expect(root.querySelector(".sui-search-field__clear")).toBeNull();
      const input = root.querySelector<HTMLInputElement>('input[type="search"]');
      expect(input?.disabled).toBe(props.disabled === true);
      expect(input?.readOnly).toBe(props.readOnly === true);
    }
  });

  it("controlируемое значение синхронизируется при обновлении props", () => {
    const handle = mount(SearchField, { label: "Поиск", value: "один" });
    const root = rootOf(handle);
    const input = root.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    expect(input.value).toBe("один");
    handle.update({ label: "Поиск", value: "два" });
    flushSync();
    expect(input.value).toBe("два");
  });
});

describe("EmptyState", () => {
  it("иконка декоративна, заголовок/описание/действия на месте", () => {
    const root = rootOf(
      mount(EmptyState, {
        icon: <InfoIcon />,
        title: "Ничего нет",
        description: "Создайте первый элемент",
        actions: <button data-testid="create">Создать</button>,
      }),
    );
    expect(root.querySelector(".sui-empty-state__icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector(".sui-empty-state__title")?.textContent).toBe("Ничего нет");
    expect(root.querySelector(".sui-empty-state__description")?.textContent).toContain(
      "Создайте",
    );
    expect(root.querySelector('[data-testid="create"]')).not.toBeNull();
  });

  it("compact и titleLevel меняют data-атрибут и уровень заголовка", () => {
    const root = rootOf(mount(EmptyState, { compact: true, titleLevel: 2, title: "Пусто" }));
    expect(root.hasAttribute("data-compact")).toBe(true);
    expect(root.querySelector(".sui-empty-state__title")?.tagName).toBe("H2");
  });

  it("illustration приоритетнее иконки", () => {
    const root = rootOf(
      mount(EmptyState, {
        icon: <InfoIcon />,
        illustration: <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Пустая папка" />,
        title: "Пусто",
      }),
    );
    expect(root.querySelector(".sui-empty-state__illustration img")).not.toBeNull();
    expect(root.querySelector(".sui-empty-state__icon")).toBeNull();
  });
});

interface Person {
  readonly id: number;
  readonly name: string;
  readonly age: number;
}

const people: readonly Person[] = [
  { id: 1, name: "Ада", age: 36 },
  { id: 2, name: "Боб", age: 41 },
];

const peopleColumns: readonly TableColumn<Person>[] = [
  { key: "name", header: "Имя", sortable: true },
  { key: "age", header: "Возраст", align: "end", width: 120, renderCell: (row) => `${row.age} лет` },
];

describe("Table", () => {
  it("семантическая разметка, scope и aria-sort", () => {
    const root = rootOf(
      mount(Table, {
        columns: peopleColumns,
        rows: people,
        rowKey: (row: Person) => row.id,
        sortKey: "name",
        sortDirection: "ascending",
        caption: "Люди",
      }),
    );
    expect(root.classList.contains("sui-table-scroll")).toBe(true);
    expect(root.firstElementChild?.matches("table.sui-table")).toBe(true);
    expect(root.querySelector("table")?.tagName).toBe("TABLE");
    expect(root.querySelector("caption")?.textContent).toBe("Люди");
    const headers = Array.from(root.querySelectorAll("th"));
    expect(headers).toHaveLength(2);
    expect(headers[0]?.getAttribute("scope")).toBe("col");
    expect(headers[0]?.getAttribute("aria-sort")).toBe("ascending");
    expect(headers[1]?.getAttribute("aria-sort")).toBeNull();
    expect((headers[1] as HTMLTableCellElement).style.width).toBe("120px");
    expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(root.textContent).toContain("36 лет");
  });

  it("клик по сортируемому заголовку просит следующее направление", () => {
    const calls: Array<[string, TableSortDirection]> = [];
    const handle = mount(Table, {
      columns: peopleColumns,
      rows: people,
      rowKey: (row: Person) => row.id,
      sortKey: "name",
      sortDirection: "ascending",
      onSort: (key: string, direction: TableSortDirection) => calls.push([key, direction]),
    });
    const root = rootOf(handle);
    click(root.querySelector(".sui-table__sort") as Element);
    expect(calls).toEqual([["name", "descending"]]);

    handle.update({
      columns: peopleColumns,
      rows: people,
      rowKey: (row: Person) => row.id,
      sortKey: "name",
      sortDirection: "descending",
      onSort: (key: string, direction: TableSortDirection) => calls.push([key, direction]),
    });
    flushSync();
    expect(root.querySelector("th")?.getAttribute("aria-sort")).toBe("descending");
    click(root.querySelector(".sui-table__sort") as Element);
    expect(calls[1]).toEqual(["name", "ascending"]);
  });

  it("пустая таблица показывает EmptyState на всю ширину", () => {
    const root = rootOf(
      mount(Table, {
        columns: peopleColumns,
        rows: [],
        rowKey: (row: Person) => row.id,
        caption: "Люди",
      }),
    );
    expect(root.querySelector(".sui-empty-state")?.textContent).toContain("Нет данных");
    expect(root.querySelector(".sui-table__empty-cell")?.getAttribute("colspan")).toBe("2");
  });

  it("обновление rows перерисовывает строки по rowKey", () => {
    const handle = mount(Table, {
      columns: peopleColumns,
      rows: people,
      rowKey: (row: Person) => row.id,
      caption: "Люди",
    });
    const root = rootOf(handle);
    expect(root.querySelectorAll("tbody tr")).toHaveLength(2);

    handle.update({
      columns: peopleColumns,
      rows: [people[0]],
      rowKey: (row: Person) => row.id,
      caption: "Люди",
    });
    flushSync();
    expect(root.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(root.textContent).toContain("Ада");
    expect(root.textContent).not.toContain("Боб");
  });

  it("dense/stickyHeader — data-атрибуты, label — доступное имя без caption", () => {
    const root = rootOf(
      mount(Table, {
        columns: peopleColumns,
        rows: people,
        rowKey: (row: Person) => row.id,
        dense: true,
        stickyHeader: true,
        label: "Сотрудники",
      }),
    );
    const table = root.querySelector("table") as Element;
    expect(table.hasAttribute("data-dense")).toBe(true);
    expect(table.hasAttribute("data-sticky-header")).toBe(true);
    expect(table.getAttribute("aria-label")).toBe("Сотрудники");
    expect(root.querySelector("caption")).toBeNull();
  });
});

const accordionItems: readonly AccordionItemData[] = [
  {
    key: "one",
    title: "Первый",
    content: () => <span data-panel="one">Контент 1</span>,
  },
  {
    key: "two",
    title: "Второй",
    content: () => <span data-panel="two">Контент 2</span>,
  },
  {
    key: "three",
    title: "Третий",
    content: () => <span data-panel="three">Контент 3</span>,
    disabled: true,
  },
];

describe("Accordion", () => {
  function triggers(root: Element): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(".sui-accordion__trigger"));
  }

  it("aria-expanded/controls и ленивый контент закрытых пунктов", () => {
    const root = rootOf(mount(Accordion, { items: accordionItems, defaultValue: "one" }));
    const buttons = triggers(root);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(buttons[1]?.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[2]?.hasAttribute("disabled")).toBe(true);

    const panelId = buttons[0]?.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(root.querySelector(`#${panelId as string}`)?.getAttribute("aria-labelledby")).toBe(
      buttons[0]?.id,
    );
    expect(root.querySelector('[data-panel="one"]')).not.toBeNull();
    expect(root.querySelector('[data-panel="two"]')).toBeNull();
  });

  it("single: клик закрывает старый и открывает новый пункт", () => {
    const calls: string[] = [];
    const root = rootOf(
      mount(Accordion, {
        items: accordionItems,
        onValueChange: (value: string | readonly string[]) => {
          calls.push(typeof value === "string" ? value : value.join(","));
        },
      }),
    );
    click(triggers(root)[1] as Element);
    expect(calls).toEqual(["two"]);
    expect(triggers(root)[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector('[data-panel="two"]')).not.toBeNull();
    expect(root.querySelector('[data-panel="one"]')).toBeNull();

    click(triggers(root)[1] as Element);
    expect(calls).toEqual(["two", ""]);
    expect(root.querySelector('[data-panel="two"]')).toBeNull();
  });

  it("multiple: открывает несколько пунктов и отдаёт массив", () => {
    const calls: Array<readonly string[]> = [];
    const root = rootOf(
      mount(Accordion, {
        items: accordionItems,
        selectionMode: "multiple",
        onValueChange: (value: string | readonly string[]) => {
          if (typeof value !== "string") calls.push(value);
        },
      }),
    );
    click(triggers(root)[0] as Element);
    click(triggers(root)[1] as Element);
    expect(calls).toEqual([["one"], ["one", "two"]]);
    expect(triggers(root)[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(triggers(root)[1]?.getAttribute("aria-expanded")).toBe("true");
  });

  it("controlled: клик только сообщает, DOM ждёт новых props", () => {
    const calls: string[] = [];
    const handle = mount(Accordion, {
      items: accordionItems,
      value: "one",
      onValueChange: (value: string | readonly string[]) => {
        calls.push(typeof value === "string" ? value : value.join(","));
      },
    });
    const root = rootOf(handle);
    click(triggers(root)[1] as Element);
    expect(calls).toEqual(["two"]);
    expect(triggers(root)[0]?.getAttribute("aria-expanded")).toBe("true");

    handle.update({
      items: accordionItems,
      value: "two",
      onValueChange: (value: string | readonly string[]) => {
        calls.push(typeof value === "string" ? value : value.join(","));
      },
    });
    flushSync();
    expect(triggers(root)[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(triggers(root)[0]?.getAttribute("aria-expanded")).toBe("false");
  });

  it("Arrow/Home/End ходят по заголовкам, пропуская disabled", () => {
    const root = rootOf(mount(Accordion, { items: accordionItems, defaultValue: "one" }));
    const buttons = triggers(root);
    buttons[0]?.focus();

    keydown(buttons[0] as Element, "ArrowDown");
    expect(document.activeElement).toBe(buttons[1]);

    keydown(buttons[1] as Element, "ArrowDown");
    expect(document.activeElement).toBe(buttons[0]);

    keydown(buttons[0] as Element, "End");
    expect(document.activeElement).toBe(buttons[1]);

    keydown(buttons[1] as Element, "Home");
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("disabled-пункт не переключается", () => {
    const calls: string[] = [];
    const root = rootOf(
      mount(Accordion, {
        items: accordionItems,
        onValueChange: (value: string | readonly string[]) => {
          calls.push(typeof value === "string" ? value : value.join(","));
        },
      }),
    );
    click(triggers(root)[2] as Element);
    expect(calls).toEqual([]);
  });
});

describe("Tag", () => {
  it.each(["neutral", "primary", "secondary", "success", "warning", "error", "info"] as const)(
    "вариант %s",
    (variant: TagVariant) => {
      const tag = rootOf(mount(Tag, { variant, children: "Метка" }));
      expect(tag.className).toBe("sui-tag");
      expect(tag.getAttribute("data-variant")).toBe(variant);
      expect(tag.textContent).toBe("Метка");
    },
  );

  it("size, leading и удаление с RU-подписью", () => {
    const removes: string[] = [];
    const tag = rootOf(
      mount(Tag, {
        size: "sm",
        leading: <InfoIcon />,
        removable: true,
        onRemove: () => removes.push("remove"),
        children: "Тег",
      }),
    );
    expect(tag.getAttribute("data-size")).toBe("sm");
    expect(tag.querySelector(".sui-tag__icon")?.getAttribute("aria-hidden")).toBe("true");
    const remove = tag.querySelector(".sui-tag__remove") as Element;
    expect(remove.getAttribute("aria-label")).toBe("Удалить");
    click(remove);
    expect(removes).toEqual(["remove"]);
  });
});

function SearchDemo(): Node {
  return (
    <SearchField label="Поиск" name="query" value="silent" hint="По документации" />
  );
}

function TableDemo(): Node {
  return (
    <Table
      columns={peopleColumns}
      rows={people}
      rowKey={(row) => row.id}
      sortKey="name"
      sortDirection="ascending"
      caption="Люди"
    />
  );
}

function AccordionDemo(): Node {
  return (
    <Accordion
      items={accordionItems}
      defaultValue="one"
      id="demo-accordion"
      headingLevel={2}
    />
  );
}

describe("SSR и гидрация extras", () => {
  it("SearchField: SSR отдаёт type=search, value и подпись очистки", async () => {
    const { html } = await renderToString(SearchDemo);
    expect(html).toContain('type="search"');
    expect(html).toContain('value="silent"');
    expect(html).toContain('aria-label="Очистить"');
    expect(html).toContain('id="sui-query-hint"');
    expect(html).not.toContain("jsx(");
  });

  it("SearchField гидрируется без mismatch", async () => {
    const { html } = await renderToString(SearchDemo);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, SearchDemo, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    flushSync();
    handles.push({
      get node() {
        return container;
      },
      update: () => undefined,
      dispose: () => handle.dispose(),
    });

    expect(mismatches).toEqual([]);
    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input?.value).toBe("silent");
    expect(container.querySelector(".sui-search-field__clear")).not.toBeNull();
  });

  it("Table: SSR содержит семантическую разметку и aria-sort", async () => {
    const { html } = await renderToString(TableDemo);
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain('scope="col"');
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("36 лет");
    expect(html).not.toContain("jsx(");
  });

  it("Table гидрируется без mismatch и сохраняет строки", async () => {
    const { html } = await renderToString(TableDemo);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, TableDemo, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    flushSync();
    handles.push({
      get node() {
        return container;
      },
      update: () => undefined,
      dispose: () => handle.dispose(),
    });

    expect(mismatches).toEqual([]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.querySelector("th")?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("Accordion: SSR не рендерит контент закрытых пунктов", async () => {
    const { html } = await renderToString(AccordionDemo);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Контент 1");
    expect(html).not.toContain("Контент 2");
    expect(html).not.toContain("Контент 3");
    expect(html).toContain("<h2");
    expect(html).not.toContain("jsx(");
  });

  it("Accordion гидрируется без mismatch и раскрывает пункт по клику", async () => {
    const { html } = await renderToString(AccordionDemo);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, AccordionDemo, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    flushSync();
    handles.push({
      get node() {
        return container;
      },
      update: () => undefined,
      dispose: () => handle.dispose(),
    });

    expect(mismatches).toEqual([]);
    expect(container.querySelector('[data-panel="one"]')).not.toBeNull();
    const second = container.querySelectorAll(".sui-accordion__trigger")[1] as HTMLElement;
    click(second);
    expect(container.querySelector('[data-panel="two"]')).not.toBeNull();
    expect(container.querySelector('[data-panel="one"]')).toBeNull();
  });
});
