import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { OtpInput } from "../src/form/otp-input/index.js";
import {
  createOtpState,
  isOtpComplete,
  otpGroupBoundaries,
  otpReducer,
  sanitizeOtpText,
} from "../src/form/otp-input/otp.js";
import {
  fakeField,
  mount,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

const handles: TestHandles = { items: [] };
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const handle of handles.items.splice(0)) handle.dispose();
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function flush(): void {
  flushSync();
  flushSync();
}

function otpInputs(root: Element): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>(".sui-otp__input"));
}

function typeAt(target: HTMLInputElement, value: string): void {
  target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

function press(target: EventTarget, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  flush();
}

function pasteAt(target: HTMLInputElement, text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  target.dispatchEvent(event);
  flush();
}

describe("OtpInput: reducer", () => {
  it("фильтрует символы по charSet", () => {
    expect(sanitizeOtpText("12-34", "numeric")).toBe("1234");
    expect(sanitizeOtpText("a1-Б2", "alphanumeric")).toBe("a1Б2");
    expect(sanitizeOtpText("a1-Б2", "letters")).toBe("aБ");
  });

  it("ввод заполняет разряд и переводит фокус дальше", () => {
    let state = createOtpState("12", 4, "numeric");
    expect(state.focus).toBe(2);
    state = otpReducer(state, {
      type: "input",
      index: 2,
      text: "3",
      length: 4,
      charSet: "numeric",
    });
    expect(state.chars.join("")).toBe("123");
    expect(state.focus).toBe(3);
    expect(isOtpComplete(state.chars, 4)).toBe(false);
    state = otpReducer(state, {
      type: "input",
      index: 3,
      text: "4",
      length: 4,
      charSet: "numeric",
    });
    expect(isOtpComplete(state.chars, 4)).toBe(true);
    expect(state.focus).toBe(3);
  });

  it("вставка распределяет символы с текущего разряда", () => {
    const state = otpReducer(createOtpState("", 6, "numeric"), {
      type: "paste",
      index: 0,
      text: "12-3456",
      length: 6,
      charSet: "numeric",
    });
    expect(state.chars.join("")).toBe("123456");
    expect(state.focus).toBe(5);
  });

  it("Backspace/Delete/стрелки/Home/End", () => {
    let state = createOtpState("1234", 4, "numeric");
    expect(otpReducer(state, { type: "key", index: 0, key: "ArrowLeft", length: 4 }).focus).toBe(0);
    expect(otpReducer(state, { type: "key", index: 0, key: "ArrowRight", length: 4 }).focus).toBe(1);
    expect(otpReducer(state, { type: "key", index: 2, key: "Home", length: 4 }).focus).toBe(0);
    expect(otpReducer(state, { type: "key", index: 2, key: "End", length: 4 }).focus).toBe(3);

    state = otpReducer(state, { type: "key", index: 3, key: "Backspace", length: 4 });
    expect(state.chars.join("")).toBe("123");
    expect(state.focus).toBe(3);

    state = otpReducer(state, { type: "key", index: 3, key: "Backspace", length: 4 });
    expect(state.chars.join("")).toBe("12");
    expect(state.focus).toBe(2);

    state = otpReducer(state, { type: "key", index: 0, key: "Delete", length: 4 });
    expect(state.chars.join("")).toBe("2");
  });

  it("границы групп не выходят за длину", () => {
    expect(otpGroupBoundaries([3, 3], 6)).toEqual([3]);
    expect(otpGroupBoundaries([3, 3], 8)).toEqual([3, 6]);
    expect(otpGroupBoundaries([2, 2], 5)).toEqual([2, 4]);
    expect(otpGroupBoundaries(undefined, 6)).toEqual([]);
  });
});

describe("OtpInput: разметка и ввод", () => {
  it("N разрядов, группа и подписи, скрытый input для формы", () => {
    const root = rootOf(
      mount(handles, OtpInput, {
        id: "code",
        name: "code",
        label: "Код",
        length: 4,
        value: "",
      }),
    );
    const group = root.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute("aria-label")).toBe("Код");
    const inputs = otpInputs(root);
    expect(inputs).toHaveLength(4);
    expect(inputs[0]?.getAttribute("aria-label")).toBe("Символ 1 из 4");
    expect(inputs[3]?.getAttribute("aria-label")).toBe("Символ 4 из 4");
    expect(inputs[0]?.getAttribute("autocomplete")).toBe("one-time-code");
    const hidden = root.querySelector<HTMLInputElement>('input[type="hidden"]');
    expect(hidden?.name).toBe("code");
  });

  it("ввод с автопереходом и reason=input", () => {
    const changes: Array<{ value: string; reason: string }> = [];
    const root = rootOf(
      mount(handles, OtpInput, {
        id: "code",
        length: 4,
        onValueChange: (value: string, context: { readonly reason: string }) => {
          changes.push({ value, reason: context.reason });
        },
      }),
    );
    const inputs = otpInputs(root);
    typeAt(inputs[0]!, "1");
    expect(changes.at(-1)).toEqual({ value: "1", reason: "input" });
    expect(document.activeElement).toBe(inputs[1]);
    typeAt(inputs[1]!, "2");
    expect(changes.at(-1)?.value).toBe("12");
    expect(document.activeElement).toBe(inputs[2]);
  });

  it("вставка фильтруется и получает reason=paste", () => {
    const changes: Array<{ value: string; reason: string }> = [];
    const root = rootOf(
      mount(handles, OtpInput, {
        id: "code",
        length: 4,
        onValueChange: (value: string, context: { readonly reason: string }) => {
          changes.push({ value, reason: context.reason });
        },
      }),
    );
    const inputs = otpInputs(root);
    pasteAt(inputs[0]!, "12-34");
    expect(changes.at(-1)).toEqual({ value: "1234", reason: "paste" });
    expect(inputs.map((input) => input.value).join("")).toBe("1234");
  });

  it("Backspace/Delete и стрелки управляют фокусом", () => {
    const changes: string[] = [];
    const root = rootOf(
      mount(handles, OtpInput, {
        id: "code",
        length: 4,
        defaultValue: "1234",
        onValueChange: (value: string) => changes.push(value),
      }),
    );
    const inputs = otpInputs(root);
    press(inputs[3]!, "Backspace");
    expect(changes.at(-1)).toBe("123");
    press(inputs[3]!, "Backspace");
    expect(changes.at(-1)).toBe("12");
    expect(document.activeElement).toBe(inputs[2]);
    press(inputs[2]!, "ArrowLeft");
    expect(document.activeElement).toBe(inputs[1]);
    press(inputs[1]!, "End");
    expect(document.activeElement).toBe(inputs[3]);
  });

  it("onComplete вызывается один раз на завершённый код", () => {
    const completed: string[] = [];
    const root = rootOf(
      mount(handles, OtpInput, {
        id: "code",
        length: 3,
        onComplete: (value: string) => completed.push(value),
      }),
    );
    const inputs = otpInputs(root);
    typeAt(inputs[0]!, "1");
    typeAt(inputs[1]!, "2");
    typeAt(inputs[2]!, "3");
    expect(completed).toEqual(["123"]);
    typeAt(inputs[2]!, "3");
    expect(completed).toEqual(["123"]);
    press(inputs[2]!, "Backspace");
    typeAt(inputs[2]!, "4");
    expect(completed).toEqual(["123", "124"]);
  });

  it("mask скрывает символы, группы дают сепаратор", () => {
    const root = rootOf(
      mount(handles, OtpInput, {
        id: "code",
        length: 6,
        groups: [3, 3],
        separator: "-",
        mask: true,
      }),
    );
    const inputs = otpInputs(root);
    expect(inputs.every((input) => input.type === "password")).toBe(true);
    expect(root.querySelectorAll(".sui-otp__separator")).toHaveLength(1);
    expect(root.querySelector(".sui-otp__separator")?.textContent).toBe("-");
    expect(root.querySelector(".sui-otp__slot[data-group-end]")).toBeNull();
  });

  it("autoSubmit отправляет ближайшую форму после заполнения", () => {
    const submitted: string[] = [];
    const form = document.createElement("form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted.push("submit");
    });
    document.body.appendChild(form);
    const handle = mount(handles, OtpInput, {
      id: "code",
      length: 2,
      autoSubmit: true,
    });
    form.appendChild(rootOf(handle));
    flush();
    const inputs = otpInputs(rootOf(handle));
    typeAt(inputs[0]!, "1");
    expect(submitted).toHaveLength(0);
    typeAt(inputs[1]!, "2");
    expect(submitted).toHaveLength(1);
  });

  it("autoFocus ставит фокус в первый пустой разряд", () => {
    const root = rootOf(
      mount(handles, OtpInput, { id: "code", length: 4, value: "12", autoFocus: true }),
    );
    const inputs = otpInputs(root);
    expect(document.activeElement).toBe(inputs[2]);
  });
});

describe("OtpInput: форма и SSR", () => {
  it("field получает строку через синтетический change", () => {
    const fake = fakeField<string>("");
    const root = rootOf(mount(handles, OtpInput, { field: fake.field, length: 4 }));
    typeAt(otpInputs(root)[0]!, "7");
    expect(fake.field.value).toBe("7");
  });

  it("readOnly не пишет", () => {
    const changes: string[] = [];
    const root = rootOf(
      mount(handles, OtpInput, {
        id: "code",
        length: 4,
        value: "12",
        readOnly: true,
        onValueChange: (value: string) => changes.push(value),
      }),
    );
    const inputs = otpInputs(root);
    expect(inputs[0]?.readOnly).toBe(true);
    typeAt(inputs[0]!, "9");
    expect(changes).toHaveLength(0);
  });

  it("SSR: value-атрибуты, без popup, гидрация без mismatch", async () => {
    function Ssr(): Node {
      return (
        <OtpInput
          id="code"
          name="code"
          label="Код"
          length={4}
          value="12"
          groups={[2, 2]}
          separator="-"
        />
      );
    }
    const { html } = await renderToString(Ssr);
    expect(html.match(/sui-otp__input/gu)).toHaveLength(4);
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="12"');
    expect(html).toContain("sui-otp__separator");
    expect(html).not.toContain("sui-popup");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, Ssr, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    expect(mismatches).toEqual([]);
    const inputs = otpInputs(container);
    expect(inputs.map((input) => input.value).join("")).toBe("12");
  });
});
