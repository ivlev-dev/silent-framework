import { describe, expect, it } from "vitest";
import { Field, Form, FormField, IsEmail, Label, Required } from "../src/index.js";

const flush = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

class AddressForm extends Form {
  @Field()
  @Required()
  @Label("Город")
  public accessor city = "";

  @Field()
  public accessor state = "";
}

class ProfileForm extends Form {
  @Field()
  @Required()
  public accessor name = "";

  @FormField()
  public accessor address = new AddressForm();
}

describe("вложенные формы", () => {
  it("включает вложенные значения в values", () => {
    const form = new ProfileForm();
    form.address.city = "Москва";
    expect(form.values).toEqual({
      name: "",
      address: { city: "Москва", state: "" },
    });
  });

  it("делегирует getFieldProps и меняет значение вложенного поля", async () => {
    const form = new ProfileForm();
    const city = form.getFieldProps("address.city");
    expect(city.name).toBe("address.city");
    expect(city.label).toBe("Город");

    city.onChange({ currentTarget: { value: "Казань" } });
    await flush();
    expect(form.address.city).toBe("Казань");
    expect(form.values.address).toEqual({ city: "Казань", state: "" });

    expect(await form.validateField("address.city")).toBe(true);
    expect(form.errors["address.city"]).toBeUndefined();
  });

  it("строит id вложенных полей с именем класса по умолчанию", () => {
    const form = new ProfileForm();
    expect(form.getFieldProps("address").id).toBe("ProfileForm-address");
    expect(form.getFieldProps("address.city").id).toBe(
      "ProfileForm-address.city",
    );
  });

  it("агрегирует ошибки с префиксами путей", async () => {
    const form = new ProfileForm();
    const valid = await form.validate();
    expect(valid).toBe(false);
    expect(form.errors.name?.length).toBeGreaterThan(0);
    expect(form.errors["address.city"]?.length).toBeGreaterThan(0);
    expect(form.getFieldProps("address").errors).toEqual(
      form.errors["address.city"],
    );
  });

  it("агрегирует isReady и isValid", async () => {
    const form = new ProfileForm();
    form.name = "Иван";
    expect(form.isReady).toBe(false);
    expect(form.getFieldProps("address.city").isRequired).toBe(true);

    form.address.city = "Москва";
    expect(form.getFieldProps("address.city").isReady).toBe(true);
    expect(form.getFieldProps("address").isReady).toBe(true);
    expect(form.isReady).toBe(true);

    form.setFieldErrors("address.city", "Не обслуживаем");
    expect(form.isReady).toBe(false);
    expect(form.getFieldProps("address.city").errors).toEqual(["Не обслуживаем"]);
    expect(form.getFieldProps("address").error).toBe("Не обслуживаем");
  });

  it("проверяет вложенное поле через родителя", async () => {
    const form = new ProfileForm();
    form.name = "Иван";
    expect(await form.validateField("address.city")).toBe(false);
    expect(form.errors["address.city"]?.length).toBeGreaterThan(0);
  });

  it("не разрешает использовать одну вложенную форму в двух родителях", () => {
    const address = new AddressForm();
    const first = new ProfileForm();
    first.address = address;
    expect(first.values.address).toBeDefined();

    const second = new ProfileForm();
    second.address = address;
    expect(() => second.values).toThrow(
      /Экземпляр формы AddressForm уже используется как поле формы ProfileForm\.address/,
    );
  });

  it("не регистрирует вложенную форму без @Field/@FormField", () => {
    class PlainNested extends Form {
      public accessor address = new AddressForm();
    }
    const form = new PlainNested();
    expect(form.values).toEqual({});
    expect(() => form.getFieldProps("address" as never)).toThrow(
      /не зарегистрировано/,
    );
  });

  it("заменяет вложенную форму через setValues и отвязывает старую", () => {
    const form = new ProfileForm();
    const previous = form.address;
    const next = new AddressForm();
    next.city = "Сочи";

    form.setValues({ address: next });

    expect(form.values.address).toEqual({ city: "Сочи", state: "" });
    expect(() => {
      const other = new ProfileForm();
      other.address = previous;
      return other.values;
    }).not.toThrow();
  });

  it("подхватывает вложенную форму, присвоенную напрямую после инициализации", () => {
    const form = new ProfileForm();
    const props = form.getFieldProps("address.city");
    const previous = form.address;
    const next = new AddressForm();
    next.city = "Омск";

    form.address = next;

    expect(form.values.address).toEqual({ city: "Омск", state: "" });
    expect(props.value).toBe("Омск");
    props.setValue("Томск");
    expect(next.city).toBe("Томск");
    expect(previous.city).toBe("");

    const other = new ProfileForm();
    other.address = previous;
    expect(other.values.address).toEqual({ city: "", state: "" });
  });

  it("сбрасывает вложенную форму через reset", async () => {
    const form = new ProfileForm();
    // Эталон снимается микрозадачей после завершения конструкции.
    await Promise.resolve();
    form.name = "Иван";
    form.address.city = "Москва";
    await form.validate();

    form.reset();

    expect(form.name).toBe("");
    expect(form.address.city).toBe("");
    expect(form.errors["address.city"]).toBeUndefined();
    expect(form.isDirty).toBe(false);
  });

  it("позволяет передать вложенный объект в setValues", () => {
    const form = new ProfileForm();
    form.setValues({ address: { city: "Самара" } });
    expect(form.address.city).toBe("Самара");
  });

  it("проверяет вложенное поле через props.validate()", async () => {
    const form = new ProfileForm();
    expect(await form.getFieldProps("address.city").validate()).toBe(false);
    expect(form.errors["address.city"]?.length).toBeGreaterThan(0);
  });
});

describe("валидация вложенной формы", () => {
  it("использует правила вложенного класса", async () => {
    class EmailForm extends Form {
      @Field()
      @Required()
      @IsEmail()
      public accessor email = "";
    }

    class OuterForm extends Form {
      @FormField()
      public accessor contact = new EmailForm();
    }

    const form = new OuterForm();
    expect(await form.validateField("contact.email")).toBe(false);
    expect(form.errors["contact.email"]?.length).toBeGreaterThan(0);
  });
});
