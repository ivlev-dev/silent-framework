import { afterEach, describe, expect, it } from "vitest";
import { flushSync, hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { Field as FormField, Form } from "@ivlev-dev/silent-form";
import { Checkbox } from "../src/form/checkbox/index.js";
import { CheckboxGroup } from "../src/form/checkbox-group/index.js";
import { Field as UiField } from "../src/form/field/index.js";
import { RadioGroup } from "../src/form/radio-group/index.js";
import { Switch } from "../src/form/switch/index.js";
import {
  fakeField,
  mount,
  query,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

const handles: TestHandles = { items: [] };
const forms: Form[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const handle of handles.items.splice(0)) handle.dispose();
  for (const form of forms.splice(0)) form.dispose();
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

function inputs(root: Element): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
}

describe("Checkbox: варианты и состояния", () => {
  it("variant/size — data-атрибуты, строка сохраняет label", () => {
    const root = rootOf(
      mount(handles, Checkbox, {
        label: "Согласие",
        variant: "card",
        size: "lg",
        description: "Условия",
      }),
    );
    expect(root.getAttribute("data-variant")).toBe("card");
    expect(root.getAttribute("data-size")).toBe("lg");
    const card = query<HTMLLabelElement>(root, "label.sui-checkbox__card");
    expect(card.getAttribute("for")).toBe("sui-checkbox");
    expect(card.querySelector("input[type=checkbox]")).not.toBeNull();
    expect(card.textContent).toContain("Согласие");
    expect(card.textContent).toContain("Условия");
  });

  it("иконка декоративна, invalid даёт aria-invalid", () => {
    const root = rootOf(
      mount(handles, Checkbox, {
        id: "features",
        label: "Функция",
        icon: "★",
        invalid: true,
      }),
    );
    const icon = query(root, ".sui-checkbox__icon");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(root.hasAttribute("data-invalid")).toBe(true);
    expect(query<HTMLInputElement>(root, "input").getAttribute("aria-invalid")).toBe("true");
  });

  it("card/tile показывают состояние checked на корне", () => {
    for (const variant of ["card", "tile"] as const) {
      const root = rootOf(
        mount(handles, Checkbox, { label: "Опция", variant, checked: true }),
      );
      expect(root.getAttribute("data-variant")).toBe(variant);
      expect(root.hasAttribute("data-checked")).toBe(true);
      expect(query<HTMLInputElement>(root, "input").checked).toBe(true);
    }
  });
});

describe("CheckboxGroup", () => {
  const options = [
    { value: "a", label: "A", description: "Первый" },
    { value: "b", label: "B", icon: "★" },
    { value: "c", label: "C", disabled: true },
  ] as const;

  it("fieldset/legend, варианты, размеры и сетка", () => {
    const root = rootOf(
      mount(handles, CheckboxGroup, {
        id: "tags",
        label: "Теги",
        hint: "Выберите несколько",
        options,
        variant: "card",
        orientation: "horizontal",
        columns: 2,
        defaultValue: ["a"],
      }),
    );
    expect(root.tagName).toBe("FIELDSET");
    expect(query(root, "legend").textContent).toBe("Теги");
    expect(root.getAttribute("data-variant")).toBe("card");
    expect(root.getAttribute("data-orientation")).toBe("horizontal");
    expect(root.getAttribute("data-columns")).toBe("2");
    const boxes = inputs(root);
    expect(boxes).toHaveLength(3);
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[0]?.value).toBe("a");
    expect(boxes[0]?.name).toBe("tags");
    expect(boxes[2]?.disabled).toBe(true);
    expect(root.querySelector("#tags-hint")?.textContent).toBe("Выберите несколько");
    expect(boxes[0]?.getAttribute("aria-describedby")).toBe(
      "tags-hint tags-a-description",
    );
    expect(root.querySelector(".sui-checkbox")?.getAttribute("data-variant")).toBe("card");
  });

  it("клик обновляет неуправляемое значение и отдаёт массив", () => {
    const seen: unknown[] = [];
    const root = rootOf(
      mount(handles, CheckboxGroup, {
        options,
        defaultValue: ["a"],
        onChange: (event: Event) => {
          seen.push(event);
        },
        onValueChange: (value: readonly string[]) => {
          seen.push(value);
        },
      }),
    );
    const boxes = inputs(root);
    boxes[1]!.click();
    flushSync();
    expect(boxes[1]?.checked).toBe(true);
    const synthetic = seen[0] as {
      target: { multiple: boolean; selectedOptions: readonly { value: string }[] };
    };
    expect(synthetic.target.multiple).toBe(true);
    expect(synthetic.target.selectedOptions.map((option) => option.value)).toEqual(["a", "b"]);
    expect(seen[1]).toEqual(["a", "b"]);
  });

  it("min/max блокируют лишние изменения", () => {
    const root = rootOf(
      mount(handles, CheckboxGroup, {
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        max: 1,
      }),
    );
    const boxes = inputs(root);
    boxes[0]!.click();
    flushSync();
    expect(boxes[0]?.checked).toBe(true);
    expect(root.getAttribute("data-limit")).toBe("max");
    expect(boxes[1]?.disabled).toBe(true);
    boxes[1]!.click();
    flushSync();
    expect(boxes[1]?.checked).toBe(false);

    const minRoot = rootOf(
      mount(handles, CheckboxGroup, {
        options: [{ value: "x", label: "X" }],
        min: 1,
      }),
    );
    const [only] = inputs(minRoot);
    only!.click();
    flushSync();
    expect(only?.checked).toBe(true);
    expect(minRoot.getAttribute("data-limit")).toBe("min");
    only!.click();
    flushSync();
    expect(only?.checked).toBe(true);
  });

  it("field: синтетическое change обновляет массив и aria-связи", () => {
    class TagsForm extends Form {
      @FormField()
      public accessor tags: string[] = [];
    }
    const form = new TagsForm();
    forms.push(form);
    const field = form.getFieldProps("tags");
    const root = rootOf(
      mount(handles, CheckboxGroup, {
        field,
        options,
        hint: "Несколько значений",
        error: "Выберите хотя бы один",
      }),
    );
    expect(root.hasAttribute("data-invalid")).toBe(true);
    expect(root.getAttribute("aria-invalid")).toBe("true");
    const boxes = inputs(root);
    expect(boxes[0]?.getAttribute("aria-describedby")).toBe(
      `${field.id}-hint ${field.id}-error tags-a-description`,
    );
    boxes[0]!.click();
    flushSync();
    boxes[1]!.click();
    flushSync();
    expect(form.tags).toEqual(["a", "b"]);
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(true);
  });

  it("max/min подсказка приходит из UiConfigProvider", () => {
    const root = rootOf(
      mount(handles, CheckboxGroup, {
        id: "cfg",
        options: [{ value: "a", label: "A" }],
        min: 2,
        max: 3,
      }),
    );
    const constraint = query(root, ".sui-checkbox-group__constraint");
    expect(constraint.textContent).toContain("Выберите не менее 2");
    expect(constraint.textContent).toContain("Выберите не более 3");
    expect(query<HTMLInputElement>(root, "input").getAttribute("aria-describedby")).toBe(
      "cfg-constraint",
    );
  });

  it("readOnly не меняет значение", () => {
    const seen: string[][] = [];
    const root = rootOf(
      mount(handles, CheckboxGroup, {
        options,
        defaultValue: ["a"],
        readOnly: true,
        onValueChange: (value: readonly string[]) => {
          seen.push([...value]);
        },
      }),
    );
    const [first] = inputs(root);
    first!.click();
    flushSync();
    expect(seen).toEqual([]);
    expect(root.hasAttribute("data-readonly")).toBe(true);
  });

  it("встраивается в Field как контрол группы", () => {
    const root = rootOf(
      mount(handles, UiField, {
        id: "tags",
        label: "Теги",
        children: (
          <CheckboxGroup id="tags" options={options} defaultValue={["b"]} />
        ),
      }),
    );
    expect(root.classList.contains("sui-field")).toBe(true);
    expect(root.querySelector(".sui-field__label")?.textContent).toContain("Теги");
    expect(root.querySelector(".sui-field__control legend")).toBeNull();
  });
});

describe("RadioGroup: варианты и onValueChange", () => {
  const options = [
    { value: "a", label: "A", description: "Описание A", icon: "◆" },
    { value: "b", label: "B" },
    { value: "c", label: "C", disabled: true },
  ] as const;

  it("card/tile/size/orientation/columns", () => {
    for (const variant of ["card", "tile"] as const) {
      const root = rootOf(
        mount(handles, RadioGroup, {
          options,
          value: "a",
          variant,
          size: "lg",
          orientation: "horizontal",
          columns: 3,
          label: "План",
        }),
      );
      expect(root.getAttribute("data-variant")).toBe(variant);
      expect(root.getAttribute("data-size")).toBe("lg");
      expect(root.getAttribute("data-orientation")).toBe("horizontal");
      expect(root.getAttribute("data-columns")).toBe("3");
      const labels = Array.from(root.querySelectorAll("label.sui-radio"));
      expect(labels).toHaveLength(3);
      expect(labels[0]?.querySelector("input[type=radio]")).not.toBeNull();
      expect(labels[0]?.textContent).toContain("Описание A");
      expect(labels[0]?.hasAttribute("data-checked")).toBe(true);
      expect(labels[0]?.querySelector(".sui-radio__icon")?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("roving tabindex и стрелки сохраняются для карточек", () => {
    const fake = fakeField("a", { name: "plan" });
    const root = rootOf(
      mount(handles, RadioGroup, { field: fake.field, options, variant: "card" }),
    );
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios[0]?.tabIndex).toBe(0);
    expect(radios[1]?.tabIndex).toBe(-1);
    radios[0]?.focus();
    radios[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    flushSync();
    expect(fake.field.value).toBe("b");
    expect(document.activeElement).toBe(radios[1]);
  });

  it("onValueChange получает новое значение", () => {
    const seen: Array<string | number> = [];
    const root = rootOf(
      mount(handles, RadioGroup, {
        options,
        value: "a",
        onValueChange: (value: string | number) => seen.push(value),
      }),
    );
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    radios[1]!.click();
    flushSync();
    expect(seen).toEqual(["b"]);
  });
});

describe("Switch: toggler, loading и иконки", () => {
  it("loading: disabled, aria-busy и спиннер", () => {
    const root = rootOf(
      mount(handles, Switch, { label: "Синхронизация", loading: true, checked: true }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("aria-busy")).toBe("true");
    expect(root.hasAttribute("data-loading")).toBe(true);
    expect(root.querySelector(".sui-spinner")).not.toBeNull();
    expect(root.querySelector(".sui-switch__track-label")).toBeNull();
  });

  it("toggler держит подпись внутри трека, labelPosition — снаружи", () => {
    const toggler = rootOf(
      mount(handles, Switch, { label: "Тёмная тема", variant: "toggler", checked: true }),
    );
    expect(toggler.getAttribute("data-variant")).toBe("toggler");
    const inside = query(toggler, ".sui-switch__track-label");
    expect(inside.textContent).toBe("Тёмная тема");
    expect(toggler.querySelector(".sui-switch__label")).toBeNull();
    expect(query<HTMLInputElement>(toggler, "input").getAttribute("role")).toBe("switch");

    const switched = rootOf(
      mount(handles, Switch, { label: "Снаружи", labelPosition: "start" }),
    );
    expect(switched.getAttribute("data-label-position")).toBe("start");
    expect(query(switched, ".sui-switch__label").textContent).toBe("Снаружи");
    expect(switched.querySelector(".sui-switch__track-label")).toBeNull();
  });

  it("onIcon/offIcon переключаются вместе с состоянием", () => {
    const fake = fakeField(false, { label: "Режим" });
    const root = rootOf(
      mount(handles, Switch, {
        field: fake.field,
        icon: "•",
        onIcon: "ON",
        offIcon: "OFF",
      }),
    );
    expect(query(root, ".sui-switch__icon").textContent).toBe("OFF");
    query<HTMLInputElement>(root, "input").click();
    flushSync();
    expect(fake.field.value).toBe(true);
    expect(query(root, ".sui-switch__icon").textContent).toBe("ON");
  });

  it("invalid, size и onValueChange", () => {
    const seen: boolean[] = [];
    const fake = fakeField(false);
    const root = rootOf(
      mount(handles, Switch, {
        field: fake.field,
        size: "lg",
        invalid: true,
        onValueChange: (checked: boolean) => seen.push(checked),
      }),
    );
    expect(root.getAttribute("data-size")).toBe("lg");
    expect(root.hasAttribute("data-invalid")).toBe(true);
    const input = query<HTMLInputElement>(root, "input");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    input.click();
    flushSync();
    expect(seen).toEqual([true]);
    expect(input.getAttribute("aria-checked")).toBe("true");
  });
});

describe("SSR и гидрация выбора", () => {
  it("Checkbox indeterminate: mixed в разметке и при гидрации", async () => {
    function Mixed(): Node {
      return (
        <Checkbox
          id="all"
          name="all"
          label="Выбрать все"
          checked={false}
          indeterminate
        />
      );
    }
    const { html } = await renderToString(Mixed);
    expect(html).toContain('aria-checked="mixed"');
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, Mixed, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    expect(mismatches).toEqual([]);
    const input = container.querySelector<HTMLInputElement>("#all");
    expect(input?.indeterminate).toBe(true);
    expect(input?.getAttribute("aria-checked")).toBe("mixed");
  });

  it("Checkbox card: вся карточка — label, гидрация без mismatch", async () => {
    function Card(): Node {
      return (
        <Checkbox
          id="card"
          name="card"
          label="Карточка"
          description="С описанием"
          variant="card"
          checked
          icon="★"
        />
      );
    }
    const { html } = await renderToString(Card);
    expect(html).toContain('class="sui-checkbox__card"');
    expect(html).toContain('for="card"');
    expect(html).toContain("С описанием");
    expect(html).toContain("checked");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, Card, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    expect(mismatches).toEqual([]);
    const input = container.querySelector<HTMLInputElement>("#card");
    expect(input?.checked).toBe(true);
    expect(input?.closest("label")?.classList.contains("sui-checkbox__card")).toBe(true);
  });

  it("CheckboxGroup: checked-опции переживают SSR и гидрацию", async () => {
    function Group(): Node {
      return (
        <CheckboxGroup
          id="tags"
          name="tags"
          label="Теги"
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
            { value: "c", label: "C" },
          ]}
          defaultValue={["b"]}
          variant="card"
          max={2}
        />
      );
    }
    const { html } = await renderToString(Group);
    expect(html).toContain('data-variant="card"');
    expect(html).toContain('value="b"');
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const checked = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).filter((input) => input.checked);
    expect(checked.map((input) => input.value)).toEqual(["b"]);

    const mismatches: string[] = [];
    const handle = await hydrate(container, Group, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    expect(mismatches).toEqual([]);
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(["b"]);
  });

  it("RadioGroup: нативные input на сервере и гидрация выбора", async () => {
    function Radios(): Node {
      return (
        <RadioGroup
          id="plan"
          name="plan"
          label="План"
          variant="card"
          options={[
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]}
          value="b"
        />
      );
    }
    const { html } = await renderToString(Radios);
    expect(html.match(/type="radio"/gu)).toHaveLength(2);
    expect(html).toContain('value="b"');
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(["b"]);
    const mismatches: string[] = [];
    const handle = await hydrate(container, Radios, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    expect(mismatches).toEqual([]);
  });

  it("Switch toggler: aria-checked и подпись на сервере", async () => {
    function Toggler(): Node {
      return (
        <Switch id="theme" name="theme" label="Тёмная тема" variant="toggler" checked />
      );
    }
    const { html } = await renderToString(Toggler);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Тёмная тема");
    expect(html).not.toContain("jsx(");
  });
});
