import { describe, expect, it, vi } from "vitest";
import { computed, createEffect, flushSync, storeFor, watch } from "@ivlev-dev/silent-core";
import {
  Field,
  Form,
  Hint,
  IsEmail,
  Label,
  MinLength,
  Placeholder,
  Required,
  ValidateOn,
} from "../src/index.js";

const flush = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

class ProfileForm extends Form<{
  name: string;
  email: string;
  age: number;
  nickname: string;
}> {
  @Field()
  @Required()
  @Label("Имя")
  @Placeholder("Введите имя")
  @Hint("Как к вам обращаться")
  public accessor name = "";

  @Field()
  @Required()
  @IsEmail()
  public accessor email = "";

  @Field()
  public accessor age = 0;

  @Field()
  @MinLength(3)
  public accessor nickname = "nick";
}

describe("@Field и реактивность", () => {
  it("пересчитывает эффекты и @computed при изменении поля", () => {
    class ReactiveForm extends Form<{ first: string; last: string }> {
      @Field()
      public accessor first = "Иван";

      @Field()
      public accessor last = "Иванов";

      @computed
      get fullName(): string {
        return `${this.first} ${this.last}`;
      }
    }

    const form = new ReactiveForm();
    expect(form.fullName).toBe("Иван Иванов");

    const seen: string[] = [];
    createEffect(() => {
      seen.push(form.getFieldProps("first").value);
    });
    flushSync();
    expect(seen).toEqual(["Иван"]);

    form.setValues({ first: "Пётр" });
    flushSync();
    expect(seen).toEqual(["Иван", "Пётр"]);
    expect(form.fullName).toBe("Пётр Иванов");
  });

  it("работает вместе с @watch из core", () => {
    class WatchedForm extends Form<{ name: string }> {
      readonly changes: Array<{ next: string; prev: string | undefined }> = [];

      @Field()
      public accessor name = "a";

      @watch((vm: WatchedForm) => vm.name)
      public onName(next: string, prev: string | undefined): void {
        this.changes.push({ next, prev });
      }
    }

    const form = new WatchedForm();
    flushSync();
    form.setValues({ name: "b" });
    flushSync();
    expect(form.changes).toEqual([{ next: "b", prev: "a" }]);
  });
});

describe("метаданные поля", () => {
  it("отдаёт label, placeholder, hint и isRequired", () => {
    const form = new ProfileForm();
    const name = form.getFieldProps("name");
    expect(name.label).toBe("Имя");
    expect(name.placeholder).toBe("Введите имя");
    expect(name.hint).toBe("Как к вам обращаться");
    expect(name.isRequired).toBe(true);
    expect(form.getFieldProps("nickname").isRequired).toBe(false);
  });

  it("возвращает стабильный объект props", () => {
    const form = new ProfileForm();
    expect(form.getFieldProps("name")).toBe(form.getFieldProps("name"));
  });

  it("строит id из formId", () => {
    const form = new ProfileForm({ formId: "profile" });
    expect(form.getFieldProps("name").id).toBe("profile-name");
    expect(form.getFieldProps("name").name).toBe("name");
  });

  it("берёт ярлык из FormOptions.labels, если @Label нет", () => {
    class LabelsForm extends Form<{ city: string }> {
      @Field()
      public accessor city = "";
    }
    const form = new LabelsForm({ labels: { city: "Город" } });
    expect(form.getFieldProps("city").label).toBe("Город");
  });
});

describe("валидация", () => {
  it("работает при порядке декораторов @Required над @Field", async () => {
    class OrderForm extends Form<{ name: string }> {
      @Required()
      @Field()
      public accessor name = "";
    }
    const form = new OrderForm();
    expect(form.getFieldProps("name").isRequired).toBe(true);
    form.name = "Иван";
    expect(form.values.name).toBe("Иван");
    expect(await form.validate()).toBe(true);
  });

  it("проверяет поле на change", async () => {
    const form = new ProfileForm();
    form.getFieldProps("email").onChange({
      currentTarget: { type: "email", value: "not-an-email" },
    });
    await flush();
    expect(form.errors.email?.length).toBeGreaterThan(0);
    expect(form.getFieldProps("email").error).toBe(form.errors.email?.[0]);
    expect(form.getFieldProps("email").isValid).toBe(false);
  });

  it("не проверяет поле на change при @ValidateOn('blur')", async () => {
    class BlurForm extends Form<{ email: string }> {
      @Field()
      @Required()
      @IsEmail()
      @ValidateOn("blur")
      public accessor email = "";
    }
    const form = new BlurForm();
    form.getFieldProps("email").onChange({
      currentTarget: { type: "email", value: "bad" },
    });
    await flush();
    expect(form.errors.email).toBeUndefined();

    form.getFieldProps("email").onBlur();
    await flush();
    expect(form.errors.email?.length).toBeGreaterThan(0);
    expect(form.getFieldProps("email").touched).toBe(true);
  });

  it("проверяет на input, если форма это разрешает", async () => {
    class InputForm extends Form<{ email: string }> {
      @Field()
      @IsEmail()
      public accessor email = "";
    }
    const form = new InputForm({ validateOnInput: true });
    form.getFieldProps("email").onInput({
      currentTarget: { type: "email", value: "bad" },
    });
    await flush();
    expect(form.errors.email?.length).toBeGreaterThan(0);
  });

  it("@ValidateOn('none') отключает проверку по событиям", async () => {
    class NoneForm extends Form<{ email: string }> {
      @Field()
      @IsEmail()
      @ValidateOn("none")
      public accessor email = "";
    }
    const form = new NoneForm();
    form.getFieldProps("email").onChange({
      currentTarget: { type: "email", value: "bad" },
    });
    await flush();
    expect(form.errors.email).toBeUndefined();

    expect(await form.validateField("email")).toBe(false);
    expect(form.errors.email?.length).toBeGreaterThan(0);
  });

  it("полная validate() проверяет все поля и помечает touched", async () => {
    const form = new ProfileForm();
    const valid = await form.validate();
    expect(valid).toBe(false);
    expect(form.errors.name?.length).toBeGreaterThan(0);
    expect(form.errors.email?.length).toBeGreaterThan(0);
    expect(form.getFieldProps("name").touched).toBe(true);
    expect(form.getFieldProps("email").touched).toBe(true);
  });

  it("validateField не трогает остальные поля", async () => {
    const form = new ProfileForm();
    expect(await form.validateField("name")).toBe(false);
    expect(form.errors.name?.length).toBeGreaterThan(0);
    expect(form.errors.email).toBeUndefined();
  });

  it("сообщает доступные поля при неизвестном пути", async () => {
    const form = new ProfileForm();
    expect(() => form.getFieldProps("unknown" as never)).toThrow(
      /Поле "unknown" не зарегистрировано\. Доступные поля: name, email, age, nickname/,
    );
    await expect(form.validateField("unknown" as never)).rejects.toThrow(
      /Поле "unknown" не зарегистрировано/,
    );
  });

  it("использует @Label в сообщении валидатора", async () => {
    class LabelForm extends Form<{ name: string }> {
      @Field()
      @Required()
      @Label("Имя")
      public accessor name = "";
    }
    const form = new LabelForm();
    await form.validateField("name");
    expect(form.errors.name?.[0]).toContain("Имя");
  });
});

describe("isReady", () => {
  it("ложно для пустых обязательных полей", () => {
    const form = new ProfileForm();
    expect(form.isReady).toBe(false);
  });

  it("истинно, когда обязательные поля заполнены и ошибок нет", () => {
    const form = new ProfileForm();
    form.setValues({ name: "Иван", email: "ivan@example.com" });
    expect(form.isReady).toBe(true);
  });

  it("учитывает setReady", () => {
    const form = new ProfileForm();
    form.setValues({ name: "Иван", email: "ivan@example.com" });
    form.getFieldProps("email").setReady(false);
    expect(form.getFieldProps("email").isReady).toBe(false);
    expect(form.isReady).toBe(false);

    form.getFieldProps("email").setReady(true);
    expect(form.isReady).toBe(true);
  });

  it("ложно при ошибках и во время проверки", async () => {
    const form = new ProfileForm();
    form.setValues({ name: "Иван", email: "ivan@example.com" });
    form.setFieldErrors("email", "Занято");
    expect(form.isReady).toBe(false);

    form.clearFieldErrors("email");
    expect(form.isReady).toBe(true);

    const pending = form.validate();
    expect(form.isReady).toBe(false);
    await pending;
    expect(form.isReady).toBe(true);

    const fieldPending = form.validateField("email");
    expect(form.getFieldProps("email").isValidating).toBe(true);
    await fieldPending;
    expect(form.getFieldProps("email").isValidating).toBe(false);
  });
});

describe("внешние ошибки", () => {
  it("устанавливает и очищает серверные ошибки", () => {
    const form = new ProfileForm();
    form.setFieldErrors("email", ["Занято", { message: "Проверьте домен" }]);
    expect(form.errors.email).toEqual(["Занято", "Проверьте домен"]);
    expect(form.getFieldProps("email").error).toBe("Занято");

    form.clearFieldErrors("email");
    expect(form.errors.email).toBeUndefined();
  });

  it("очищает внешние ошибки при изменении значения", () => {
    const form = new ProfileForm();
    form.setFieldErrors("email", "Занято");
    form.getFieldProps("email").setValue("other@example.com");
    expect(form.errors.email).toBeUndefined();
  });

  it("не очищает внешние ошибки, если это отключено", () => {
    class KeepErrorsForm extends Form<{ email: string }> {
      @Field()
      public accessor email = "";
    }
    const form = new KeepErrorsForm({ clearExternalErrorsOnChange: false });
    form.setFieldErrors("email", "Занято");
    form.getFieldProps("email").setValue("other@example.com");
    expect(form.errors.email).toEqual(["Занято"]);
  });
});

describe("onSubmit", () => {
  it("проверяет поле с @ValidateOn('submit') даже при validateOnSubmit: false", async () => {
    class SubmitModeForm extends Form<{ name: string }> {
      @Field()
      @Required()
      @ValidateOn("submit")
      public accessor name = "";
    }
    const form = new SubmitModeForm({ validateOnSubmit: false });
    const callback = vi.fn();
    await form.onSubmit(callback)();
    expect(form.errors.name?.length).toBeGreaterThan(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it("вызывает preventDefault, валидирует и передаёт форму в callback", async () => {
    const form = new ProfileForm();
    form.setValues({ name: "Иван", email: "ivan@example.com" });
    const preventDefault = vi.fn();
    const callback = vi.fn((submitted: ProfileForm) => {
      expect(submitted).toBe(form);
      expect(submitted.isSubmitting).toBe(true);
    });

    await form.onSubmit(callback)({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
    expect(form.isSubmitting).toBe(false);
  });

  it("не вызывает callback для невалидной формы", async () => {
    const form = new ProfileForm();
    const callback = vi.fn();
    await form.onSubmit(callback)();
    expect(callback).not.toHaveBeenCalled();
    expect(form.isSubmitting).toBe(false);
  });

  it("передаёт ошибку callback в onError", async () => {
    const onError = vi.fn();
    const form = new ProfileForm({ onError });
    form.setValues({ name: "Иван", email: "ivan@example.com" });
    const failure = new Error("Сеть недоступна");

    await form.onSubmit(() => {
      throw failure;
    })();

    expect(onError).toHaveBeenCalledWith(failure);
    expect(form.isSubmitting).toBe(false);
  });
});

describe("setValues / reset / dispose", () => {
  it("setValues меняет значения и помечает dirty", () => {
    const form = new ProfileForm();
    form.setValues({ name: "Пётр", age: 42 });
    expect(form.values.name).toBe("Пётр");
    expect(form.values.age).toBe(42);
    expect(form.isDirty).toBe(true);
    expect(form.getFieldProps("name").dirty).toBe(true);
  });

  it("reset возвращает исходные значения и очищает состояние", async () => {
    const form = new ProfileForm();
    form.setValues({ name: "Пётр" });
    form.setFieldErrors("email", "Занято");
    await form.validate();

    form.reset();

    expect(form.values.name).toBe("");
    expect(form.errors).toEqual({});
    expect(form.isDirty).toBe(false);
    expect(form.getFieldProps("name").touched).toBe(false);
  });

  it("dispose освобождает хранилище и идемпотентен", () => {
    const form = new ProfileForm();
    form.dispose();
    expect(storeFor(form).disposed).toBe(true);
    expect(() => {
      form.dispose();
    }).not.toThrow();
  });
});

describe("onChange", () => {
  it("приводит строку к number для числового поля", () => {
    const form = new ProfileForm();
    form.getFieldProps("age").onChange({
      currentTarget: { type: "number", value: "42" },
    });
    expect(form.values.age).toBe(42);
    expect(form.values.age).toBeTypeOf("number");
  });

  it("оставляет пустую строку строкой", () => {
    const form = new ProfileForm();
    form.getFieldProps("age").onChange({
      currentTarget: { type: "number", value: "" },
    });
    expect(form.values.age).toBe("");
  });

  it("читает checkbox как boolean", () => {
    class CheckForm extends Form<{ agree: boolean }> {
      @Field()
      public accessor agree = false;
    }
    const form = new CheckForm();
    form.getFieldProps("agree").onChange({
      currentTarget: { type: "checkbox", checked: true },
    });
    expect(form.values.agree).toBe(true);
  });

  it("устанавливает radio только по checked", () => {
    class RadioForm extends Form<{ plan: string }> {
      @Field()
      public accessor plan = "basic";
    }
    const form = new RadioForm();
    form.getFieldProps("plan").onChange({
      currentTarget: { type: "radio", checked: false, value: "pro" },
    });
    expect(form.values.plan).toBe("basic");

    form.getFieldProps("plan").onChange({
      currentTarget: { type: "radio", checked: true, value: "pro" },
    });
    expect(form.values.plan).toBe("pro");
  });
});
