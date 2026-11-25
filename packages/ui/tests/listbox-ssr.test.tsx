import { afterEach, describe, expect, it } from "vitest";
import { flushSync, hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { Combobox } from "../src/form/combobox/index.js";
import { Select, type SelectItem } from "../src/form/select/index.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

function flush(): void {
  flushSync();
  flushSync();
}

const options: readonly SelectItem[] = [
  { value: "a", label: "Альфа" },
  { value: "b", label: "Бета" },
];

function CustomSelectOnly(): Node {
  return (
    <div>
      <Select
        id="role"
        name="role"
        label="Роль"
        placeholder="Выберите"
        options={options}
        value="b"
      />
    </div>
  );
}

function CustomMultiSelectOnly(): Node {
  return (
    <Select
      id="roles"
      name="roles"
      multiple
      options={options}
      value={["a", "b"]}
    />
  );
}

function ComboboxOnly(): Node {
  return (
    <Combobox
      id="city"
      name="city"
      label="Город"
      options={options}
      value="a"
    />
  );
}

describe("SSR закрытых listbox-контролов", () => {
  it("Select custom: только триггер и hidden input, без панели и опций", async () => {
    const { html } = await renderToString(CustomSelectOnly);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('name="role"');
    expect(html).toContain('value="b"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain("sui-popup");
    expect(html).not.toContain("role=\"option\"");
    // aria-controls появляется только после mount.
    expect(html).not.toContain("aria-controls");
  });

  it("Select custom: гидрация без mismatch, затем панель открывается", async () => {
    const { html } = await renderToString(CustomSelectOnly);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, CustomSelectOnly, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    flush();
    expect(mismatches).toEqual([]);
    expect(container.querySelector('input[type="hidden"]')?.getAttribute("value")).toBe("b");
    expect(container.querySelector(".sui-popup")).toBeNull();

    const control = container.querySelector<HTMLElement>(".sui-select__control");
    expect(control).not.toBeNull();
    expect(control?.getAttribute("aria-controls")).toBe("role-listbox");
    control?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();
    const rows = Array.from(container.querySelectorAll('[role="option"]'));
    expect(rows).toHaveLength(2);
    expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("Select multi: повторяющиеся hidden inputs на SSR", async () => {
    const { html } = await renderToString(CustomMultiSelectOnly);
    const matches = [...html.matchAll(/<input[^>]*name="roles"[^>]*>/gu)].map(
      (match) => match[0],
    );
    expect(matches).toHaveLength(2);
    expect(matches[0]).toContain('value="a"');
    expect(matches[1]).toContain('value="b"');
    expect(html).not.toContain('role="listbox"');
  });

  it("Combobox: закрытый input + hidden input, без списка", async () => {
    const { html } = await renderToString(ComboboxOnly);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('name="city"');
    expect(html).toContain('value="a"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain("sui-popup");
  });

  it("Combobox: гидрация без mismatch", async () => {
    const { html } = await renderToString(ComboboxOnly);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, ComboboxOnly, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    cleanups.push(() => handle.dispose());
    flush();
    expect(mismatches).toEqual([]);
    const input = container.querySelector<HTMLInputElement>(".sui-combobox__input");
    expect(input?.value).toBe("Альфа");
  });

  it("детерминированные id панели и опций повторяемы", async () => {
    const first = await renderToString(CustomSelectOnly);
    const second = await renderToString(CustomSelectOnly);
    expect(second.html).toBe(first.html);
  });
});
