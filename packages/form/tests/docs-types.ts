/**
 * Компилируемая проверка примеров из `docs/api/form.md`.
 *
 * Файл намеренно не называется `*.test.ts`: он не запускается vitest,
 * но попадает в `tsconfig.typecheck.json` (include: ["src", "tests"]),
 * поэтому расхождение примеров с публичным API ломает `pnpm typecheck`.
 */
import {
  Field,
  Form,
  FormField,
  Hint,
  IsEmail,
  IsInt,
  Label,
  Max,
  Min,
  Optional,
  Placeholder,
  Required,
  ValidateIf,
  ValidateOn,
} from "../src/index.js";
import type {
  ArrayFieldPath,
  FieldPath,
  FieldProps,
  FormArray,
  ValidateOnMode,
  ValidationOptions,
} from "../src/index.js";

// В документации используется `api.save`; заглушка нужна только для типов.
const api = {
  save: async (_values: unknown): Promise<void> => {},
};

// --- Базовая форма и getFieldProps -----------------------------------------

class LoginForm extends Form {
  @Field()
  @Required()
  @IsEmail()
  @Label("Email")
  public accessor email = "";

  @Field()
  @Required()
  public accessor password = "";
}

class LoginFormWithId extends Form {
  @Field()
  @Required()
  @Label("Email")
  public accessor email = "";
}

// --- Вложенная форма и массив форм -----------------------------------------

class AddressForm extends Form {
  @Field()
  @Required()
  @Label("Город")
  public accessor city = "";

  @Field()
  @ValidateOn("blur")
  public accessor zip = "";
}

class ProfileForm extends Form {
  @Field()
  @Required()
  @Label("Имя")
  public accessor name = "";

  @Field()
  @Required()
  @IsEmail()
  public accessor email = "";

  @Field()
  @IsInt()
  @Min(18)
  @Max(120)
  public accessor age = 0;

  @FormField()
  @Label("Адрес")
  public accessor address = new AddressForm();
}

class ItemForm extends Form {
  @Field()
  @Required()
  public accessor name = "";

  @Field()
  public accessor city = "";
}

class OrderForm extends Form {
  @Field()
  public accessor items: ItemForm[] = [];
}

// --- Условные и необязательные поля, плейсхолдеры ---------------------------

class ConditionalForm extends Form {
  @Field()
  @Placeholder("Введите имя")
  @Hint("Как к вам обращаться")
  public accessor name = "";

  @Field()
  @Required()
  @ValidateIf((form: ConditionalForm) => form.name === "custom")
  public accessor customValue = "";

  @Field()
  @Required()
  @Optional()
  public accessor nickname: string | undefined = undefined;
}

class ModeForm extends Form {
  @Field()
  @ValidateOn("blur")
  public accessor email = "";

  @Field()
  @ValidateOn(["blur", "submit"])
  public accessor nickname = "";
}

/** Прогоняет примеры из документации; вызывается только при запуске вручную. */
export async function runDocsExamples(): Promise<void> {
  // Базовая форма.
  const form = new LoginForm();
  const email = form.getFieldProps("email");

  email.onChange({ currentTarget: { value: "user@example.com" } });
  await form.onSubmit(() => console.log(form.values))();

  const withId = new LoginFormWithId({ formId: "login" });
  const withIdProps: FieldProps<string> = withId.getFieldProps("email");
  const withIdFieldId: string = withIdProps.id;

  // getFieldProps, вложенные пути и formId.
  const profile = new ProfileForm({ debounceMs: 200 });
  const name = profile.getFieldProps("name");
  const nameLabel: string = name.label;
  const nameRequired: boolean = name.isRequired;
  const nameId: string = name.id;
  name.onChange({ currentTarget: { value: "Иван" } });

  const city = profile.getFieldProps("address.city");
  const cityId: string = city.id;
  city.onBlur();

  const addressValue: AddressForm = profile.getFieldProps("address").value;
  const cityPath: FieldPath<ProfileForm> = "address.city";

  // Массивы повторяемых форм.
  const order = new OrderForm();
  const items: FormArray<ItemForm> = order.getFieldArray("items");
  const arrayPath: ArrayFieldPath<OrderForm> = "items";

  items.add(new ItemForm());
  items.insert(0, new ItemForm());
  items.move(0, 1);
  items.remove(0);
  items.clear();

  const length: number = items.length;
  const first: ItemForm | undefined = items.at(0);
  const arrayErrors: Readonly<Record<string, readonly string[]>> = items.errors;
  const arrayReady: boolean = items.isReady;
  const arrayDirty: boolean = items.isDirty;

  // Внешние (серверные) ошибки.
  profile.setFieldErrors("email", ["Этот email уже занят"]);
  const emailErrors: readonly string[] = profile.errors["email"] ?? [];

  profile.setErrors({
    email: "Занято",
    "address.city": ["Не обслуживаем"],
  });

  const orderForm = new OrderForm();
  orderForm.setErrors({
    "items[0].name": "Укажите имя",
  });

  // autoSave.
  const stop = profile.autoSave(
    async (submitted) => api.save(submitted.values),
    { debounceMs: 500, validate: true },
  );
  stop();

  // onSubmit.
  await profile.onSubmit(async (submitted) => {
    await api.save(submitted.values);
  })();

  // ValidationOptions для validate()/validateField().
  const options: ValidationOptions = {
    groups: ["default"],
    cascade: true,
    stopAtFirst: false,
    types: false,
    locale: "ru",
    labels: { email: "E-mail" },
  };
  const formValid: boolean = await profile.validate(options);
  const emailValid: boolean = await profile.validateField("email", options);

  // Режимы проверки.
  const validateOn: ValidateOnMode = "submit";

  // Ссылки на значения, чтобы TypeScript не счёл объявления неиспользуемыми.
  void [
    withIdFieldId,
    nameLabel,
    nameRequired,
    nameId,
    cityId,
    addressValue,
    cityPath,
    arrayPath,
    length,
    first,
    arrayErrors,
    arrayReady,
    arrayDirty,
    emailErrors,
    formValid,
    emailValid,
    validateOn,
    new ConditionalForm(),
    new ModeForm(),
  ];
}
