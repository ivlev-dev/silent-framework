import { describe, expect, it } from "vitest";
import { Field, Form, Required } from "../src/index.js";
import type { FieldPath, FieldProps } from "../src/index.js";

interface AddressFields {
  city: string;
  state: string;
}

class AddressForm extends Form<AddressFields> {
  @Field()
  public accessor city = "";

  @Field()
  public accessor state = "";
}

interface ProfileFields {
  name: string;
  age: number;
  address: AddressForm;
}

class ProfileForm extends Form<ProfileFields> {
  @Field()
  @Required()
  public accessor name = "";

  @Field()
  public accessor age = 0;

  @Field()
  public accessor address = new AddressForm();
}

class PlainForm extends Form {
  @Field()
  public accessor login = "";
}

describe("типизация путей", () => {
  it("автодополняет простые и вложенные пути", async () => {
    const form = new ProfileForm();

    const name: string = form.getFieldProps("name").value;
    const age: number = form.getFieldProps("age").value;
    const address: AddressForm = form.getFieldProps("address").value;
    const city: string = form.getFieldProps("address.city").value;
    const state: string = form.getFieldProps("address.state").value;

    expect(name).toBe("");
    expect(age).toBe(0);
    expect(address).toBe(form.address);
    expect(city).toBe("");
    expect(state).toBe("");

    const props: FieldProps<string> = form.getFieldProps("name");
    expect(props.name).toBe("name");
    expect(await props.validate()).toBe(false);
  });

  it("поддерживает форму без generic через FieldPath<this>", () => {
    const form = new PlainForm();
    const login: string = form.getFieldProps("login").value;
    expect(login).toBe("");

    const path: FieldPath<ProfileFields> = "address.city";
    expect(path).toBe("address.city");
  });

  it("запрещает невалидные пути на уровне типов", () => {
    const form = new ProfileForm();
    const plain = new PlainForm();

    if (false) {
      // @ts-expect-error поля surname нет в ProfileFields
      form.getFieldProps("surname");
      // @ts-expect-error вложенного поля zip нет в AddressFields
      form.getFieldProps("address.zip");
      // @ts-expect-error методы Form не являются путями
      plain.getFieldProps("validate");
      // @ts-expect-error поля nope нет в PlainForm
      plain.getFieldProps("nope");
    }

    expect(form).toBeInstanceOf(Form);
  });
});
