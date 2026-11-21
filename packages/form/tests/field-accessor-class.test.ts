import { describe, expect, it } from "vitest";
import { createEffect, flushSync } from "@ivlev-dev/silent-core";
import { Each, Field, Form } from "../src/index.js";

class Row {
  #sku = "";
  #qty = 0;

  get sku(): string {
    return this.#sku;
  }

  set sku(value: string) {
    this.#sku = value;
  }

  get qty(): number {
    return this.#qty;
  }

  set qty(value: number) {
    this.#qty = value;
  }
}

class OrderForm extends Form {
  @Field()
  @Each()
  public accessor rows: Row[] = [];
}

describe("@Field с массивом accessor-классов", () => {
  it("не оборачивает элементы в deepReactive и не ломает #private", () => {
    const form = new OrderForm();
    const row = new Row();
    row.sku = "A-1";
    row.qty = 2;
    form.rows = [row];

    expect(form.rows[0]).toBe(row);
    expect(form.rows[0]?.sku).toBe("A-1");
    expect(form.values.rows).toBeInstanceOf(Array);

    const values = form.values.rows as Row[];
    expect(values[0]).toBe(row);
    expect(values[0]?.sku).toBe("A-1");
    expect(form.getFieldProps("rows").value).toBe(form.rows);
  });

  it("пересчитывает form.values при замене массива", () => {
    const form = new OrderForm();
    const first = new Row();
    first.sku = "A-1";
    form.rows = [first];

    const seen: string[] = [];
    createEffect(() => {
      seen.push((form.values.rows as Row[])[0]?.sku ?? "");
    });
    flushSync();
    expect(seen.at(-1)).toBe("A-1");

    const second = new Row();
    second.sku = "B-2";
    form.rows = [second];
    flushSync();
    expect(seen.at(-1)).toBe("B-2");
    expect((form.values.rows as Row[])[0]).toBe(second);
  });

  it("проходит валидацию @Each без исключений", async () => {
    const form = new OrderForm();
    const row = new Row();
    row.sku = "A-1";
    form.rows = [row];

    await expect(form.validateField("rows")).resolves.toBe(true);
    await expect(form.validate()).resolves.toBe(true);
    expect(form.errors).toEqual({});
  });
});
