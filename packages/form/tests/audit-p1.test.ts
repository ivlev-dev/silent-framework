import { describe, expect, it } from "vitest";
import { computed, storeFor, watch } from "@ivlev-dev/silent-core";
import {
  Custom,
  Field,
  Form,
  FormField,
  Groups,
  Label,
  Required,
  ValidateIf,
} from "../src/index.js";

describe("dispose вложенных форм", () => {
  it("рекурсивно освобождает детей и снимает watch", () => {
    class LeafForm extends Form {
      @Field()
      public accessor value = "a";
    }

    class ChildForm extends Form {
      public changes = 0;

      @Field()
      public accessor name = "a";

      @FormField()
      public accessor leaf = new LeafForm();

      @watch((vm: ChildForm) => vm.name)
      public onName(): void {
        this.changes += 1;
      }
    }

    class ParentForm extends Form {
      @FormField()
      public accessor child = new ChildForm();
    }

    const form = new ParentForm();
    expect(form.values.child).toBeDefined();
    const child = form.child;
    const leaf = child.leaf;
    expect(storeFor(child).disposed).toBe(false);

    form.dispose();

    expect(storeFor(child).disposed).toBe(true);
    expect(storeFor(leaf).disposed).toBe(true);
    child.name = "b";
    expect(child.changes).toBe(0);
    expect(() => form.dispose()).not.toThrow();
  });
});

describe("атомарная привязка", () => {
  class AddressForm extends Form {
    @Field()
    public accessor city = "";
  }

  class ProfileForm extends Form {
    @FormField()
    public accessor address = new AddressForm();

    @Field()
    public accessor name = "";
  }

  it("не портит форму при конфликте владения", () => {
    const shared = new AddressForm();
    shared.city = "Москва";

    const first = new ProfileForm();
    first.setValues({ address: shared });

    const second = new ProfileForm();
    const original = second.address;
    expect(() => second.setValues({ address: shared })).toThrow(
      /уже используется как поле формы/,
    );

    expect(second.address).toBe(original);
    expect(second.values.address).toEqual({ city: "" });
    expect(second.isDirty).toBe(false);
    expect(() => second.getFieldProps("address.city")).not.toThrow();

    first.setValues({ address: new AddressForm() });
    second.setValues({ address: shared });
    expect(second.address).toBe(shared);
  });

  it("syncChildren восстанавливается после конфликта прямого присваивания", () => {
    const shared = new AddressForm();
    const holder = new ProfileForm();
    holder.setValues({ address: shared });

    const form = new ProfileForm();
    const original = form.address;
    form.address = shared;
    expect(() => form.values).toThrow(/уже используется как поле формы/);

    form.address = original;
    expect(form.values.address).toEqual({ city: "" });
    expect(() => form.getFieldProps("address.city")).not.toThrow();
    expect(form.isDirty).toBe(false);
  });

  it("reset при конфликте не оставляет полу-состояние", async () => {
    const form = new ProfileForm();
    await Promise.resolve();
    const initial = form.address;
    form.setValues({ address: new AddressForm() });

    const holder = new ProfileForm();
    holder.setValues({ address: initial });

    expect(() => form.reset()).toThrow(/уже используется как поле формы/);
    expect(form.address).not.toBe(initial);
    expect(form.values.address).toEqual({ city: "" });
    expect(() => form.getFieldProps("address.city")).not.toThrow();
    await expect(form.validateField("address.city")).resolves.toBe(true);
  });
});

describe("кэш props при смене вида поля", () => {
  class AddressForm extends Form {
    @Field()
    @Required()
    public accessor city = "";
  }

  class DynamicForm extends Form {
    @Field()
    public accessor address: unknown = "";
  }

  it("direct → nested → direct", async () => {
    const form = new DynamicForm();
    const direct = form.getFieldProps("address");
    expect(direct.isValid).toBe(true);

    form.setValues({ address: new AddressForm() });
    const nested = form.getFieldProps("address");
    expect(nested).not.toBe(direct);

    expect(await form.validateField("address.city" as never)).toBe(false);
    expect(nested.errors.length).toBeGreaterThan(0);

    form.setValues({ address: "" });
    const back = form.getFieldProps("address");
    expect(Object.is(back, nested)).toBe(false);
    expect(back.value).toBe("");
    expect(back.errors).toEqual([]);
  });
});

describe("правила и условия на @FormField", () => {
  class AddressForm extends Form {
    @Field()
    @Required()
    public accessor city = "";
  }

  it("ошибка правила самого поля-формы видна в form.errors", async () => {
    class ContactForm extends Form {
      @FormField()
      @Custom(() => false)
      public accessor contact = new AddressForm();
    }

    const form = new ContactForm();
    expect(await form.validate()).toBe(false);
    expect(form.errors.contact?.length).toBeGreaterThan(0);

    const fieldOnly = new ContactForm();
    await expect(fieldOnly.validateField("contact")).resolves.toBe(false);
  });

  it("@ValidateIf(false) отключает проверку ребёнка", async () => {
    class ConditionalForm extends Form {
      @FormField()
      @ValidateIf(() => false)
      public accessor contact = new AddressForm();
    }

    const form = new ConditionalForm();
    expect(form.isReady).toBe(true);
    expect(await form.validate()).toBe(true);
    expect(form.errors).toEqual({});
    await expect(form.validateField("contact")).resolves.toBe(true);
  });
});

describe("ярлыки вложенных полей", () => {
  it("@Label ребёнка важнее labels родителя и попадает в сообщение", async () => {
    class LabeledAddress extends Form {
      @Field()
      @Required()
      @Label("Город")
      public accessor city = "";
    }

    class ProfileForm extends Form {
      @FormField()
      public accessor address = new LabeledAddress();
    }

    const form = new ProfileForm({ labels: { "address.city": "X" } });
    expect(form.getFieldProps("address.city").label).toBe("Город");

    expect(await form.validate()).toBe(false);
    expect(form.errors["address.city"]?.[0]).toContain("Город");
  });

  it("передаёт labels родителя ребёнку с префиксом", async () => {
    class PlainAddress extends Form {
      @Field()
      @Required()
      public accessor city = "";
    }

    class ProfileForm extends Form {
      @FormField()
      public accessor address = new PlainAddress();
    }

    const form = new ProfileForm({ labels: { "address.city": "Городок" } });
    await form.validateField("address.city");
    expect(form.errors["address.city"]?.[0]).toContain("Городок");
  });
});

describe("ValidationOptions", () => {
  it("groups доходят до валидатора", async () => {
    class GroupForm extends Form {
      @Field()
      @Required()
      @Groups("x")
      public accessor name = "";
    }

    const form = new GroupForm();
    expect(await form.validate({ groups: ["x"] })).toBe(false);
    expect(form.errors.name?.length).toBeGreaterThan(0);
    expect(await form.validate({ groups: ["other"] })).toBe(true);
  });

  it("groups доходят до вложенной формы", async () => {
    class ChildForm extends Form {
      @Field()
      @Required()
      @Groups("x")
      public accessor code = "";
    }

    class ParentForm extends Form {
      @FormField()
      public accessor child = new ChildForm();
    }

    const form = new ParentForm();
    expect(await form.validate({ groups: ["other"] })).toBe(true);
    expect(await form.validate({ groups: ["x"] })).toBe(false);
    expect(form.errors["child.code"]?.length).toBeGreaterThan(0);
  });
});

describe("same-value и multi-select", () => {
  class TagsForm extends Form {
    @Field()
    public accessor name = "a";

    @Field()
    public accessor tags: string[] = [];
  }

  it("повторная установка того же значения не dirty и не чистит ошибку", () => {
    const form = new TagsForm();
    form.getFieldProps("name").setValue("a");
    expect(form.isDirty).toBe(false);

    form.setFieldErrors("name", "Занято");
    form.getFieldProps("name").setValue("a");
    expect(form.errors.name).toEqual(["Занято"]);
  });

  it("читает selectedOptions multi-select", () => {
    const form = new TagsForm();
    form.getFieldProps("tags").onChange({
      currentTarget: {
        type: "select-multiple",
        multiple: true,
        selectedOptions: [{ value: "a" }, { value: "b" }],
      },
    });
    expect(form.tags).toEqual(["a", "b"]);
  });

  it("читает options с selected", () => {
    const form = new TagsForm();
    form.getFieldProps("tags").onChange({
      currentTarget: {
        type: "select-multiple",
        multiple: true,
        options: [
          { value: "a", selected: true },
          { value: "b", selected: false },
          { value: "c", selected: true },
        ],
      },
    });
    expect(form.tags).toEqual(["a", "c"]);
  });
});

describe("мемо-ключи", () => {
  it("@computed override isReady с super не даёт циклического мемо", () => {
    class BaseForm extends Form {
      @Field()
      public accessor name = "";
    }

    class DerivedForm extends BaseForm {
      @computed
      get isReady(): boolean {
        return super.isReady && this.name !== "";
      }
    }

    const form = new DerivedForm();
    expect(form.isReady).toBe(false);
    form.name = "Иван";
    expect(form.isReady).toBe(true);
  });
});

describe("id вложенных полей", () => {
  class AddressForm extends Form {
    @Field()
    public accessor city = "";
  }

  class ProfileForm extends Form {
    @FormField()
    public accessor address = new AddressForm();
  }

  it("совпадает при доступе через родителя и ребёнка", () => {
    const form = new ProfileForm();
    expect(form.getFieldProps("address.city").id).toBe(
      "ProfileForm-address.city",
    );
    expect(form.address.getFieldProps("city").id).toBe(
      "ProfileForm-address.city",
    );

    const sameClass = new ProfileForm();
    expect(sameClass.getFieldProps("address.city").id).toBe(
      "ProfileForm-address.city",
    );

    const childFirst = new ProfileForm();
    expect(childFirst.address.getFieldProps("city").id).toBe(
      "ProfileForm-address.city",
    );

    const withId = new ProfileForm({ formId: "profile" });
    expect(withId.getFieldProps("address.city").id).toBe(
      "profile-address.city",
    );
    expect(withId.address.getFieldProps("city").id).toBe(
      "profile-address.city",
    );
  });

  it("ошибка поля-формы снимается при изменении ребёнка", () => {
    const form = new ProfileForm();
    form.setFieldErrors("address", "Серверная ошибка");
    expect(form.errors.address).toEqual(["Серверная ошибка"]);

    form.getFieldProps("address.city").setValue("Москва");
    expect(form.errors.address).toBeUndefined();
  });
});

describe("validateField не помечает touched", () => {
  it("touched остаётся false", async () => {
    class SimpleForm extends Form {
      @Field()
      public accessor name = "";
    }

    const form = new SimpleForm();
    await form.validateField("name");
    expect(form.getFieldProps("name").touched).toBe(false);
  });
});
