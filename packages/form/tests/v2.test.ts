import { describe, expect, it, vi } from "vitest";
import { flushSync, storeFor } from "@ivlev-dev/silent-core";
import {
  Field,
  Form,
  FormWizard,
  beforeUnloadGuard,
  createDirtyGuard,
  onDirtyChange,
  uploadField,
} from "../src/index.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

describe("массивы v2: фабрика элементов", () => {
  class ItemForm extends Form {
    @Field()
    public accessor name = "";
  }

  class ListForm extends Form {
    @Field({ array: () => new ItemForm() })
    public accessor items: ItemForm[] = [];
  }

  it("add/insert без аргумента используют фабрику", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    const first = array.add();
    const second = array.insert(0);
    expect(first).toBeInstanceOf(ItemForm);
    expect(second).toBeInstanceOf(ItemForm);
    expect(array.length).toBe(2);
    expect(array.at(0)).toBe(second);
  });

  it("getFieldArray(path, factory) запоминает фабрику", () => {
    class PlainListForm extends Form {
      @Field()
      public accessor items: ItemForm[] = [];
    }

    const form = new PlainListForm();
    const array = form.getFieldArray("items", () => new ItemForm());
    expect(array.add()).toBeInstanceOf(ItemForm);
  });

  it("без фабрики add() бросает понятную ошибку", () => {
    class PlainListForm extends Form {
      @Field()
      public accessor items: ItemForm[] = [];
    }

    const form = new PlainListForm();
    const array = form.getFieldArray("items");
    expect(() => array.add()).toThrow(/Нет фабрики элементов/);
  });

  it("errors включает ошибки корня массива и ownErrors", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    form.setFieldErrors("items", "Слишком много");
    expect(array.ownErrors).toEqual(["Слишком много"]);
    expect(array.errors.items).toEqual(["Слишком много"]);
  });
});

describe("массивы v2: setValues resize", () => {
  class ItemForm extends Form {
    @Field()
    public accessor name = "";
  }

  class ListForm extends Form {
    @Field({ array: () => new ItemForm() })
    public accessor items: ItemForm[] = [];
  }

  it("создаёт недостающие, обновляет существующие и удаляет лишние", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    array.add().name = "A";
    array.add().name = "B";

    form.setValues({ items: [{ name: "A1" }, { name: "B1" }, { name: "C1" }] });
    expect(array.length).toBe(3);
    expect(array.items.map((item) => item.name)).toEqual(["A1", "B1", "C1"]);

    const removed = array.items[2]!;
    form.setValues({ items: [{ name: "A2" }] });
    expect(array.length).toBe(1);
    expect(array.items[0]!.name).toBe("A2");
    expect(storeFor(removed).disposed).toBe(true);
  });

  it("принимает Form-экземпляры", () => {
    const form = new ListForm();
    const array = form.getFieldArray("items");
    array.add();
    const replacement = new ItemForm();
    replacement.name = "R";
    form.setValues({ items: [replacement] });
    expect(array.items[0]).toBe(replacement);
  });

  it("создаёт элементы из пустого массива при наличии фабрики", () => {
    const form = new ListForm();
    form.setValues({ items: [{ name: "A" }, { name: "B" }] });
    const array = form.getFieldArray("items");
    expect(array.length).toBe(2);
    expect(array.items.map((item) => item.name)).toEqual(["A", "B"]);
  });

  it("без фабрики длина не меняется", () => {
    class PlainListForm extends Form {
      @Field()
      public accessor items: ItemForm[] = [];
    }

    const form = new PlainListForm();
    const array = form.getFieldArray("items");
    array.add(new ItemForm()).name = "A";
    form.setValues({ items: [{ name: "B" }, { name: "C" }] });
    expect(array.length).toBe(1);
    expect(array.items[0]!.name).toBe("B");

    form.setValues({ items: [] });
    expect(array.length).toBe(1);
  });
});

describe("FormWizard", () => {
  class StepForm extends Form {
    @Field()
    public accessor name = "";
  }

  it("переходы, блокировка и validateAll", async () => {
    const first = new StepForm();
    const second = new StepForm();
    const wizard = new FormWizard([first, second]);

    expect(wizard.isFirst).toBe(true);
    expect(wizard.current).toBe(first);
    expect(await wizard.next()).toBe(true);
    expect(wizard.index).toBe(1);
    expect(wizard.isLast).toBe(true);
    wizard.back();
    expect(wizard.index).toBe(0);

    first.setFieldErrors("name", "Шаг невалиден");
    expect(await wizard.next()).toBe(false);
    expect(wizard.index).toBe(0);

    first.clearFieldErrors("name");
    expect(await wizard.goTo(1)).toBe(true);
    expect(wizard.index).toBe(1);
    expect(await wizard.goTo(0)).toBe(true);

    second.setFieldErrors("name", "Второй шаг невалиден");
    expect(await wizard.validateAll()).toBe(false);
    expect(wizard.errors.name).toEqual(["Второй шаг невалиден"]);
    expect(wizard.isDirty).toBe(false);
  });

  it("validateStep:false переходит без проверки", async () => {
    const first = new StepForm();
    const second = new StepForm();
    const wizard = new FormWizard([first, second], { validateStep: false });
    first.setFieldErrors("name", "Ошибка");
    expect(await wizard.next()).toBe(true);
    expect(wizard.index).toBe(1);
  });

  it("isReady/isDirty и dispose не освобождает шаги", () => {
    const first = new StepForm();
    const second = new StepForm();
    const wizard = new FormWizard([first, second]);
    expect(wizard.isReady).toBe(true);
    first.getFieldProps("name").setValue("a");
    expect(wizard.isDirty).toBe(true);
    expect(wizard.values()).toEqual({
      0: { name: "a" },
      1: { name: "" },
    });
    wizard.dispose();
    expect(storeFor(first).disposed).toBe(false);
  });
});

describe("dirty guard", () => {
  class GuardForm extends Form {
    @Field()
    public accessor name = "";
  }

  it("onDirtyChange и createDirtyGuard реактивны", () => {
    const form = new GuardForm();
    const seen: boolean[] = [];
    const stop = onDirtyChange(form, (dirty) => seen.push(dirty));
    const guard = createDirtyGuard(form);
    flushSync();
    expect(seen).toEqual([false]);
    expect(guard.canLeave()).toBe(true);

    form.getFieldProps("name").setValue("a");
    flushSync();
    expect(seen).toEqual([false, true]);
    expect(guard.isDirty).toBe(true);
    expect(guard.canLeave()).toBe(false);

    stop();
    guard.dispose();
    form.reset();
    flushSync();
    expect(seen).toEqual([false, true]);
  });

  it("beforeUnloadGuard слушает только пока dirty", () => {
    const form = new GuardForm();
    const stop = beforeUnloadGuard(form, { message: "Unsaved" });
    flushSync();

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    form.getFieldProps("name").setValue("a");
    flushSync();
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    form.reset();
    flushSync();
    const afterReset = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterReset);
    expect(afterReset.defaultPrevented).toBe(false);

    stop();
  });

  it("SSR-safe без window", () => {
    const form = new GuardForm();
    vi.stubGlobal("window", undefined);
    try {
      const stop = beforeUnloadGuard(form);
      expect(() => stop()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("uploadField", () => {
  class FileForm extends Form {
    @Field()
    public accessor file = "";
  }

  it("помечает поле неготовым, пишет результат и прогресс", async () => {
    const form = new FileForm();
    const field = form.getFieldProps("file");
    const progress: number[] = [];
    let readyDuringUpload: boolean | undefined;

    const result = await uploadField(
      form,
      "file",
      new File(["x"], "x.txt"),
      async (_file, context) => {
        readyDuringUpload = field.isReady;
        context.onProgress(50);
        await delay(1);
        return "uploaded.txt";
      },
      { onProgress: (value) => progress.push(value) },
    );

    expect(readyDuringUpload).toBe(false);
    expect(result).toBe("uploaded.txt");
    expect(field.value).toBe("uploaded.txt");
    expect(field.isReady).toBe(true);
    expect(progress).toEqual([50]);
  });
});
