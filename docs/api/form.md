# @ivlev-dev/silent-form

Реактивные формы на базе `@ivlev-dev/silent-validation` и реактивности core: поля объявляются stage-3 `accessor`-декораторами, значения и ошибки читаются через реактивные `getFieldProps`, вложенные формы связываются автоматически.

```ts
import { Field, Form, IsEmail, Label, Required } from "@ivlev-dev/silent-form";

class LoginForm extends Form<{ email: string; password: string }> {
  @Field()
  @Required()
  @IsEmail()
  @Label("Email")
  public accessor email = "";

  @Field()
  @Required()
  public accessor password = "";
}

const form = new LoginForm({ formId: "login" });
const email = form.getFieldProps("email");

email.onChange({ currentTarget: { value: "user@example.com" } });
await form.onSubmit(() => console.log(form.values))();
```

Пакет переиспользует правила и сообщения валидатора: `@Required`, `@IsEmail`, `@Min`, `@ValidateIf`, `@Optional` и остальные правила работают как в `@ivlev-dev/silent-validation`. Локально переопределены только `Required` и `Label`: они дополнительно заполняют метаданные формы (обязательность и подпись для UI).

## `Form`

```ts
abstract class Form<Fields extends object = never> {}
```

Базовый класс формы. Поля объявляются через `@Field()` (или `@FormField()` для вложенной формы). Экземпляр создаётся с необязательными `FormOptions`.

### `FormOptions`

| Опция | Тип | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `validateOnChange` | `boolean` | `true` | Проверять поле на `change` |
| `validateOnBlur` | `boolean` | `true` | Проверять поле на `blur` |
| `validateOnInput` | `boolean` | `false` | Проверять поле на `input` |
| `validateOnSubmit` | `boolean` | `true` | Проверять форму при отправке |
| `validateOnInit` | `boolean` | `false` | Проверить форму в микрозадаче после создания |
| `validateNested` | `boolean` | `true` | Проверять вложенные формы в `validate()` |
| `debounceMs` | `number` | `0` | Задержка автоматической проверки поля |
| `clearExternalErrorsOnChange` | `boolean` | `true` | Очищать серверные ошибки при изменении значения |
| `formId` | `string` | — | Префикс DOM-идентификаторов |
| `labels` | `Readonly<Record<string, string>>` | `{}` | Ярлыки полей для UI и сообщений |
| `onError` | `(error: unknown) => void` | `console.error` | Ошибки проверки, отправки и колбэка |

Свойства формы:

- `isReady` — вычисляемое: все поля `setReady(true)`, вложенные формы готовы, ошибок нет, обязательные поля непусты, нет идущих проверок. Посещённость (`touched`) не учитывается.
- `isValid` — ошибок нет.
- `isDirty` — хотя бы одно поле менялось через `setValue`, событие, `setValues` или вложенную форму.
- `isSubmitting` — идёт `onSubmit`.
- `errors` — `Readonly<Record<string, readonly string[]>>` по плоским путям, включая вложенные (`address.city`). Сначала идут ошибки правил, затем внешние.
- `values` — реактивный снимок значений; вложенные формы представлены вложенными объектами.
- `getFieldProps(field)` — стабильный (кэшированный) объект `FieldProps` для пути.
- `validateField(field)` — проверить одно поле, включая путь вложенной формы.
- `validate()` — полная проверка: помечает все поля `touched`, собирает ошибки по путям, проверяет вложенные формы при `validateNested`.
- `onSubmit(callback)` — каррированный обработчик отправки.
- `setFieldErrors(field, errors)` / `clearFieldErrors(field?)` — внешние (серверные) ошибки.
- `setValues(values)` / `reset()` / `dispose()`.

`validate()` и `validateField()` асинхронны и возвращают `Promise<boolean>`. `dispose()` идемпотентен, освобождает реактивное хранилище и снимает таймеры `debounceMs`.

### `FieldPath`

```ts
type FieldPath<T> = ...;
```

Пути полей формы. Для `interface ProfileFields { name: string; age: number; address: AddressForm }` и `class ProfileForm extends Form<ProfileFields>` тип содержит `"name"`, `"age"`, `"address"`, `"address.city"` и `"address.state"`. Невалидный путь — ошибка компиляции, методы и служебные свойства `Form` в пути не попадают. Для формы без generic используется `FieldPath<this>`.

### `FieldProps`

```ts
interface FieldProps<Value = unknown> {
  readonly value: Value;
  readonly label: string;
  readonly placeholder: string | undefined;
  readonly hint: string | undefined;
  readonly error: string | undefined;
  readonly errors: readonly string[];
  readonly isRequired: boolean;
  readonly isReady: boolean;
  readonly isValidating: boolean;
  readonly touched: boolean;
  readonly dirty: boolean;
  readonly isValid: boolean;
  readonly name: string;
  readonly id: string;
  setValue(value: Value): void;
  setReady(ready: boolean): void;
  onChange(event: { readonly currentTarget?: unknown }): void;
  onInput(event: { readonly currentTarget?: unknown }): void;
  onFocus(event?: { readonly currentTarget?: unknown }): void;
  onBlur(event?: { readonly currentTarget?: unknown }): void;
  validate(): Promise<boolean>;
}
```

`onChange` читает `event.currentTarget`: для `checkbox` — `checked`, для `radio` — только при `checked === true`, иначе `value`. Если текущее значение поля — число, непустая строка приводится к `number`; пустая строка и строка из пробелов остаются строкой, чтобы поле можно было очистить.

`onBlur` помечает поле посещённым и запускает проверку по режимам. `onFocus` зарезервирован и не меняет состояние. `setValue` не запускает проверку и не помечает `touched`.

Для пути вложенного поля (`address.city`) свойства делегируют вложенной форме, но `name` и `id` содержат полный путь. Для пути самой вложенной формы (`address`) `value` — экземпляр `Form`, а `errors`, `isReady` и `validate()` агрегируют её состояние.

### `ValidateOnMode`

```ts
type ValidateOnMode = "change" | "input" | "blur" | "submit" | "none";
```

Режим автоматической проверки поля. Массив режимов включает несколько событий. Для поля без `@ValidateOn` используются настройки формы. `"none"` отключает проверку по событиям (`change`, `input`, `blur`); `validate()`, `validateField()` и `onSubmit` при `validateOnSubmit: true` проверяют поле всегда. `"submit"` полезен вместе с `validateOnSubmit: false`: такое поле проверяется при отправке, хотя форма целиком — нет.

## Декораторы

### `Field`

```ts
@Field()
public accessor email = "";
```

Делает accessor реактивным (семантика `@reactive` из core) и регистрирует поле в метаданных формы. Работает вместе с `@computed` и `@watch` из `@ivlev-dev/silent-core`. Поддерживаются только stage-3 `accessor`-поля с публичным строковым именем.

### `FormField`

Синоним `@Field()` для вложенной формы. Вложенность определяется по значению поля: `instanceof Form`.

### `Label`

```ts
@Label("Имя")
public accessor name = "";
```

Подпись поля для UI и сообщений валидатора. Приоритет: `@Label` → `FormOptions.labels[path]` → `FormOptions.labels[field]` → имя поля.

### `Placeholder`

```ts
@Placeholder("Введите имя")
public accessor name = "";
```

Плейсхолдер поля, доступен в `getFieldProps(field).placeholder`.

### `Hint`

```ts
@Hint("Как к вам обращаться")
public accessor name = "";
```

Подсказка поля, доступна в `getFieldProps(field).hint`.

### `Required`

```ts
@Required()
@Required({ message: "Укажите имя" })
public accessor name = "";
```

Обёртка над `Required` из валидатора: применяет правило `required` и помечает поле обязательным (`isRequired` → звёздочка в UI). Принимает `RuleOptions`.

### `ValidateOn`

```ts
@ValidateOn("blur")
public accessor email = "";

@ValidateOn(["blur", "submit"])
public accessor nickname = "";
```

Режим автоматической проверки конкретного поля. Переопределяет настройки формы целиком.

## Реэкспорт валидатора

Из `@ivlev-dev/silent-validation` реэкспортируются без изменений:

- Проверка: `validate`, `validateAsync`, `validateOrThrow`, `validateOrThrowAsync`, `validateProperty`, `validatePropertyAsync`, `validatePartial`, `validatePartialAsync`, `safeParse`, `safeParseAsync`.
- Модификаторы: `Groups`, `Optional`, `ValidateIf`, `ValidateOnSet`.
- Наличие: `NotNull`, `NotUndefined`, `NotEmpty`, `IsDefined`.
- Типы значений: `IsString`, `IsBoolean`, `IsInt`, `IsFloat`, `IsNumber`, `IsArray`, `IsDate`, `IsEnum`, `IsInstanceOf`, `IsObject`, `IsFunction`.
- Числа: `Min`, `Max`, `Between`, `Positive`, `Negative`, `NonNegative`, `NonPositive`, `MultipleOf`.
- Строки: `MinLength`, `MaxLength`, `Length`, `Matches`, `IsEmail`, `IsUrl`, `IsUUID`, `IsISO8601`, `IsPhone`, `IsAlpha`, `IsAlphanumeric`, `IsSlug`, `IsHexColor`, `IsBase64`, `IsJSON`.
- Коллекции: `ArrayMinSize`, `ArrayMaxSize`, `ArrayNotEmpty`, `ArrayUnique`, `HasKey`, `Nested`, `Each`.
- Сравнения: `Equals`, `NotEquals`, `IsIn`, `NotIn`.
- Своё правило: `Custom`.
- Сообщения: `DEFAULT_LOCALE`, `validationMessages`, `configureValidation`, `resetValidationConfig`, `getValidationConfig`, `createI18nextResolver`.
- Исключения и модель: `AsyncRuleError`, `ValidationException`, `ValidationModel`.
- Типы: `I18nextLike`, `MessageContext`, `MessageFactory`, `MessageResolver`, `RuleDecorator`, `RuleOptions`, `SafeParseFailure`, `SafeParseResult`, `SafeParseSuccess`, `ValidationConfig`, `ValidationError`, `ValidationOptions`, `ValidationResult`.

`Label` и `Required` дополнительно заполняют метаданные формы, но совместимы по сигнатурам с валидатором.

## Пример формы

```ts
import {
  Field,
  Form,
  FormField,
  IsEmail,
  IsInt,
  Label,
  Max,
  Min,
  Required,
  ValidateOn,
} from "@ivlev-dev/silent-form";

class AddressForm extends Form<{ city: string; zip: string }> {
  @Field()
  @Required()
  @Label("Город")
  public accessor city = "";

  @Field()
  @ValidateOn("blur")
  public accessor zip = "";
}

interface ProfileFields {
  name: string;
  email: string;
  age: number;
  address: AddressForm;
}

class ProfileForm extends Form<ProfileFields> {
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
  public accessor address = new AddressForm();
}

const form = new ProfileForm({ formId: "profile", debounceMs: 200 });

const name = form.getFieldProps("name");
name.label; // "Имя"
name.isRequired; // true
name.onChange({ currentTarget: { value: "Иван" } });

const city = form.getFieldProps("address.city");
city.onBlur(); // пометит address.city посещённым и проверит по режимам

form.setFieldErrors("email", ["Этот email уже занят"]);
form.errors["email"]; // ["Этот email уже занят"]

await form.onSubmit(async (submitted) => {
  await api.save(submitted.values);
})();
```

## Ограничения

- Только stage-3 `accessor`-поля (`public accessor email = ""`), без `experimentalDecorators`. Приватные, статические и символьные имена полей бросают `TypeError`.
- Поле, которое не отмечено ни одним декоратором формы, в метаданные не попадает: `getFieldProps` бросит ошибку с перечнем доступных путей.
- Внешние ошибки очищаются при изменении значения только при `clearExternalErrorsOnChange` (по умолчанию `true`); ошибки правил остаются до повторной проверки.
- Вложенная форма — только значение `instanceof Form`. Один экземпляр не может быть полем двух форм; повторная привязка даёт ошибку. Присвоение новой вложенной формы подхватывается при следующем обращении к метаданным, `values` или проверке.
- `reset()` возвращает значения, зафиксированные `@Field` при инициализации экземпляра. Для полей без `@Field` исходное значение фиксируется при первом обращении к форме.
- `isReady` не зависит от `touched`: пустая обязательная форма не готова сразу после создания.
- `@ValidateOn("none")` отключает автоматическую проверку по событиям; явные `validate()`/`validateField()` работают всегда, а `onSubmit` при `validateOnSubmit: true` проверяет форму целиком.
- ESM-only, Node.js >= 22.

## Ссылки

- Репозиторий: https://github.com/ivlev-dev/silent-framework
- Документация API: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/form.md
- Валидация: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/validation.md
- Issues: https://github.com/ivlev-dev/silent-framework/issues

---

MIT © ivlev-dev
