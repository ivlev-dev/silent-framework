import { afterEach, describe, expect, it } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import {
  Field,
  Form,
  Hint,
  Label,
  Required,
} from "@ivlev-dev/silent-form";
import {
  Checkbox,
  FieldArray,
  RadioGroup,
  Select,
  Slider,
  Switch,
  Textarea,
  TextField,
} from "../src/form/index.js";
import {
  mount,
  query,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

class ProfileForm extends Form {
  @Field()
  @Label("Email")
  @Hint("Рабочая почта")
  @Required()
  public accessor email = "";

  @Field()
  @Label("Возраст")
  public accessor age = 18;

  @Field()
  @Label("О себе")
  public accessor bio = "";

  @Field()
  @Label("Согласие")
  public accessor agree = false;

  @Field()
  @Label("Уведомления")
  public accessor notify = true;

  @Field()
  @Label("Роль")
  public accessor role = "user";

  @Field()
  @Label("Пол")
  public accessor gender = "";
}

const handles: TestHandles = { items: [] };
const forms: Form[] = [];

function profile(): ProfileForm {
  const form = new ProfileForm();
  forms.push(form);
  return form;
}

afterEach(() => {
  for (const handle of handles.items.splice(0)) handle.dispose();
  for (const form of forms.splice(0)) form.dispose();
  document.body.replaceChildren();
});

describe("TextField + Form", () => {
  it("field даёт label/hint/value и id; ввод обновляет форму", () => {
    const form = profile();
    const root = rootOf(
      mount(handles, TextField, { field: form.getFieldProps("email") }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.value).toBe("");
    expect(input.name).toBe("email");
    expect(input.id).toBe(form.getFieldProps("email").id);
    expect(root.textContent).toContain("Email");
    expect(root.textContent).toContain("Рабочая почта");
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-required")).toBe("true");

    input.value = "user@example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(form.email).toBe("user@example.com");
  });

  it("ошибка валидации появляется и связывается aria", async () => {
    const form = profile();
    const root = rootOf(
      mount(handles, TextField, { field: form.getFieldProps("email") }),
    );
    const input = query<HTMLInputElement>(root, "input");
    input.value = "плохо";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await form.validate();
    flushSync();

    const field = form.getFieldProps("email");
    expect(field.error).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(`${field.id}-hint ${field.id}-error`);
    const error = root.querySelector(`#${field.id}-error`);
    expect(error?.textContent).toBe(field.error);
    expect(error?.getAttribute("role")).toBeNull();
  });

  it("серверная ошибка видна без touched", () => {
    const form = profile();
    const root = rootOf(
      mount(handles, TextField, { field: form.getFieldProps("email") }),
    );
    const input = query<HTMLInputElement>(root, "input");
    form.setFieldErrors("email", "Этот email уже занят");
    flushSync();
    expect(root.textContent).toContain("Этот email уже занят");
    expect(root.hasAttribute("data-touched")).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("touched ставится на blur и не скрывает ошибку", () => {
    const form = profile();
    const root = rootOf(
      mount(handles, TextField, { field: form.getFieldProps("email") }),
    );
    const input = query<HTMLInputElement>(root, "input");
    form.setFieldErrors("email", "Ошибка");
    flushSync();
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    flushSync();
    expect(root.hasAttribute("data-touched")).toBe(true);
    expect(root.textContent).toContain("Ошибка");
  });

  it("программное значение обновляет DOM без перерендера", () => {
    const form = profile();
    const root = rootOf(
      mount(handles, TextField, { field: form.getFieldProps("email") }),
    );
    const input = query<HTMLInputElement>(root, "input");
    form.getFieldProps("email").setValue("set@example.com");
    flushSync();
    expect(query<HTMLInputElement>(root, "input")).toBe(input);
    expect(input.value).toBe("set@example.com");
  });
});

describe("Контролы + Form", () => {
  it("Checkbox и Switch пишут boolean", () => {
    const form = profile();
    const checkboxRoot = rootOf(
      mount(handles, Checkbox, { field: form.getFieldProps("agree") }),
    );
    query<HTMLInputElement>(checkboxRoot, "input").click();
    flushSync();
    expect(form.agree).toBe(true);

    const switchRoot = rootOf(
      mount(handles, Switch, { field: form.getFieldProps("notify") }),
    );
    const switchInput = query<HTMLInputElement>(switchRoot, "input");
    expect(switchInput.checked).toBe(true);
    switchInput.click();
    flushSync();
    expect(form.notify).toBe(false);
  });

  it("Select пишет строку", () => {
    const form = profile();
    const root = rootOf(
      mount(handles, Select, {
        field: form.getFieldProps("role"),
        options: [
          { value: "user", label: "Пользователь" },
          { value: "admin", label: "Администратор" },
        ],
      }),
    );
    const select = query<HTMLSelectElement>(root, "select");
    expect(select.value).toBe("user");
    select.value = "admin";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(form.role).toBe("admin");
  });

  it("RadioGroup пишет выбранное значение", () => {
    const form = profile();
    const root = rootOf(
      mount(handles, RadioGroup, {
        field: form.getFieldProps("gender"),
        options: [
          { value: "f", label: "Ж" },
          { value: "m", label: "М" },
        ],
      }),
    );
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    radios[1]?.click();
    flushSync();
    expect(form.gender).toBe("m");
  });

  it("Slider пишет number с приведением типа", () => {
    const form = profile();
    const root = rootOf(
      mount(handles, Slider, {
        field: form.getFieldProps("age"),
        min: 0,
        max: 100,
        unit: " лет",
      }),
    );
    const input = query<HTMLInputElement>(root, "input");
    expect(input.value).toBe("18");
    input.value = "42";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(form.age).toBe(42);
    expect(input.getAttribute("aria-valuetext")).toBe("42 лет");
  });

  it("Textarea пишет строку и показывает счётчик", () => {
    const form = profile();
    const root = rootOf(
      mount(handles, Textarea, {
        field: form.getFieldProps("bio"),
        counter: true,
        maxLength: 100,
      }),
    );
    const textarea = query<HTMLTextAreaElement>(root, "textarea");
    textarea.value = "Привет";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(form.bio).toBe("Привет");
    expect(root.querySelector(".sui-textarea__counter")?.textContent).toBe("6/100");
  });
});

describe("FieldArray + FormArray", () => {
  class ItemForm extends Form {
    @Field()
    @Label("Название")
    public accessor name = "";
  }

  class OrderForm extends Form {
    @Field({ array: () => new ItemForm() })
    @Label("Позиции")
    public accessor items: ItemForm[] = [];
  }

  function orderForm(): OrderForm {
    const form = new OrderForm();
    forms.push(form);
    return form;
  }

  function mountArray(form: OrderForm): Element {
    return rootOf(
      mount(handles, FieldArray, {
        array: form.getFieldArray("items"),
        label: "Позиции",
        children: (item: ItemForm, index: number) => (
          <TextField
            field={item.getFieldProps("name")}
            label={`Позиция ${index + 1}`}
          />
        ),
      }),
    );
  }

  it("add/remove меняют FormArray и DOM", () => {
    const form = orderForm();
    const root = mountArray(form);
    const add = query<HTMLButtonElement>(root, ".sui-field-array__add");
    expect(add.textContent).toBe("Добавить");
    add.click();
    flushSync();
    add.click();
    flushSync();
    expect(form.getFieldArray("items").length).toBe(2);
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>(".sui-field-array__item input"));
    expect(inputs).toHaveLength(2);
    const firstNode = inputs[0];

    const removeFirst = query<HTMLButtonElement>(root, '[aria-label="Удалить 1"]');
    removeFirst.click();
    flushSync();
    expect(form.getFieldArray("items").length).toBe(1);
    expect(root.querySelectorAll(".sui-field-array__item")).toHaveLength(1);
    // Второй элемент сохраняет свой DOM-узел благодаря `keyOf`.
    expect(root.querySelector(".sui-field-array__item input")).toBe(inputs[1]);
    expect(firstNode?.isConnected).toBe(false);
  });

  it("move меняет порядок и не пересоздаёт строки", () => {
    const form = orderForm();
    const array = form.getFieldArray("items");
    array.add().name = "A";
    array.add().name = "B";
    const root = mountArray(form);
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>(".sui-field-array__item input"));
    expect(inputs.map((input) => input.value)).toEqual(["A", "B"]);
    inputs[0]?.focus();

    query<HTMLButtonElement>(root, '[aria-label="Переместить ниже 1"]').click();
    flushSync();
    expect(array.items.map((item) => item.name)).toEqual(["B", "A"]);
    const after = Array.from(root.querySelectorAll<HTMLInputElement>(".sui-field-array__item input"));
    expect(after.map((input) => input.value)).toEqual(["B", "A"]);
    expect(after[1]).toBe(inputs[0]);
    expect(after[0]).toBe(inputs[1]);
    expect(document.activeElement).toBe(inputs[0]);
  });

  it("min/max блокируют действия", () => {
    const form = orderForm();
    const root = rootOf(
      mount(handles, FieldArray, {
        array: form.getFieldArray("items"),
        label: "Позиции",
        min: 1,
        max: 1,
        children: (item: ItemForm) => <TextField field={item.getFieldProps("name")} />,
      }),
    );
    const add = query<HTMLButtonElement>(root, ".sui-field-array__add");
    add.click();
    flushSync();
    expect(add.disabled).toBe(true);
    expect(query<HTMLButtonElement>(root, '[aria-label="Удалить 1"]').disabled).toBe(true);
  });
});
