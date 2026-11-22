// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createRoot, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { applyProps, bindChecked, bindSource, bindValue, type BindSetter } from "../src/dom";

// bindValue/bindChecked принимают BindSetter<unknown>; текущие сигналы типизированы
// уже, поэтому приводим сеттер явно, не ослабляя типы сигнала.
function setterFor<T>(setter: (value: T) => void): BindSetter<unknown> {
  return setter as BindSetter<unknown>;
}

function input(type: string = "text"): HTMLInputElement {
  const element = document.createElement("input");
  element.type = type;
  document.body.appendChild(element);
  return element;
}

function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("bindValue: input", () => {
  it("инициализирует значение и обновляет его из сигнала", () => {
    const [value, setValue] = createSignal("hello");
    const element = input();

    createRoot(() => {
      bindValue(element, value);
    });

    expect(element.value).toBe("hello");
    setValue("bye");
    flushSync();
    expect(element.value).toBe("bye");
  });

  it("записывает пользовательский ввод в сигнал", () => {
    const [value, setValue] = createSignal("a");
    const element = input();

    createRoot(() => {
      bindValue(element, value, setterFor(setValue));
    });

    typeInto(element, "abc");
    flushSync();
    expect(value()).toBe("abc");
    expect(element.value).toBe("abc");
  });

  it("не перезаписывает DOM при совпадающем значении", () => {
    const [value, setValue] = createSignal("same");
    const element = input();

    createRoot(() => {
      bindValue(element, value, setterFor(setValue));
    });
    element.setSelectionRange(1, 2);
    element.focus();

    setValue("same");
    flushSync();

    expect(element.selectionStart).toBe(1);
    expect(element.selectionEnd).toBe(2);
  });

  it("сохраняет позицию курсора при перезаписи из сигнала", () => {
    const [value, setValue] = createSignal("abcdef");
    const element = input();

    createRoot(() => {
      bindValue(element, value);
    });
    element.focus();
    element.setSelectionRange(2, 4);

    setValue("abcdefgh");
    flushSync();

    expect(element.value).toBe("abcdefgh");
    expect(element.selectionStart).toBe(2);
    expect(element.selectionEnd).toBe(4);
  });

  it("не трогает selection у неактивного поля", () => {
    const [value, setValue] = createSignal("abcdef");
    const element = input();

    createRoot(() => {
      bindValue(element, value);
    });
    element.setSelectionRange(3, 3);
    let calls = 0;
    const original = element.setSelectionRange.bind(element);
    element.setSelectionRange = (
      start: number | null,
      end: number | null,
      direction?: "forward" | "backward" | "none",
    ): void => {
      calls += 1;
      original(start, end, direction);
    };

    setValue("xyz");
    flushSync();

    expect(element.value).toBe("xyz");
    expect(calls).toBe(0);
  });

  it("игнорирует ввод во время композиции и синхронизирует после compositionend", () => {
    const [value, setValue] = createSignal("a");
    const element = input();

    createRoot(() => {
      bindValue(element, value, setterFor(setValue));
    });

    element.dispatchEvent(new CompositionEvent("compositionstart"));
    typeInto(element, "か");
    flushSync();
    expect(value()).toBe("a");

    element.value = "かな";
    element.dispatchEvent(new CompositionEvent("compositionend"));
    flushSync();
    expect(value()).toBe("かな");
  });

  it("не перезаписывает DOM внешним значением во время композиции", () => {
    const [value, setValue] = createSignal("a");
    const element = input();

    createRoot(() => {
      bindValue(element, value, setterFor(setValue));
    });

    element.dispatchEvent(new CompositionEvent("compositionstart"));
    element.value = "か";
    setValue("external");
    flushSync();
    expect(element.value).toBe("か");

    element.dispatchEvent(new CompositionEvent("compositionend"));
    flushSync();
    expect(element.value).toBe("external");
  });

  it("не пишет сигнал для checkbox", () => {
    const [value, setValue] = createSignal("x");
    const element = input("checkbox");

    createRoot(() => {
      bindValue(element, value, setterFor(setValue));
    });
    element.checked = true;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    expect(value()).toBe("x");
  });

  it("поддерживает textarea", () => {
    const [value, setValue] = createSignal("text");
    const element = document.createElement("textarea");
    document.body.appendChild(element);

    createRoot(() => {
      bindValue(element, value, setterFor(setValue));
    });
    expect(element.value).toBe("text");

    typeInto(element, "next");
    flushSync();
    expect(value()).toBe("next");
    expect(element.defaultValue).toBe("text");
  });
});

describe("bindValue: select", () => {
  it("применяет значение после появления опций", async () => {
    const [value] = createSignal("b");
    const select = document.createElement("select");
    document.body.appendChild(select);

    createRoot(() => {
      bindValue(select, value);
    });
    expect(select.value).toBe("");

    for (const option of ["a", "b", "c"]) {
      const element = document.createElement("option");
      element.value = option;
      element.textContent = option;
      select.appendChild(element);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(select.value).toBe("b");
  });

  it("обновляет select из сигнала и из пользовательского выбора", () => {
    const [value, setValue] = createSignal("a");
    const select = document.createElement("select");
    document.body.appendChild(select);
    for (const option of ["a", "b"]) {
      const element = document.createElement("option");
      element.value = option;
      element.textContent = option;
      select.appendChild(element);
    }

    createRoot(() => {
      bindValue(select, value, setterFor(setValue));
    });
    expect(select.value).toBe("a");

    select.value = "b";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(value()).toBe("b");

    setValue("a");
    flushSync();
    expect(select.value).toBe("a");
  });

  it("поддерживает multiple select", () => {
    const [value, setValue] = createSignal<readonly string[]>(["a", "c"]);
    const select = document.createElement("select");
    select.multiple = true;
    document.body.appendChild(select);
    for (const option of ["a", "b", "c"]) {
      const element = document.createElement("option");
      element.value = option;
      element.textContent = option;
      select.appendChild(element);
    }

    createRoot(() => {
      bindValue(select, value, setterFor(setValue));
    });
    expect(
      Array.from(select.options)
        .filter((option) => option.selected)
        .map((option) => option.value),
    ).toEqual(["a", "c"]);

    for (const option of Array.from(select.options)) {
      option.selected = option.value === "b";
    }
    select.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(value()).toEqual(["b"]);
  });
});

describe("bindChecked", () => {
  it("инициализирует checkbox и обновляет его из сигнала", () => {
    const [checked, setChecked] = createSignal(true);
    const element = input("checkbox");

    createRoot(() => {
      bindChecked(element, checked);
    });
    expect(element.checked).toBe(true);

    setChecked(false);
    flushSync();
    expect(element.checked).toBe(false);
  });

  it("записывает пользовательское переключение в сигнал", () => {
    const [checked, setChecked] = createSignal(false);
    const element = input("checkbox");

    createRoot(() => {
      bindChecked(element, checked, setterFor(setChecked));
    });
    element.checked = true;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(checked()).toBe(true);
  });

  it("поддерживает indeterminate через значение mixed", () => {
    const [state, setState] = createSignal<"mixed" | boolean>("mixed");
    const element = input("checkbox");

    createRoot(() => {
      bindChecked(element, state);
    });
    expect(element.indeterminate).toBe(true);
    expect(element.checked).toBe(false);

    setState(true);
    flushSync();
    expect(element.indeterminate).toBe(false);
    expect(element.checked).toBe(true);

    setState("mixed");
    flushSync();
    expect(element.indeterminate).toBe(true);
    expect(element.checked).toBe(false);
  });

  it("сбрасывает indeterminate при клике", () => {
    const [state, setState] = createSignal<"mixed" | boolean>("mixed");
    const element = input("checkbox");

    createRoot(() => {
      bindChecked(element, state, setterFor(setState));
    });
    element.checked = true;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();

    expect(checked(element)).toBe(true);
    expect(element.indeterminate).toBe(false);
    expect(state()).toBe(true);
  });

  it("обновляет radio только при выборе", () => {
    const [checked, setChecked] = createSignal(false);
    const element = input("radio");

    createRoot(() => {
      bindChecked(element, checked, setterFor(setChecked));
    });
    element.checked = false;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(checked()).toBe(false);

    element.checked = true;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(checked()).toBe(true);
  });
});

function checked(element: HTMLInputElement): boolean {
  return element.checked;
}

describe("form.reset", () => {
  it("возвращает controlled-значение после сброса формы", async () => {
    const form = document.createElement("form");
    const element = document.createElement("input");
    form.appendChild(element);
    document.body.appendChild(form);
    const [value] = createSignal("current");

    createRoot(() => {
      bindValue(element, value);
    });
    expect(element.defaultValue).toBe("current");

    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(element.value).toBe("current");
  });

  it("возвращает controlled-checkbox после сброса формы", async () => {
    const form = document.createElement("form");
    const element = document.createElement("input");
    element.type = "checkbox";
    form.appendChild(element);
    document.body.appendChild(form);
    const [checked] = createSignal(true);

    createRoot(() => {
      bindChecked(element, checked);
    });
    expect(element.defaultChecked).toBe(true);

    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(element.checked).toBe(true);
  });
});

describe("интеграция с applyProps и bindSource", () => {
  it("applyProps применяет bindValue из кортежа", () => {
    const [value, setValue] = createSignal("a");
    const element = input();
    applyProps(element, { bindValue: [value, setValue] });

    typeInto(element, "b");
    flushSync();
    expect(value()).toBe("b");
  });

  it("bindSource разбирает accessor, кортеж и объект", () => {
    const [value, setValue] = createSignal("v");
    const [first] = bindSource(value);
    expect(first()).toBe("v");

    const [tuple, tupleSetter] = bindSource([value, setValue]);
    expect(tuple()).toBe("v");
    tupleSetter?.("next");
    expect(value()).toBe("next");

    const binding = {
      get: () => "obj",
      set: (next: unknown) => setValue(String(next)),
    };
    const [objectAccessor, objectSetter] = bindSource(binding);
    expect(objectAccessor()).toBe("obj");
    objectSetter?.("changed");
    expect(value()).toBe("changed");
  });
});
