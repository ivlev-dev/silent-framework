import { describe, expect, it } from "vitest";
import {
  ArrayMinSize,
  AsyncRuleError,
  Between,
  Custom,
  Each,
  Equals,
  Groups,
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  Label,
  Min,
  MinLength,
  Nested,
  NotEmpty,
  NotNull,
  Optional,
  Required,
  ValidateIf,
  ValidationException,
  configureValidation,
  resetValidationConfig,
  validate,
  validateAsync,
  validateOrThrow,
} from "../src/index.js";

class Address {
  @Required()
  @IsString()
  city = "";

  @Required()
  @MinLength(5)
  street = "";
}

class Profile {
  @Required()
  @Label("Имя")
  name = "";

  @Optional()
  @Min(18)
  age: number | undefined = undefined;

  @Nested()
  address = new Address();

  @Each()
  @ArrayMinSize(1)
  tags: Address[] = [];
}

describe("интеграция пакета", () => {
  it("валидирует класс с несколькими правилами и выдаёт сообщения", () => {
    const profile = new Profile();
    const result = validate(profile);

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.rule)).toEqual([
      "required",
      "required",
      "required",
      "minLength",
      "arrayMinSize",
    ]);
    expect(result.errors[0]?.message).toBe("Поле Имя обязательно");
    expect(result.errors[1]?.message).toBe("Поле city обязательно");
    expect(result.errors[0]?.path).toBe("name");
    expect(result.errors[1]?.path).toBe("address.city");
  });

  it("работает с accessor-полями", () => {
    class Model {
      @Required()
      @IsEmail()
      public accessor email!: string;

      @IsInt()
      @Min(18)
      public accessor age = 10;
    }

    const model = new Model();
    expect(validate(model).errors.map((error) => `${error.field}:${error.rule}`)).toEqual([
      "email:required",
      "email:isEmail",
      "age:min",
    ]);

    model.email = "user@example.com";
    model.age = 21;
    expect(validate(model)).toEqual({ valid: true, errors: [] });
  });

  it("учитывает наследование правил", () => {
    class Base {
      @Required()
      id = "";
    }
    class Child extends Base {
      @IsEmail()
      email = "nope";
    }

    const result = validate(new Child());
    expect(result.errors.map((error) => `${error.field}:${error.rule}`)).toEqual([
      "id:required",
      "email:isEmail",
    ]);
  });

  it("поддерживает порядок сверху вниз и groups", () => {
    class Model {
      @Required()
      @MinLength(5)
      @Groups("update")
      name = "";
    }

    const model = new Model();
    expect(validate(model).errors.map((error) => error.rule)).toEqual([
      "required",
      "minLength",
    ]);
    expect(validate(model, { groups: ["create"] }).errors).toEqual([]);
    expect(validate(model, { groups: ["update"] }).errors.length).toBe(2);
  });

  it("пропускает Optional и условия ValidateIf", () => {
    class Model {
      @Optional()
      @Min(10)
      optional: number | undefined = undefined;

      @ValidateIf((instance: Model) => instance.enabled)
      @Required()
      requiredWhenEnabled = "";

      enabled = true;
    }

    const model = new Model();
    expect(validate(model).errors.map((error) => error.field)).toEqual([
      "requiredWhenEnabled",
    ]);
    model.enabled = false;
    expect(validate(model).errors).toEqual([]);
  });

  it("использует кастомные сообщения и резолвер i18n", () => {
    class Model {
      @Required({ message: "Нужно заполнить {label}", label: "почту" })
      email = "";

      @Min(18, { messageKey: "custom.age" })
      age = 10;
    }

    const result = validate(new Model(), {
      locale: "en",
      resolve: (context) =>
        context.key === "custom.age" ? `Too young: ${String(context.params["min"])}` : undefined,
    });

    expect(result.errors[0]?.message).toBe("Нужно заполнить почту");
    expect(result.errors[1]?.message).toBe("Too young: 18");
  });

  it("переключает локаль глобально и на вызов", () => {
    class Model {
      @Required()
      email = "";
    }

    configureValidation({ locale: "en" });
    try {
      expect(validate(new Model()).errors[0]?.message).toBe("email is required");
      expect(validate(new Model(), { locale: "ru" }).errors[0]?.message).toBe(
        "Поле email обязательно",
      );
    } finally {
      resetValidationConfig();
    }
  });

  it("валидирует вложенные массивы и строит пути", () => {
    class Model {
      @Each()
      @ArrayMinSize(2)
      items = [new Address(), new Address()];
    }

    const model = new Model();
    model.items[1]!.city = "Москва";

    const result = validate(model);
    expect(result.errors.map((error) => error.path)).toEqual([
      "items[0].city",
      "items[0].street",
      "items[0].street",
      "items[1].street",
      "items[1].street",
    ]);
  });

  it("поддерживает синхронный и асинхронный Custom", async () => {
    class Model {
      @Custom((value) => value === "ok")
      sync = "bad";

      @Custom(async (value) => value === "ok")
      async = "bad";
    }

    const model = new Model();
    expect(() => validate(model)).toThrow(AsyncRuleError);
    const result = await validateAsync(model);
    expect(result.errors.map((error) => error.field)).toEqual(["sync", "async"]);
  });

  it("не зацикливается на кольцевых ссылках", () => {
    class Node {
      @Required()
      name = "node";

      @Optional()
      @Nested()
      child: Node | null = null;
    }

    const first = new Node();
    const second = new Node();
    first.child = second;
    second.child = first;

    expect(validate(first)).toEqual({ valid: true, errors: [] });
  });

  it("бросает ValidationException с ошибками", () => {
    class Model {
      @NotNull()
      @IsInt()
      @Between(1, 3)
      count: number | null = null;
    }

    expect(() => validateOrThrow(new Model())).toThrow(ValidationException);
    try {
      validateOrThrow(new Model());
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      expect((error as ValidationException).errors.length).toBe(3);
    }
  });

  it("поддерживает Equals, IsIn, NotEmpty и строковые правила", () => {
    class Model {
      @Equals("fixed")
      mode = "other";

      @IsIn(["a", "b"])
      choice = "c";

      @NotEmpty()
      name = "  ";

      @IsString()
      text = 42;
    }

    const result = validate(new Model());
    expect(result.errors.map((error) => error.rule)).toEqual([
      "equals",
      "isIn",
      "notEmpty",
      "isString",
    ]);
  });
});
