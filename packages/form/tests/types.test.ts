import { describe, expect, it } from "vitest";
import { Field, Form, FormField, IsEmail, Max, Min, Required } from "../src/index.js";
import type { FieldPath, FieldProps } from "../src/index.js";

class AddressForm extends Form {
  @Field()
  public accessor city = "";

  @Field()
  public accessor state = "";
}

class ProfileForm extends Form {
  @Field()
  @Required()
  public accessor name = "";

  @Field()
  @Required()
  @IsEmail()
  public accessor email = "";

  @Field()
  @Min(18)
  @Max(120)
  public accessor age = 18;

  @FormField()
  public accessor address = new AddressForm();
}

class PlainForm extends Form {
  @Field()
  public accessor login = "";
}

class NullableForm extends Form {
  @FormField()
  public accessor address: AddressForm | null = null;
}

describe("типизация путей", () => {
  it("автодополняет простые и вложенные пути", async () => {
    const form = new ProfileForm();

    const name: string = form.getFieldProps("name").value;
    const email: string = form.getFieldProps("email").value;
    const age: number = form.getFieldProps("age").value;
    const address: AddressForm = form.getFieldProps("address").value;
    const city: string = form.getFieldProps("address.city").value;
    const state: string = form.getFieldProps("address.state").value;

    expect(name).toBe("");
    expect(email).toBe("");
    expect(age).toBe(18);
    expect(address).toBe(form.address);
    expect(city).toBe("");
    expect(state).toBe("");

    const props: FieldProps<string> = form.getFieldProps("name");
    expect(props.name).toBe("name");
    expect(await props.validate()).toBe(false);
  });

  it("строит FieldPath по accessor-полям класса", () => {
    const form = new PlainForm();
    const login: string = form.getFieldProps("login").value;
    expect(login).toBe("");

    const path: FieldPath<ProfileForm> = "address.city";
    expect(path).toBe("address.city");

    form.setValues({ login: "ivan" });
    expect(form.login).toBe("ivan");
  });

  it("запрещает невалидные пути на уровне типов", () => {
    const form = new ProfileForm();
    const plain = new PlainForm();

    if (false) {
      // @ts-expect-error поля surname нет в ProfileForm
      form.getFieldProps("surname");
      // @ts-expect-error вложенного поля zip нет в AddressForm
      form.getFieldProps("address.zip");
      // @ts-expect-error методы Form не являются путями
      plain.getFieldProps("validate");
      // @ts-expect-error служебные члены Form не являются путями
      plain.getFieldProps("values");
      // @ts-expect-error поля nope нет в PlainForm
      plain.getFieldProps("nope");

      // @ts-expect-error вложенного поля zip нет в AddressForm
      form.validateField("address.zip");
      // @ts-expect-error поля surname нет в ProfileForm
      form.setFieldErrors("surname", "Занято");
      // @ts-expect-error поля surname нет в ProfileForm
      form.clearFieldErrors("surname");
      // @ts-expect-error поля surname нет в ProfileForm
      form.setValues({ surname: "Иванов" });
    }

    expect(form).toBeInstanceOf(Form);
  });

  it("не предлагает вложенные пути для nullable-формы", () => {
    const nullable = new NullableForm();
    const address: AddressForm | null = nullable.getFieldProps("address").value;
    expect(address).toBeNull();

    if (false) {
      // @ts-expect-error nullable-поле не разворачивает вложенные пути
      nullable.getFieldProps("address.city");
    }
  });
});
