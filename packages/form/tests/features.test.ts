import { describe, expect, it, vi } from "vitest";
import { storeFor } from "@ivlev-dev/silent-core";
import {
  Field,
  Form,
  FormField,
  Required,
} from "../src/index.js";

const SCHEMA_SYMBOL = Symbol.for("silent.validation.schema");

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

describe("схемная валидация", () => {
  it("подхватывает схему ValidationModel и отключается types:false", async () => {
    class TypedForm extends Form {
      @Field()
      public accessor age = 0;
    }

    Object.defineProperty(TypedForm, SCHEMA_SYMBOL, {
      configurable: true,
      value: { version: 1, fields: { age: "string" } },
    });

    const form = new TypedForm();
    expect(await form.validate()).toBe(false);
    expect(form.errors.age?.[0]).toContain("age");
    expect(form.getFieldProps("age").isValid).toBe(false);

    expect(await form.validate({ types: false })).toBe(true);
    expect(form.errors.age).toBeUndefined();
  });
});

describe("setErrors", () => {
  class AddressForm extends Form {
    @Field()
    public accessor city = "";
  }

  class ItemForm extends Form {
    @Field()
    public accessor name = "";
  }

  class RootForm extends Form {
    @Field()
    public accessor email = "";

    @FormField()
    public accessor address = new AddressForm();

    @Field()
    public accessor items: ItemForm[] = [];
  }

  it("принимает вложенные и bracket-пути, заменяя набор целиком", () => {
    const form = new RootForm();
    form.getFieldArray("items").add(new ItemForm());

    form.setErrors({
      email: "E",
      "address.city": ["C1", "C2"],
      "items[0].name": "N",
    });

    expect(form.errors.email).toEqual(["E"]);
    expect(form.errors["address.city"]).toEqual(["C1", "C2"]);
    expect(form.errors["items[0].name"]).toEqual(["N"]);
    expect(form.getFieldProps("address.city").errors).toEqual(["C1", "C2"]);

    form.setErrors({ email: "E2" });
    expect(form.errors.email).toEqual(["E2"]);
    expect(form.errors["address.city"]).toBeUndefined();
    expect(form.errors["items[0].name"]).toBeUndefined();
  });
});

describe("массивы повторяемых форм", () => {
  class ItemForm extends Form {
    @Field()
    @Required()
    public accessor name = "";

    @Field()
    public accessor city = "";
  }

  class ListForm extends Form {
    @Field()
    public accessor title = "list";

    @Field()
    public accessor items: ItemForm[] = [];
  }

  it("add/insert/remove/move/clear и пути", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    const first = array.add(new ItemForm());
    first.name = "A";
    const second = array.insert(0, new ItemForm());
    second.name = "B";

    expect(array.items.map((item) => item.name)).toEqual(["B", "A"]);
    expect(array.length).toBe(2);
    expect(form.getFieldProps("items[0].name").value).toBe("B");
    expect(form.values.items).toEqual([
      { name: "B", city: "" },
      { name: "A", city: "" },
    ]);

    array.move(1, 0);
    expect(array.items.map((item) => item.name)).toEqual(["A", "B"]);
    expect(form.getFieldProps("items[0].name").value).toBe("A");

    array.remove(0);
    expect(array.length).toBe(1);
    expect(array.at(0)).toBe(second);
    expect(storeFor(first).disposed).toBe(true);

    const third = array.add(new ItemForm());
    third.name = "C";
    array.clear();
    expect(array.length).toBe(0);
    expect(storeFor(second).disposed).toBe(true);
    expect(storeFor(third).disposed).toBe(true);
  });

  it("агрегирует ошибки, isReady и валидирует элементы", async () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    const first = array.add(new ItemForm());
    const second = array.add(new ItemForm());
    first.name = "A";

    expect(form.isReady).toBe(false);
    expect(await form.validate()).toBe(false);
    expect(form.errors["items[1].name"]?.length).toBeGreaterThan(0);
    expect(form.getFieldProps("items").errors.length).toBeGreaterThan(0);
    expect(form.getFieldProps("items[0].name").isValid).toBe(true);

    second.name = "B";
    expect(await form.validate()).toBe(true);
    expect(form.isReady).toBe(true);

    second.getFieldProps("name").setReady(false);
    expect(array.isReady).toBe(false);
    second.getFieldProps("name").setReady(true);
    expect(array.isReady).toBe(true);
  });

  it("submit проверяет все элементы", async () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    array.add(new ItemForm());
    const callback = vi.fn();

    await form.onSubmit(callback)();
    expect(callback).not.toHaveBeenCalled();
    expect(form.errors["items[0].name"]?.length).toBeGreaterThan(0);
  });

  it("id элемента совпадает при доступе из родителя и элемента", () => {
    const form = new ListForm({ formId: "list" });
    const item = form.getFieldArray("items").add(new ItemForm());
    expect(form.getFieldProps("items[0].city").id).toBe("list-items[0].city");
    expect(item.getFieldProps("city").id).toBe("list-items[0].city");
  });

  it("конфликт владения не меняет массив", () => {
    const shared = new ItemForm();
    const owner = new ListForm();
    owner.getFieldArray("items").add(shared);

    const form = new ListForm();
    const array = form.getFieldArray("items");
    const own = array.add(new ItemForm());
    expect(() => array.add(shared)).toThrow(/уже используется как поле формы/);
    expect(array.length).toBe(1);
    expect(array.at(0)).toBe(own);
  });

  it("reset восстанавливает длину и освобождает новые элементы", async () => {
    class InitialListForm extends Form {
      @Field()
      public accessor items: ItemForm[] = [new ItemForm()];
    }

    const form = new InitialListForm();
    await Promise.resolve();
    const array = form.getFieldArray("items");
    const original = array.at(0)!;
    original.name = "initial";
    const extra = array.add(new ItemForm());
    extra.name = "extra";

    form.reset();

    expect(form.getFieldArray("items").length).toBe(1);
    expect(form.getFieldArray("items").at(0)).toBe(original);
    expect(original.name).toBe("");
    expect(storeFor(extra).disposed).toBe(true);
  });

  it("remove/clear эталонного элемента не освобождают его до reset/dispose", async () => {
    class InitialListForm extends Form {
      @Field()
      public accessor items: ItemForm[] = [new ItemForm()];
    }

    const form = new InitialListForm();
    await Promise.resolve();
    const array = form.getFieldArray("items");
    const baseline = array.at(0)!;

    array.remove(0);
    expect(storeFor(baseline).disposed).toBe(false);

    form.reset();
    expect(array.at(0)).toBe(baseline);
    baseline.name = "after-reset";
    expect(form.values.items).toEqual([{ name: "after-reset", city: "" }]);
    expect(await form.validate()).toBe(true);

    const added = array.add(new ItemForm());
    array.clear();
    expect(storeFor(added).disposed).toBe(true);
    expect(storeFor(baseline).disposed).toBe(false);

    form.reset();
    expect(array.at(0)).toBe(baseline);

    array.remove(0);
    form.dispose();
    expect(storeFor(baseline).disposed).toBe(true);
  });

  it("dispose освобождает все элементы", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    const first = array.add(new ItemForm());
    const second = array.add(new ItemForm());

    form.dispose();

    expect(storeFor(first).disposed).toBe(true);
    expect(storeFor(second).disposed).toBe(true);
  });

  it("setValues обновляет существующие элементы и не расширяет массив", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    array.add(new ItemForm());
    array.add(new ItemForm());

    form.setValues({ items: [{ name: "A" }, { name: "B" }] });
    expect(array.items.map((item) => item.name)).toEqual(["A", "B"]);

    form.setValues({ items: [{ name: "C" }, { name: "D" }, { name: "E" }] });
    expect(array.length).toBe(2);
    expect(array.items.map((item) => item.name)).toEqual(["C", "D"]);
  });
});

describe("autoSave", () => {
  class AutoForm extends Form {
    @Field()
    public accessor name = "";
  }

  it("вызывает обработчик после изменений и останавливается", async () => {
    const form = new AutoForm();
    const handler = vi.fn();
    const stop = form.autoSave(handler, { debounceMs: 5 });

    form.getFieldProps("name").setValue("a");
    await delay(30);
    expect(handler).toHaveBeenCalledOnce();

    form.getFieldProps("name").setValue("b");
    await delay(30);
    expect(handler).toHaveBeenCalledTimes(2);

    stop();
    form.getFieldProps("name").setValue("c");
    await delay(30);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
