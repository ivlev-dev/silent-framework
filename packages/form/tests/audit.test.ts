import { describe, expect, it, vi } from "vitest";
import {
  Custom,
  Each,
  Field,
  Form,
  FormField,
  IsEmail,
  Optional,
  Required,
  ValidateIf,
  ValidateOn,
} from "../src/index.js";

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

describe("isReady и условия поля", () => {
  it("Required + ValidateIf(false) не требует значение и пропускает submit", async () => {
    class ConditionalForm extends Form {
      @Field()
      @Required()
      @ValidateIf(() => false)
      public accessor name = "";
    }

    const form = new ConditionalForm();
    expect(form.isReady).toBe(true);
    expect(form.getFieldProps("name").isRequired).toBe(true);

    const callback = vi.fn();
    await form.onSubmit(callback)();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("Required + ValidateIf(true) требует непустое значение", () => {
    class ActiveForm extends Form {
      @Field()
      @Required()
      @ValidateIf(() => true)
      public accessor name = "";
    }

    const form = new ActiveForm();
    expect(form.isReady).toBe(false);
    form.name = "Иван";
    expect(form.isReady).toBe(true);
  });

  it("Required + Optional не требует undefined и null", () => {
    class OptionalForm extends Form {
      @Field()
      @Required()
      @Optional()
      public accessor nickname: string | undefined = undefined;

      @Field()
      @Required()
      @Optional()
      public accessor alias: string | null = null;
    }

    const form = new OptionalForm();
    expect(form.isReady).toBe(true);
    expect(form.getFieldProps("nickname").isRequired).toBe(true);

    form.nickname = "";
    expect(form.isReady).toBe(false);
  });

  it("асинхронное условие считается активным", () => {
    const predicate = (() =>
      Promise.resolve(false)) as unknown as (form: object) => boolean;

    class AsyncConditionForm extends Form {
      @Field()
      @Required()
      @ValidateIf(predicate)
      public accessor name = "";
    }

    expect(new AsyncConditionForm().isReady).toBe(false);
  });

  it("обычный Required с пустым значением не готов", () => {
    class RequiredForm extends Form {
      @Field()
      @Required()
      public accessor name = "";
    }

    expect(new RequiredForm().isReady).toBe(false);
  });
});

describe("поля без @Field", () => {
  it("validate возвращает false, сохраняет ошибку и сообщает диагностику один раз", async () => {
    class NoFieldForm extends Form {
      @IsEmail()
      public accessor email = "bad";
    }

    const onError = vi.fn();
    const form = new NoFieldForm({ onError });

    expect(await form.validate()).toBe(false);
    expect(form.errors.email?.length).toBeGreaterThan(0);
    expect(form.isValid).toBe(false);
    expect(form.isReady).toBe(false);
    expect(onError).toHaveBeenCalledOnce();

    expect(await form.validate()).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("без onError пишет предупреждение", async () => {
    class NoFieldForm extends Form {
      @IsEmail()
      public accessor email = "bad";
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await new NoFieldForm().validate();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("@Required без @Field бросает TypeError при инициализации", () => {
    class BrokenForm extends Form {
      @Required()
      public accessor name = "";
    }

    const form = new BrokenForm();
    expect(() => form.values).toThrow(/должно быть помечено @Field/);
  });
});

class SlowForm extends Form {
  @Field()
  @Custom(async (value: unknown) => {
    const text = typeof value === "string" ? value : "";
    await delay(text === "bad" ? 30 : 5);
    return text !== "bad";
  })
  public accessor code = "";
}

describe("дедупликация проверок", () => {
  it("параллельные validate() возвращают один промис и один проход", async () => {
    const calls = vi.fn();
    class CountingForm extends Form {
      @Field()
      @Custom(async () => {
        calls();
        await delay(10);
        return true;
      })
      public accessor name = "ok";
    }

    const form = new CountingForm();
    const first = form.validate();
    const second = form.validate();

    expect(second).toBe(first);
    await first;
    expect(calls).toHaveBeenCalledOnce();
  });

  it("параллельные validateField() для одного пути возвращают один промис", async () => {
    const calls = vi.fn();
    class CountingForm extends Form {
      @Field()
      @Custom(async () => {
        calls();
        await delay(10);
        return true;
      })
      public accessor name = "ok";
    }

    const form = new CountingForm();
    const first = form.validateField("name");
    const second = form.validateField("name");

    expect(second).toBe(first);
    await first;
    expect(calls).toHaveBeenCalledOnce();

    const other = form.validateField("name");
    expect(other).not.toBe(first);
    await other;
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("вложенная форма не проверяется дважды", async () => {
    const childCalls = vi.fn();
    class ChildForm extends Form {
      @Field()
      @Custom(async () => {
        childCalls();
        await delay(15);
        return true;
      })
      public accessor email = "ok";
    }

    class ParentForm extends Form {
      @FormField()
      public accessor child = new ChildForm();
    }

    const form = new ParentForm();
    const first = form.validate();
    await delay(1);
    const second = form.validate();

    expect(second).toBe(first);
    await first;
    expect(childCalls).toHaveBeenCalledOnce();
  });
});

describe("поколения валидации", () => {
  it("изменение значения отцепляет старый прогон и запускает новый", async () => {
    const form = new SlowForm();
    await Promise.resolve();
    form.code = "bad";
    const first = form.validate();
    form.code = "good";
    const second = form.validate();

    expect(second).not.toBe(first);
    await Promise.all([first, second]);

    expect(form.isValid).toBe(true);
    expect(form.errors).toEqual({});
  });

  it("изменение значения во время validateField запускает новый прогон", async () => {
    const form = new SlowForm();
    await Promise.resolve();
    form.code = "bad";
    const first = form.validateField("code");
    form.getFieldProps("code").setValue("good");
    const second = form.validateField("code");

    expect(second).not.toBe(first);
    await Promise.all([first, second]);

    expect(form.isValid).toBe(true);
    expect(form.errors).toEqual({});
  });

  it("reset во время validateField не оставляет ошибок", async () => {
    const form = new SlowForm();
    await Promise.resolve();
    form.getFieldProps("code").setValue("bad");
    const pending = form.validateField("code");
    form.reset();
    await pending;

    expect(form.errors).toEqual({});
    expect(form.isValid).toBe(true);

    const fresh = form.validateField("code");
    expect(fresh).not.toBe(pending);
    expect(await fresh).toBe(true);
  });

  it("reset во время validate не оставляет ошибок", async () => {
    const form = new SlowForm();
    await Promise.resolve();
    form.getFieldProps("code").setValue("bad");
    const pending = form.validate();
    form.reset();
    await pending;

    expect(form.errors).toEqual({});
    expect(form.isValid).toBe(true);

    const fresh = form.validate();
    expect(fresh).not.toBe(pending);
    expect(await fresh).toBe(true);
  });

  it("dispose во время validate не пишет ошибки", async () => {
    const form = new SlowForm();
    form.code = "bad";
    const pending = form.validate();
    form.dispose();
    await pending;

    expect(form.errors).toEqual({});
  });

  it("dispose во время onSubmit не вызывает callback", async () => {
    class SubmitForm extends Form {
      @Field()
      @Custom(async () => {
        await delay(20);
        return true;
      })
      public accessor name = "ok";
    }

    const form = new SubmitForm();
    const callback = vi.fn();
    const pending = form.onSubmit(callback)();
    form.dispose();
    await pending;

    expect(callback).not.toHaveBeenCalled();
    expect(form.isSubmitting).toBe(false);
  });
});

describe("вложенный submit", () => {
  it("проверяет @ValidateOn('submit') в дочерней форме при validateOnSubmit: false", async () => {
    class EmailForm extends Form {
      @Field()
      @IsEmail()
      @ValidateOn("submit")
      public accessor email = "bad";
    }

    class ContactForm extends Form {
      @FormField()
      public accessor contact = new EmailForm();
    }

    const form = new ContactForm({ validateOnSubmit: false });
    const callback = vi.fn();
    await form.onSubmit(callback)();

    expect(callback).not.toHaveBeenCalled();
    expect(form.errors["contact.email"]?.length).toBeGreaterThan(0);
  });

  it("проверяет дочернюю форму без собственного @ValidateOn", async () => {
    class EmailForm extends Form {
      @Field()
      @IsEmail()
      @ValidateOn("submit")
      public accessor email = "bad";
    }

    class MiddleForm extends Form {
      @FormField()
      public accessor email = new EmailForm();
    }

    class RootForm extends Form {
      @FormField()
      public accessor middle = new MiddleForm();
    }

    const form = new RootForm({ validateOnSubmit: false });
    const callback = vi.fn();
    await form.onSubmit(callback)();

    expect(callback).not.toHaveBeenCalled();
    expect(form.errors["middle.email.email"]?.length).toBeGreaterThan(0);
  });
});

describe("исходные значения", () => {
  it("снимает эталон после тела конструктора", async () => {
    class ConstructorForm extends Form {
      @Field()
      public accessor name = "field";

      constructor(initial: string) {
        super();
        this.name = initial;
      }
    }

    const form = new ConstructorForm("ctor");
    await Promise.resolve();
    form.name = "changed";
    form.reset();
    expect(form.name).toBe("ctor");
  });

  it("fallback в reset снимает эталон без микрозадачи", () => {
    class ConstructorForm extends Form {
      @Field()
      public accessor name = "field";

      constructor(initial: string) {
        super();
        this.name = initial;
      }
    }

    const form = new ConstructorForm("ctor");
    form.reset();
    expect(form.name).toBe("ctor");
  });

  it("reset каждый раз пишет свежую копию массива", async () => {
    class TagsForm extends Form {
      @Field()
      public accessor tags = ["a"];
    }

    const form = new TagsForm();
    await Promise.resolve();
    form.tags.push("b");
    form.reset();
    expect(form.tags).toEqual(["a"]);

    form.tags.push("c");
    form.reset();
    expect(form.tags).toEqual(["a"]);
  });

  it("копирует Map, Set и Date", async () => {
    class CollectionsForm extends Form {
      @Field()
      public accessor map = new Map<string, number>([["a", 1]]);

      @Field()
      public accessor set = new Set<string>(["a"]);

      @Field()
      public accessor at = new Date(0);
    }

    const form = new CollectionsForm();
    await Promise.resolve();
    form.map.set("b", 2);
    form.set.add("b");
    form.at.setTime(1000);
    form.reset();

    expect([...form.map]).toEqual([["a", 1]]);
    expect([...form.set]).toEqual(["a"]);
    expect(form.at.getTime()).toBe(0);

    const map = form.map;
    const set = form.set;
    const at = form.at;
    form.reset();
    expect(form.map).not.toBe(map);
    expect(form.set).not.toBe(set);
    expect(form.at).not.toBe(at);
  });

  it("учитывает override поля в подклассе", async () => {
    class BaseForm extends Form {
      @Field()
      public accessor name = "base";
    }

    class DerivedForm extends BaseForm {
      @Field()
      public accessor name = "derived";
    }

    const form = new DerivedForm();
    await Promise.resolve();
    form.name = "changed";
    form.reset();
    expect(form.name).toBe("derived");
  });
});

describe("bracket-пути", () => {
  it("ошибки @Each видны в props поля и снимаются после исправления", async () => {
    class TagsForm extends Form {
      @Field()
      @Each()
      public accessor tags: string[] = [];
    }

    const form = new TagsForm();
    form.tags = ["a"];
    expect(await form.validateField("tags")).toBe(false);
    expect(form.getFieldProps("tags").errors.length).toBeGreaterThan(0);
    expect(form.errors["tags[0]"]?.length).toBeGreaterThan(0);

    form.tags = [];
    expect(await form.validateField("tags")).toBe(true);
    expect(form.getFieldProps("tags").errors).toEqual([]);
    expect(form.errors["tags[0]"]).toBeUndefined();
  });
});

describe("инвалидация вложенной формы", () => {
  class SlowChildForm extends Form {
    @Field()
    @Custom(async (value: unknown) => {
      const text = typeof value === "string" ? value : "";
      await delay(text === "bad" ? 30 : 5);
      return text === "ok";
    })
    public accessor code = "bad";
  }

  class SlowParentForm extends Form {
    @FormField()
    public accessor child = new SlowChildForm();
  }

  it("изменение поля ребёнка инвалидирует validate() родителя", async () => {
    const form = new SlowParentForm();
    await Promise.resolve();

    const first = form.validate();
    form.child.getFieldProps("code").setValue("ok");
    const second = form.validate();

    expect(second).not.toBe(first);
    await Promise.all([first, second]);
    expect(form.isValid).toBe(true);
    expect(form.errors).toEqual({});
  });

  it("изменение поля ребёнка инвалидирует validateField('child.code')", async () => {
    const form = new SlowParentForm();
    await Promise.resolve();

    const first = form.validateField("child.code");
    form.child.getFieldProps("code").setValue("ok");
    const second = form.validateField("child.code");

    expect(second).not.toBe(first);
    await Promise.all([first, second]);
    expect(form.isValid).toBe(true);
    expect(form.errors).toEqual({});
  });

  it("изменение поля ребёнка во время parent.validate() не оставляет ошибок", async () => {
    const form = new SlowParentForm();
    await Promise.resolve();

    const pending = form.validate();
    await delay(1);
    form.child.getFieldProps("code").setValue("ok");
    await pending;

    expect(form.errors).toEqual({});
    expect(form.isValid).toBe(true);
  });
});

describe("снимок values", () => {
  it("не отдаёт ссылки на массивы и plain-объекты", async () => {
    class SnapshotForm extends Form {
      @Field()
      public accessor list: number[] = [1];

      @Field()
      public accessor config = { a: 1, nested: { b: 2 } };

      @Field()
      public accessor when = new Date(0);

      @Field()
      public accessor map = new Map<string, number>([["a", 1]]);
    }

    const form = new SnapshotForm();
    await Promise.resolve();

    const snapshot = form.values;
    const list = snapshot.list as number[];
    list.push(2);
    expect(form.list).toEqual([1]);

    const config = snapshot.config as { a: number; nested: { b: number } };
    expect(config).not.toBe(form.config);
    expect(config.nested).not.toBe(form.config.nested);

    config.nested.b = 3;
    expect(form.config.nested.b).toBe(2);

    const when = snapshot.when as Date;
    expect(when).not.toBe(form.when);
    when.setTime(1000);
    expect(form.when.getTime()).toBe(0);

    const map = snapshot.map as Map<string, number>;
    expect(map).not.toBe(form.map);
    map.set("b", 2);
    expect([...form.map]).toEqual([["a", 1]]);
  });
});
