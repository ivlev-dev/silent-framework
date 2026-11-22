import { describe, expect, it } from "vitest";
import {
  Custom,
  Field,
  Form,
  FormWizard,
  Required,
  uploadField,
} from "../src/index.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class ItemForm extends Form {
  @Field()
  public accessor name = "";
}

class ListForm extends Form {
  @Field()
  public accessor title = "list";

  @Field({ array: () => new ItemForm() })
  public accessor items: ItemForm[] = [];
}

describe("P1: устаревший прогон проверки возвращает false", () => {
  class GenerationForm extends Form {
    @Field()
    @Required()
    public accessor name = "ok";

    @Field()
    @Custom(async (value: unknown) => {
      await delay(10);
      return value !== "bad";
    })
    public accessor code = "ok";
  }

  it("validate() не читает isValid чужого поколения", async () => {
    const form = new GenerationForm();
    await Promise.resolve();

    const pending = form.validate();
    form.name = "";

    await expect(pending).resolves.toBe(false);
    expect(form.errors).toEqual({});
    expect(form.isReady).toBe(false);
  });

  it("validateField() старого поколения разрешается в false", async () => {
    const form = new GenerationForm();
    await Promise.resolve();

    const pending = form.validateField("code");
    form.code = "bad";

    await expect(pending).resolves.toBe(false);
  });

  it("runFormArrayValidation старого поколения разрешается в false", async () => {
    const form = new ListForm();
    form.getFieldArray("items").add();

    const pending = form.validateField("items");
    form.title = "changed";

    await expect(pending).resolves.toBe(false);
  });
});

describe("P2.1: setValue элемента массива заменяет элемент", () => {
  it("пишет новый элемент, сохраняет путь и проверяет владение", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    const original = array.add();
    original.name = "A";

    const replacement = new ItemForm();
    replacement.name = "B";

    form.getFieldProps("items[0]").setValue(replacement);

    expect(array.at(0)).toBe(replacement);
    expect(form.getFieldProps("items[0].name").value).toBe("B");
    expect(form.values.items).toEqual([{ name: "B" }]);
    expect(form.isDirty).toBe(true);

    const owner = new ListForm();
    const shared = new ItemForm();
    owner.getFieldArray("items").add(shared);

    const target = new ListForm();
    const targetArray = target.getFieldArray("items");
    const own = targetArray.add();
    expect(() => target.getFieldProps("items[0]").setValue(shared)).toThrow(
      /уже используется как поле формы/,
    );
    expect(targetArray.at(0)).toBe(own);
  });
});

describe("P2.2: ошибки уровня элемента не дублируются", () => {
  it("direct-ошибки массива отделены от ошибок элементов", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    array.add();

    form.setFieldErrors("items[0]", "Ошибка элемента");

    expect(form.getFieldProps("items").errors).toEqual(["Ошибка элемента"]);
    expect(array.ownErrors).toEqual([]);
    expect(array.errors["items[0]"]).toEqual(["Ошибка элемента"]);

    form.setFieldErrors("items", "Ошибка массива");

    expect(array.ownErrors).toEqual(["Ошибка массива"]);
    expect(array.errors.items).toEqual(["Ошибка массива"]);
    expect(form.getFieldProps("items").errors).toEqual([
      "Ошибка массива",
      "Ошибка элемента",
    ]);
  });
});

describe("P2.3: конкурентные переходы FormWizard", () => {
  class StepForm extends Form {
    @Field()
    public accessor name = "ok";
  }

  it("два next() не перескакивают шаг", async () => {
    const wizard = new FormWizard([new StepForm(), new StepForm(), new StepForm()]);

    const [first, second] = await Promise.all([wizard.next(), wizard.next()]);

    expect(wizard.index).toBe(1);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("два goTo() не перескакивают шаг", async () => {
    const wizard = new FormWizard([new StepForm(), new StepForm(), new StepForm()]);

    const [first, second] = await Promise.all([
      wizard.goTo(1),
      wizard.goTo(2),
    ]);

    expect(wizard.index).toBe(1);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe("P2.4: конкурентные uploadField", () => {
  class FileForm extends Form {
    @Field()
    public accessor file = "";
  }

  it("поздний результат старой загрузки не перетирает новую", async () => {
    const form = new FileForm();
    const field = form.getFieldProps("file");
    const first = deferred<string>();
    const second = deferred<string>();

    const firstUpload = uploadField(
      form,
      "file",
      new File(["1"], "1.txt"),
      () => first.promise,
    );
    const secondUpload = uploadField(
      form,
      "file",
      new File(["2"], "2.txt"),
      () => second.promise,
    );

    second.resolve("new.txt");
    await secondUpload;
    expect(field.value).toBe("new.txt");
    expect(field.isReady).toBe(true);

    first.resolve("old.txt");
    await firstUpload;

    expect(field.value).toBe("new.txt");
    expect(field.isReady).toBe(true);
  });

  it("старая загрузка не снимает isReady, пока идёт новая", async () => {
    const form = new FileForm();
    const field = form.getFieldProps("file");
    const first = deferred<string>();
    const second = deferred<string>();

    const firstUpload = uploadField(
      form,
      "file",
      new File(["1"], "1.txt"),
      () => first.promise,
    );
    const secondUpload = uploadField(
      form,
      "file",
      new File(["2"], "2.txt"),
      () => second.promise,
    );

    first.resolve("old.txt");
    await firstUpload;
    expect(field.isReady).toBe(false);

    second.resolve("new.txt");
    await secondUpload;
    expect(field.value).toBe("new.txt");
    expect(field.isReady).toBe(true);
  });

  it("отменённая загрузка не пишет результат", async () => {
    const form = new FileForm();
    const field = form.getFieldProps("file");
    const controller = new AbortController();

    const pending = uploadField(
      form,
      "file",
      new File(["1"], "1.txt"),
      async () => "late.txt",
      { signal: controller.signal },
    );
    controller.abort();

    await pending;

    expect(field.value).toBe("");
    expect(field.isReady).toBe(true);
  });
});

describe("P2.5: setReady элемента массива влияет на агрегаты", () => {
  it("props.isReady, FormArray.isReady и form.isReady учитывают элемент", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    array.add().name = "ok";

    expect(form.isReady).toBe(true);

    form.getFieldProps("items[0]").setReady(false);

    expect(form.getFieldProps("items[0]").isReady).toBe(false);
    expect(form.getFieldProps("items[0].name").isReady).toBe(false);
    expect(array.isReady).toBe(false);
    expect(form.isReady).toBe(false);

    form.getFieldProps("items[0]").setReady(true);

    expect(form.getFieldProps("items[0]").isReady).toBe(true);
    expect(form.getFieldProps("items[0].name").isReady).toBe(true);
    expect(array.isReady).toBe(true);
    expect(form.isReady).toBe(true);
  });
});

describe("P2.6: снимки с полем __proto__", () => {
  class ProtoForm extends Form {
    @Field()
    public accessor ["__proto__"] = "value";
  }

  it("values и errors сохраняют поле и не меняют прототип", () => {
    const form = new ProtoForm();

    const values = form.values;
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(values, "__proto__")).toBe(true);
    expect((values as Record<string, unknown>)["__proto__"]).toBe("value");

    form.setFieldErrors("__proto__" as never, "Ошибка");

    const errors = form.errors;
    expect(Object.getPrototypeOf(errors)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(errors, "__proto__")).toBe(true);
    expect(errors["__proto__"]).toEqual(["Ошибка"]);
  });
});

describe("P2.7: syncChildren не инвалидирует неизменный массив", () => {
  it("повторные агрегатные чтения сохраняют props-кэш", () => {
    const form = new ListForm();
    form.getFieldArray("items").add().name = "A";

    const props = form.getFieldProps("items[0].name");

    void form.values;
    void form.values;
    void form.isReady;
    void form.errors;

    expect(form.getFieldProps("items[0].name")).toBe(props);
  });
});
