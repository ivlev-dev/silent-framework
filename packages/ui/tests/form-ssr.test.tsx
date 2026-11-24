import { afterEach, describe, expect, it } from "vitest";
import { hydrate } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { Checkbox, Select, TextField } from "../src/form/index.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

function SsrForm(): Node {
  return (
    <div>
      <TextField
        id="email"
        name="email"
        label="Email"
        hint="Рабочая почта"
        required
        value="user@example.com"
      />
      <Select
        id="role"
        name="role"
        label="Роль"
        options={[
          { value: "user", label: "Пользователь" },
          { value: "admin", label: "Администратор" },
        ]}
        value="admin"
      />
      <Checkbox id="agree" name="agree" label="Согласие" description="Условия" checked />
    </div>
  );
}

describe("SSR форм", () => {
  it("renderToString: value/selected/checked и стабильные id", async () => {
    const { html } = await renderToString(SsrForm);
    expect(html).toContain('id="email"');
    expect(html).toContain('value="user@example.com"');
    expect(html).toContain('aria-describedby="email-hint"');
    expect(html).toContain('id="email-hint"');
    expect(html).toContain('value="admin"');
    expect(html).toContain("selected");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).not.toContain("jsx(");
  });

  it("hydrate проходит без mismatch и сохраняет значения", async () => {
    const { html } = await renderToString(SsrForm);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, SsrForm, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    cleanups.push(() => handle.dispose());

    expect(mismatches).toEqual([]);
    const input = container.querySelector<HTMLInputElement>("#email");
    expect(input?.value).toBe("user@example.com");
    const select = container.querySelector<HTMLSelectElement>("#role");
    expect(select?.value).toBe("admin");
    const checkbox = container.querySelector<HTMLInputElement>("#agree");
    expect(checkbox?.checked).toBe(true);
  });

  it("multiple: SSR selected и гидрация без mismatch", async () => {
    function Multi(): Node {
      return (
        <Select
          id="roles"
          name="roles"
          multiple
          options={[
            { value: "user", label: "Пользователь" },
            { value: "admin", label: "Администратор" },
          ]}
          value={["user", "admin"]}
        />
      );
    }
    const { html } = await renderToString(Multi);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, Multi, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    cleanups.push(() => handle.dispose());
    expect(mismatches).toEqual([]);
    const select = container.querySelector<HTMLSelectElement>("#roles");
    expect(Array.from(select?.selectedOptions ?? []).map((option) => option.value)).toEqual([
      "user",
      "admin",
    ]);
  });

  it("повторный рендер даёт тот же html (детерминированные id)", async () => {
    const first = await renderToString(SsrForm);
    const second = await renderToString(SsrForm);
    expect(second.html).toBe(first.html);
  });
});
