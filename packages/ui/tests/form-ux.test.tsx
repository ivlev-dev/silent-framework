import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { flushSync } from "@ivlev-dev/silent-core";
import { Field, Form } from "@ivlev-dev/silent-form";
import {
  Checkbox,
  FieldArray,
  FieldGroup,
  FormActions,
  Field as UiField,
  RadioGroup,
  Select,
  Switch,
  TextField,
} from "../src/form/index.js";
import { Accordion, type AccordionItemData } from "../src/components/accordion/index.js";
import { SearchField } from "../src/components/search-field/index.js";
import { Table, type TableColumn } from "../src/components/table/index.js";
import {
  fakeField,
  mount,
  query,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

const handles: TestHandles = { items: [] };
const forms: Form[] = [];

afterEach(() => {
  for (const handle of handles.items.splice(0)) handle.dispose();
  for (const form of forms.splice(0)) form.dispose();
  document.body.replaceChildren();
});

const here = dirname(fileURLToPath(import.meta.url));
function read(relative: string): string {
  return readFileSync(join(here, "..", "src", relative), "utf8");
}

describe("Field: стабильная область сообщений", () => {
  it("hint/error лежат в общем слоте, статусы — в data-атрибутах", () => {
    const root = rootOf(
      mount(handles, UiField, {
        id: "email",
        label: "Email",
        hint: "Рабочая почта",
        error: "Некорректный адрес",
        validating: true,
        children: "контрол",
      }),
    );
    const messages = query(root, ".sui-field__messages");
    expect(messages.querySelector(".sui-field__hint")?.textContent).toBe("Рабочая почта");
    expect(messages.querySelector(".sui-field__error")?.textContent).toBe("Некорректный адрес");
    expect(root.hasAttribute("data-has-hint")).toBe(true);
    expect(root.hasAttribute("data-has-error")).toBe(true);
    expect(root.hasAttribute("data-validating")).toBe(true);
  });

  it("Field без подсказки не резервирует строку", () => {
    const root = rootOf(mount(handles, UiField, { id: "x", error: "Ошибка", children: "c" }));
    expect(root.hasAttribute("data-has-hint")).toBe(false);
    expect(root.hasAttribute("data-has-error")).toBe(true);
  });

  it("валидация прокидывается от field к Field", () => {
    const fake = fakeField("x", { validating: true });
    const root = rootOf(mount(handles, TextField, { field: fake.field }));
    expect(root.classList.contains("sui-field")).toBe(true);
    expect(root.hasAttribute("data-validating")).toBe(true);
    expect(root.querySelector(".sui-text-field")?.hasAttribute("data-validating")).toBe(true);
  });
});

describe("Сетка формы и подвал", () => {
  it("FieldGroup: columns/maxWidth — data-атрибуты", () => {
    const root = rootOf(
      mount(handles, FieldGroup, {
        legend: "Контакты",
        columns: 2,
        maxWidth: "narrow",
        children: "поля",
      }),
    );
    expect(root.getAttribute("data-columns")).toBe("2");
    expect(root.getAttribute("data-max-width")).toBe("narrow");
    expect(query(root, ".sui-field-group__body").classList.contains("sui-field-group__body")).toBe(true);
  });

  it("FieldGroup без columns сохраняет прежний контракт", () => {
    const root = rootOf(mount(handles, FieldGroup, { layout: "inline", children: "поля" }));
    expect(root.hasAttribute("data-columns")).toBe(false);
    expect(root.getAttribute("data-layout")).toBe("inline");
    expect(root.hasAttribute("data-max-width")).toBe(false);
  });

  it("FormActions поддерживает sticky", () => {
    const root = rootOf(mount(handles, FormActions, { sticky: true }));
    expect(root.hasAttribute("data-sticky")).toBe(true);
    expect(root.getAttribute("role")).toBe("group");
  });
});

describe("Контролы: размеры и адаптив", () => {
  it("Switch: size -> data-size", () => {
    const root = rootOf(mount(handles, Switch, { size: "sm", label: "Уведомления" }));
    expect(root.getAttribute("data-size")).toBe("sm");
    expect(root.textContent).toContain("Уведомления");
  });

  it("TextField: размеры и readOnly помечены", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const root = rootOf(
        mount(handles, TextField, { size, readOnly: true, label: "Поле" }),
      );
      const wrapper = query(root, ".sui-text-field");
      expect(wrapper.getAttribute("data-size")).toBe(size);
      expect(wrapper.hasAttribute("data-readonly")).toBe(true);
    }
  });

  it("Select: длинная подпись выбранного варианта попадает в title", () => {
    const root = rootOf(
      mount(handles, Select, { variant: "native",
        label: "Роль",
        value: "long",
        options: [
          { value: "long", label: "Очень длинное название роли" },
          { value: "short", label: "Коротко" },
        ],
      }),
    );
    expect(query(root, "select").getAttribute("title")).toBe("Очень длинное название роли");
  });

  it("выбор и переключатель помечают readOnly/validating", () => {
    const root = rootOf(
      mount(handles, Checkbox, { readOnly: true, field: fakeField(false, { validating: true }).field }),
    );
    expect(root.hasAttribute("data-readonly")).toBe(true);
    expect(root.hasAttribute("data-validating")).toBe(true);

    const switchRoot = rootOf(mount(handles, Switch, { readOnly: true }));
    expect(switchRoot.hasAttribute("data-readonly")).toBe(true);

    const radioRoot = rootOf(
      mount(handles, RadioGroup, { readOnly: true, options: [{ value: "a", label: "A" }] }),
    );
    expect(radioRoot.hasAttribute("data-readonly")).toBe(true);
  });
});

describe("FieldArray: карточки строк", () => {
  class ItemForm extends Form {
    @Field()
    public accessor name = "";
  }

  class ListForm extends Form {
    @Field({ array: () => new ItemForm() })
    public accessor items: ItemForm[] = [];
  }

  it("шапка карточки: номер строки и действия не выдавливаются", () => {
    const form = new ListForm();
    forms.push(form);
    const array = form.getFieldArray("items");
    array.add();
    array.add();
    const root = rootOf(
      mount(handles, FieldArray, {
        array,
        label: "Позиции",
        children: (item: ItemForm, index: number) => (
          <TextField field={item.getFieldProps("name")} label={`Позиция ${index + 1}`} />
        ),
      }),
    );
    const items = Array.from(root.querySelectorAll(".sui-field-array__item"));
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector(".sui-field-array__item-header")).not.toBeNull();
    expect(items[0]?.querySelector(".sui-field-array__index")?.textContent).toBe("1");
    expect(items[1]?.querySelector(".sui-field-array__index")?.textContent).toBe("2");
    expect(items[0]?.querySelector(".sui-field-array__actions")).not.toBeNull();
  });

  it("после удаления фокус уходит на кнопку добавления", () => {
    const form = new ListForm();
    forms.push(form);
    const array = form.getFieldArray("items");
    array.add();
    const root = rootOf(
      mount(handles, FieldArray, {
        array,
        children: (item: ItemForm) => <TextField field={item.getFieldProps("name")} />,
      }),
    );
    const remove = query<HTMLButtonElement>(root, '[aria-label="Удалить 1"]');
    remove.click();
    flushSync();
    expect(root.querySelectorAll(".sui-field-array__item")).toHaveLength(0);
    expect(document.activeElement).toBe(query(root, ".sui-field-array__add"));
  });
});

describe("SearchField: длинный запрос и состояния", () => {
  it("data-has-value и валидация", () => {
    const fake = fakeField("длинный поисковый запрос", {
      hint: "Подсказка",
      validating: true,
    });
    const root = rootOf(mount(handles, SearchField, { field: fake.field }));
    const wrapper = query(root, ".sui-search-field");
    expect(wrapper.hasAttribute("data-has-value")).toBe(true);
    expect(wrapper.hasAttribute("data-validating")).toBe(true);
    expect(root.hasAttribute("data-validating")).toBe(true);
    expect(query<HTMLInputElement>(root, "input").value).toBe("длинный поисковый запрос");
  });
});

describe("Table: скролл и длинные ячейки", () => {
  interface Row {
    readonly id: number;
    readonly name: string;
  }
  const columns: readonly TableColumn<Row>[] = [
    { key: "name", header: "Имя" },
    { key: "name", header: "Коротко", truncate: true },
    { key: "name", header: "Две строки", lines: 2 },
  ];
  const rows: readonly Row[] = [{ id: 1, name: "Очень длинное значение" }];

  it("обёртка скролла сохраняет семантическую таблицу", () => {
    const root = rootOf(
      mount(handles, Table, { columns, rows, rowKey: (row: Row) => row.id, caption: "Люди" }),
    );
    expect(root.classList.contains("sui-table-scroll")).toBe(true);
    const table = query(root, "table.sui-table");
    expect(table.tagName).toBe("TABLE");
    expect(table.querySelector("caption")?.textContent).toBe("Люди");
  });

  it("truncate/lines задают data-атрибуты и обёртку контента", () => {
    const root = rootOf(
      mount(handles, Table, { columns, rows, rowKey: (row: Row) => row.id }),
    );
    const cells = Array.from(root.querySelectorAll<HTMLElement>(".sui-table__cell"));
    expect(cells[0]?.hasAttribute("data-truncate")).toBe(false);
    expect(cells[0]?.querySelector(".sui-table__cell-content")).not.toBeNull();
    expect(cells[1]?.hasAttribute("data-truncate")).toBe(true);
    expect(cells[2]?.getAttribute("data-lines")).toBe("2");
  });
});

describe("Accordion: длинный заголовок", () => {
  const items: readonly AccordionItemData[] = [
    { key: "long", title: "Очень длинный заголовок", truncate: true },
    { key: "wrap", title: "Заголовок с переносом" },
  ];

  it("truncate помечает заголовок, остальные переносятся", () => {
    const root = rootOf(mount(handles, Accordion, { items }));
    const titles = Array.from(root.querySelectorAll(".sui-accordion__title"));
    expect(titles[0]?.hasAttribute("data-truncate")).toBe(true);
    expect(titles[1]?.hasAttribute("data-truncate")).toBe(false);
  });
});

describe("CSS-контракт форм и адаптива", () => {
  const files = [
    "form/field/field.css",
    "form/text-field/text-field.css",
    "form/textarea/textarea.css",
    "form/select/select.css",
    "form/checkbox/checkbox.css",
    "form/radio-group/radio-group.css",
    "form/switch/switch.css",
    "form/slider/slider.css",
    "form/file-field/file-field.css",
    "form/field-group/field-group.css",
    "form/field-array/field-array.css",
    "components/search-field/search-field.css",
    "components/table/table.css",
    "components/accordion/accordion.css",
  ] as const;

  it("все файлы — в слое sui.components, без !important и hex/rgba", () => {
    for (const file of files) {
      const css = read(file);
      expect(css, file).toContain("@layer sui.components {");
      expect(css, file).not.toContain("!important");
      const stripped = css
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/--sui-[a-z0-9-]+\s*:[^;]+;/gu, "");
      expect(/#[0-9a-fA-F]{3,8}\b/u.test(stripped), file).toBe(false);
      expect(/\brgba?\(/u.test(stripped), file).toBe(false);
    }
  });

  it("touch-размеры и адаптивные брейкпоинты на месте", () => {
    const textField = read("form/text-field/text-field.css");
    expect(textField).toContain("@media (pointer: coarse)");
    expect(textField).toContain("--sui-text-field-block-size");
    expect(textField).toContain("min-block-size: var(--sui-touch-target)");

    const group = read("form/field-group/field-group.css");
    expect(group).toContain("@media (min-width: 37.5em)");
    expect(group).toContain("@media (min-width: 52.5em)");
    expect(group).toContain("[data-columns]");
    expect(group).toContain("[data-sticky]");

    const fieldCss = read("form/field/field.css");
    expect(fieldCss).toContain("min-block-size: var(--sui-field-message-line)");
    expect(fieldCss).toContain("[data-invalid] .sui-field__hint");
    expect(fieldCss).toContain("[data-has-hint]");

    const table = read("components/table/table.css");
    expect(table).toContain(".sui-table-scroll");
    expect(table).toContain("overflow-x: auto");
    expect(table).toContain("overscroll-behavior-inline: contain");
    expect(table).toContain("[data-lines=\"2\"]");

    const choice = read("form/checkbox/checkbox.css");
    expect(choice).toContain("--sui-checkbox-hit-size: var(--sui-touch-target)");

    const radio = read("form/radio-group/radio-group.css");
    expect(radio).toContain("--sui-radio-hit-size: var(--sui-touch-target)");

    const slider = read("form/slider/slider.css");
    expect(slider).toContain("::-webkit-slider-thumb");
    expect(slider).toContain("::-moz-range-thumb");

    const accordion = read("components/accordion/accordion.css");
    expect(accordion).toContain("prefers-reduced-motion");
    expect(accordion).toContain("[data-truncate]");
  });

  it("каждая компонентная переменная объявлена в своём файле", () => {
    for (const file of files) {
      const css = read(file);
      const declared = new Set(
        [...css.matchAll(/(--sui-[a-z0-9-]+)\s*:/gu)].map((match) => match[1]),
      );
      const referenced = new Set(
        [...css.matchAll(/var\(\s*(--sui-(?:field|text-field|textarea|select|checkbox|radio|switch|slider|file-field|field-group|form-actions|search-field|table|accordion)-[a-z0-9-]+)/gu)]
          .map((match) => match[1])
          .filter((name): name is string => name !== undefined),
      );
      for (const name of referenced) {
        expect(declared.has(name), `${file}: ${name}`).toBe(true);
      }
    }
  });
});
