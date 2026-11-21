# @ivlev-dev/silent-form

Реактивные формы на базе `@ivlev-dev/silent-validation` и реактивности core: поля объявляются stage-3 `accessor`-декораторами, значения и ошибки читаются через реактивные `getFieldProps`, вложенные формы связываются автоматически.

```ts
import { Field, Form, IsEmail, Label, Required } from "@ivlev-dev/silent-form";

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

const form = new LoginForm();
const email = form.getFieldProps("email");

email.onChange({ currentTarget: { value: "user@example.com" } });
await form.onSubmit(() => console.log(form.values))();
```

`getFieldProps` возвращает DOM-`id` по умолчанию в виде `${className}-${path}`: `LoginForm-email`, `ProfileForm-address.city`. Опция `formId` задаёт собственный префикс (`new LoginForm({ formId: "login" })` → `login-email`).

Пакет переиспользует правила и сообщения валидатора: `@Required`, `@IsEmail`, `@Min`, `@ValidateIf`, `@Optional` и остальные правила работают как в `@ivlev-dev/silent-validation`. Локально переопределены только `Required` и `Label`: они дополнительно заполняют метаданные формы (обязательность и подпись для UI).

## `Form`

```ts
abstract class Form {}
```

Базовый класс формы (`extends ValidationModel` из `@ivlev-dev/silent-validation`). Поля объявляются через `@Field()` (или `@FormField()` для вложенной формы). Экземпляр создаётся с необязательными `FormOptions`; generic не нужен — пути полей выводятся из accessor-полей самого класса. Наследование от `ValidationModel` включает схемную проверку типов: Vite-плагин `validation()` из `@ivlev-dev/silent-validation-vite` генерирует схему по аннотациям accessor-полей, а `validateAsync(this)` применяет её вместе с декораторными правилами. `validate({ types: false })` отключает схемную проверку.

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
| `formId` | `string` | имя класса формы | Префикс DOM-идентификаторов; пустая строка или пробелы — как «не задан» |
| `labels` | `Readonly<Record<string, string>>` | `{}` | Ярлыки полей для UI и сообщений |
| `onError` | `(error: unknown) => void` | `console.error` | Ошибки проверки, отправки и колбэка |

Свойства формы:

- `isReady` — вычисляемое: все поля `setReady(true)`, вложенные формы готовы, ошибок нет, нет идущих проверок. Обязательное поле (`@Required`) должно быть непустым, но `@Optional` с `undefined`/`null` и `@ValidateIf` с неактивным условием требование снимают. Посещённость (`touched`) не учитывается.
- `isValid` — ошибок нет, включая ошибки правил у полей без `@Field`.
- `isDirty` — хотя бы одно поле менялось через `setValue`, событие, `setValues` или вложенную форму.
- `isSubmitting` — идёт `onSubmit`.
- `errors` — `Readonly<Record<string, readonly string[]>>` по плоским путям, включая вложенные (`address.city`) и элементы коллекций (`tags[0]`). Сначала идут ошибки правил, затем внешние.
- `values` — реактивный снимок значений-копий: массивы и plain-объекты клонируются рекурсивно, `Map`/`Set`/`Date` копируются, экземпляры классов возвращаются как есть; вложенные формы представлены вложенными объектами.
- `getFieldProps(field)` — стабильный (кэшированный) объект `FieldProps` для пути.
- `getFieldArray(field)` — массив повторяемых форм (`FormArray`): `items/length/errors/isReady/isDirty`, `at/add/insert/remove/move/clear`.
- `validateField(field, options?)` — проверить одно поле, включая путь вложенной формы или элемент массива. Параллельные вызовы для одного пути возвращают тот же промис. Поле не помечается `touched`.
- `validate(options?)` — полная проверка: снимает debounce-таймеры, помечает все поля `touched`, собирает ошибки по путям, проверяет вложенные формы и элементы массивов при `validateNested`. Возвращает `true`, только если и валидатор, и форма (включая вложенные формы и внешние ошибки) валидны. Повторный вызов во время идущей проверки возвращает тот же промис.
- `onSubmit(callback)` — каррированный обработчик отправки.
- `setFieldErrors(field, errors)` / `setErrors(errors)` / `clearFieldErrors(field?)` — внешние (серверные) ошибки; `setErrors` полностью заменяет набор и принимает плоские пути `email`, `address.city`, `items[0].name`.
- `setValues(values)` / `reset()` / `dispose()`.
- `autoSave(handler, options?)` — debounce-обработчик изменений; возвращает функцию остановки.

`validate()` и `validateField()` возвращают `Promise<boolean>`; `await` работает как обычно. Оба принимают необязательные `ValidationOptions` (`groups`, `cascade`, `stopAtFirst`, `types`, `locale`, `labels`): настройки уходят в валидатор, `labels` мержатся с локальными и для вложенных форм пересчитываются с префиксом (`address.city` → `city`). Внутренние мемо `isReady`/`isValid`/`isDirty`/`errors`/`values` используют `Symbol`, поэтому `@computed override get isReady() { return super.isReady && ... }` не даёт циклического мемо. Параллельные `validate()` и параллельные `validateField()` для одного и того же пути возвращают один и тот же промис и не запускают второй проход (вложенный путь дедуплицируется у формы-ребёнка). Изменение значения через API (`setValue`, события, `setValues`), `reset()` или `dispose()` увеличивает поколение и отцепляет текущие промисы: старый прогон завершится, но не запишет ошибки, а следующий `validate()`/`validateField()` запустит новый. Инвалидация распространяется вверх: изменение поля вложенной формы отцепляет и `validate()` родителя. Прямое присваивание `@Field`-поля (`form.name = "x"`) отслеживается сеттером; мутации внутри массивов/plain-объектов (`form.list.push(...)`, `form.config.x = ...`) — нет. `dispose()` идемпотентен, освобождает реактивное хранилище, таймеры `debounceMs`, кэш `props` и **рекурсивно освобождает owned-вложенные формы**; `onSubmit` после `dispose()` колбэк не вызывает.

### `FieldPath`

```ts
type FieldPath<T> = {
  [K in keyof T & string]: K extends FormMemberKey
    ? never
    : T[K] extends (...args: never[]) => unknown
      ? never
      : T[K] extends readonly (infer U)[]
        ? NonNullable<U> extends Form
          ? K | `${K}[${number}]` | `${K}[${number}].${FieldPath<NonNullable<U>>}`
          : K
        : T[K] extends Form
          ? K | `${K}.${FieldPath<T[K]>}`
          : K;
}[keyof T & string];
```

Пути полей строятся по accessor-полям класса формы. Для класса с полями `name`, `age`, вложенной формой `address` и массивом `items` тип содержит `"name"`, `"age"`, `"address"`, `"address.city"`, `"items"`, `"items[0]"`, `"items[0].city"` и остальные поля; `ArrayFieldPath<T>` — только ключи массивов форм (`"items"`). Методы и служебные члены `Form` в пути не попадают, поэтому невалидный путь — ошибка компиляции, а автодополнение предлагает только поля. Если поле объявлено как `AddressForm | null`/`| undefined`, вложенные пути не предлагаются: проверяйте `null` и используйте не-nullable поле. В сигнатурах `Form` используется `FieldPath<this>`, отдельный generic-интерфейс не нужен.

### Массивы повторяемых форм (`FormArray`, `ArrayFieldPath`)

```ts
class ItemForm extends Form {
  @Field() @Required() public accessor name = "";
  @Field() public accessor city = "";
}

class OrderForm extends Form {
  @Field({ array: () => new ItemForm() })
  public accessor items: ItemForm[] = [];
}

const form = new OrderForm();
const items = form.getFieldArray("items");

items.add();          // создать через фабрику @Field({ array })
items.insert(0);      // вставить через фабрику
items.add(new ItemForm());
items.move(0, 1);
items.remove(0);
items.clear();

items.length;  // количество
items.at(0);   // ItemForm | undefined
items.errors;    // { items: [...], "items[0].name": [...] }
items.ownErrors; // ошибки правил самого поля items
items.isReady;   // все элементы готовы
items.isDirty; // хотя бы один элемент изменён
```

Каждый элемент — экземпляр `Form`, один экземпляр может принадлежать только одному родителю/пути. `add`/`insert` принимают готовый экземпляр; `remove`/`clear` освобождают только добавленные элементы, а эталонные из `initialValues` оставляют живыми (без parent context), чтобы `reset()` мог их вернуть; окончательно эталонные освобождаются в `dispose()` формы. `values` отдаёт массив `child.values`, ошибки — плоские (`items[0].name`), `validate()`/`onSubmit` проверяют элементы параллельно. `id` элемента — `<prefix>-items[0].city`, одинаковый при доступе через родителя и через элемент. `reset()` восстанавливает длину/эталонные ссылки и сбрасывает эталонные элементы; `dispose()` освобождает все элементы.

`getFieldArray(path, factory?)` запоминает фабрику; `add()`/`insert(index)` без аргумента создают элемент через неё, без фабрики — понятная ошибка. `setValues({ items: [...] })` при наличии фабрики согласует длину: обновляет существующие, создаёт недостающие (Form или partial-объекты), удаляет лишние (эталонные не освобождаются). Без фабрики длина не меняется — обновляются только существующие элементы. Undo/redo и drag&drop API нет; для перестановки используйте `move` (сохраните порядок в своём store для отмены).

### `Form.setErrors`

```ts
form.setErrors({
  email: "Занято",
  "address.city": ["Не обслуживаем"],
  "items[0].name": "Укажите имя",
});
```

Полностью заменяет внешние ошибки формы: пути, отсутствующие в объекте, очищаются (включая вложенные формы и элементы массивов).

### `Form.autoSave`

```ts
const stop = form.autoSave(
  async (submitted) => api.save(submitted.values),
  { debounceMs: 500, validate: true },
);
stop();
```

Вызывает обработчик после изменений с debounce, только если `isDirty` и форма валидна; `validate: true` дополнительно запускает `validate()` перед вызовом. Для `beforeunload` подпишитесь на `isDirty` и `window.addEventListener("beforeunload", ...)` вручную.

### `FormWizard`

```ts
const wizard = new FormWizard([step1, step2, step3], { validateStep: true });
await wizard.next();      // валидирует текущий шаг и переходит вперёд
wizard.back();
await wizard.goTo(2);     // вперёд — с валидацией текущего шага, назад — без
await wizard.validateAll();
wizard.current; wizard.isFirst; wizard.isLast;
wizard.isReady; wizard.isDirty; wizard.errors; wizard.values();
wizard.dispose();         // wizard не владеет шагами, формы не освобождаются
```

Опции `WizardOptions` (`validateStep`, по умолчанию `true`); `next()` не переходит при ошибках. `isReady` — готовность текущего шага, `isDirty` — изменён хотя бы один шаг, `values()` — объект по строковым индексам шагов.

### `onDirtyChange` / `createDirtyGuard` / `beforeUnloadGuard`

```ts
const stop = onDirtyChange(form, (dirty) => console.log(dirty));

const guard = createDirtyGuard(form);
router.beforeEach(() => guard.canLeave() || "Есть несохранённые изменения");

const stopUnload = beforeUnloadGuard(form, { message: "Не сохранять?" });
```

`onDirtyChange` реактивен и возвращает stop. `DirtyGuard` / `canLeave()` — `!isDirty` (без DOM, `message` зарезервирован). `beforeUnloadGuard` добавляет `beforeunload` только пока dirty, SSR-safe (без `window` — no-op).

### `uploadField`

```ts
await uploadField(form, "avatar", file, async (file, { signal, onProgress }) => {
  onProgress(50);
  return api.upload(file, { signal });
}, { signal, onProgress: (p) => console.log(p) });
```

Типы `UploadContext` и `UploadOptions`; helper помечает поле неготовым на время загрузки, пишет результат загрузчика в `setValue`, снова помечает готовым; `signal`/`onProgress` прокидываются.

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

`onChange` читает `event.currentTarget`: для `checkbox` — `checked`, для `radio` — только при `checked === true`; для `select multiple` (`multiple: true` или `type: "select-multiple"`) — массив из `selectedOptions` (fallback: `options` с `selected: true`), иначе `value`. Если текущее значение поля — число, непустая строка приводится к `number`; пустая строка и строка из пробелов остаются строкой, чтобы поле можно было очистить.

`onBlur` помечает поле посещённым и запускает проверку по режимам. `onFocus` зарезервирован и не меняет состояние. `setValue` не запускает проверку и не помечает `touched`; повторная установка того же значения (по `Object.is`) не помечает `dirty` и не очищает внешние ошибки.

`isReady` прямого поля отражает `setReady` и отсутствие идущей async-проверки, но не проверяет непустоту/`isValid` — для готовности формы используйте `form.isReady`, для валидности — `isValid`.

Для пути вложенного поля (`address.city`) свойства делегируют вложенной форме, но `name` и `id` содержат полный путь. Для пути самой вложенной формы (`address`) `value` — экземпляр `Form`, а `errors`, `isReady` и `validate()` агрегируют её состояние.

`id` вычисляется один раз при создании `FieldProps` и не зависит от того, читают поле через родителя или через ребёнка: `form.getFieldProps("address.city").id === form.address.getFieldProps("city").id`, полный путь идёт от корневой формы, префикс — её `formId` (после `trim`) или имя класса, иначе `"form"`. Два экземпляра одной формы без `formId` дают одинаковые id — для списков и SSR задавайте уникальный `formId`.

Внешняя ошибка уровня поля-формы (`setFieldErrors("address", ...)`) снимается при изменении любого дочернего поля — инвалидация из ребёнка поднимается по цепочке родителей.

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

Делает accessor реактивным (семантика `@reactive` из core) и регистрирует поле в метаданных формы. Опции `FieldOptions` (`array` — фабрика элементов массива) передаются в `@Field()`/`@FormField()`. Работает вместе с `@computed` и `@watch` из `@ivlev-dev/silent-core`. Поддерживаются только stage-3 `accessor`-поля с публичным строковым именем.

**Любое поле формы обязано иметь `@Field()` или `@FormField()`.** Если у поля есть только `@Required`/`@Label`/`@ValidateOn` и т. п., при первом обращении к форме будет брошен `TypeError`. Правила валидатора, навешенные на поле без `@Field`, всё равно проверяются: их ошибки попадают в `errors`/`isValid`, а про отсутствие `@Field` один раз сообщается через `onError` (или `console.warn`).

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

Обёртка над `Required` из валидатора: применяет правило `required` и помечает поле обязательным (`isRequired` → звёздочка в UI). Принимает `RuleOptions`. `isReady` требует непустое значение только при активном требовании — см. `@Optional` и `@ValidateIf`.

### `ValidateIf`

```ts
import { Field, Form, Required, ValidateIf } from "@ivlev-dev/silent-form";

@Field()
@Required()
@ValidateIf((form: MyForm) => form.mode === "custom")
public accessor customValue = "";
```

Обёртка над `ValidateIf` валидатора: применяет условие и сохраняет предикат в метаданных поля. `isReady` не требует значение, если синхронный предикат вернул не `true`. Async (thenable) условие для синхронной готовности считается **оптимистично неактивным**, поэтому `isReady` не блокируется; `validate()`/`validateField()`/submit выполняют условие и дают окончательный результат. **Импортируйте `ValidateIf` из `@ivlev-dev/silent-form`**, иначе форма не увидит условие.

### `Optional`

```ts
import { Field, Optional, Required } from "@ivlev-dev/silent-form";

@Field()
@Required()
@Optional()
public accessor nickname: string | undefined = undefined;
```

Обёртка над `Optional` валидатора: `undefined`/`null` не требуются в `isReady`. Пустая строка остаётся непустым требованием `@Required`. **Импортируйте `Optional` из `@ivlev-dev/silent-form`**, иначе форма не увидит флаг.

### `ValidateOn`

```ts
@ValidateOn("blur")
public accessor email = "";

@ValidateOn(["blur", "submit"])
public accessor nickname = "";
```

Режим автоматической проверки конкретного поля. Переопределяет настройки формы целиком. При `validateOnSubmit: false` `onSubmit` рекурсивно вызывает `validateSubmitFields()` у вложенных форм, поэтому поля с `@ValidateOn("submit")` проверяются на любой глубине.

## Реэкспорт валидатора

Из `@ivlev-dev/silent-validation` реэкспортируются без изменений:

- Проверка: `validate`, `validateAsync`, `validateOrThrow`, `validateOrThrowAsync`, `validateProperty`, `validatePropertyAsync`, `validatePartial`, `validatePartialAsync`, `safeParse`, `safeParseAsync`.
- Модификаторы: `Groups`, `ValidateOnSet`; `Optional` и `ValidateIf` реэкспортируются из `@ivlev-dev/silent-form` как обёртки с метаданными формы.
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

`Label`, `Required`, `Optional` и `ValidateIf` дополнительно заполняют метаданные формы, но совместимы по сигнатурам с валидатором.

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

const form = new ProfileForm({ debounceMs: 200 });

const name = form.getFieldProps("name");
name.label; // "Имя"
name.isRequired; // true
name.id; // "ProfileForm-name" — префикс по имени класса
name.onChange({ currentTarget: { value: "Иван" } });

const city = form.getFieldProps("address.city");
city.id; // "ProfileForm-address.city"
city.onBlur(); // пометит address.city посещённым и проверит по режимам

form.setFieldErrors("email", ["Этот email уже занят"]);
form.errors["email"]; // ["Этот email уже занят"]

await form.onSubmit(async (submitted) => {
  await api.save(submitted.values);
})();
```

## Ограничения

- Только stage-3 `accessor`-поля (`public accessor email = ""`), без `experimentalDecorators`. Приватные, статические и символьные имена полей бросают `TypeError`.
- `FieldPath` строится по публичным не-методам класса: nullable/union-поля (`string | AddressForm`) дают только верхний ключ без вложенных путей, а `@computed`-геттеры тоже попадают в автодополнение (декораторы на уровне типов не видны).
- Внутри методов самой формы полиморфный `this` не раскрывает `FieldPath<this>`: TypeScript откладывает условные типы. Привяжите `this` к типу класса (`const self: ProfileForm = this`) или вызывайте `getFieldProps` на экземпляре формы.
- `@ValidateIf` с async-предикатом: `isReady` оптимистичен (thenable считается неактивным), окончательное решение принимают `validate()`/`validateField()`/submit. Для строгой синхронной готовности используйте синхронный предикат.
- Поле, которое не отмечено ни одним декоратором формы, в метаданные не попадает: `getFieldProps` бросит ошибку с перечнем доступных путей. Если у поля есть только правила валидатора, его ошибки всё равно попадают в `errors`, а про отсутствие `@Field` сообщается один раз.
- Внешние ошибки очищаются при изменении значения только при `clearExternalErrorsOnChange` (по умолчанию `true`); ошибки правил остаются до повторной проверки.
- Вложенная форма — только значение `instanceof Form`. Один экземпляр не может быть полем двух форм; повторная привязка даёт ошибку. Привязка атомарна: при конфликте значение и старый ребёнок не меняются. Присвоение новой вложенной формы подхватывается при следующем обращении к метаданным, `values` или проверке.
- Любое поле формы обязано иметь `@Field()`/`@FormField()`; иначе при инициализации бросается `TypeError`.
- Массив форм — массив экземпляров `Form`; один экземпляр — один родитель и один путь. `add`/`insert` принимают готовый элемент; `remove`/`clear` освобождают только добавленные элементы, эталонные остаются живыми до `dispose()` и возвращаются `reset()`; `setValues` не создаёт новые элементы и не меняет длину массива.
- Схемная проверка включается только при наследовании `ValidationModel` и наличии сгенерированной плагином `validation()` схемы; без плагина проверяются только декораторные правила. `types:false` отключает схемную часть.
- `reset()` возвращает эталон, снятый после завершения конструкции экземпляра (микрозадача из конструктора или первый `ensureInitialized`). Каждый вызов пишет свежую копию: массивы/plain-объекты клонируются, `Map`/`Set`/`Date` копируются, вложенные формы сохраняются как экземпляры и сбрасываются через `child.reset()`.
- `values` — снимок-копия, а не ссылки на внутренние значения; мутация результата не меняет форму. `getFieldProps(...).value` для массивов/объектов остаётся живым значением модели — меняйте его через `setValue`/события, а не мутацией.
- Самоссылочная форма (`child: NodeForm | undefined` как поле `NodeForm`) не выводится в `FieldPath` — TypeScript выдаёт `TS2615`. Древовидные формы описывайте отдельным не-рекурсивным типом полей или документируйте каст.
- Изменение значения через API (`setValue`, события, `setValues`), `reset()` и `dispose()` инвалидируют текущий прогон валидации: старый промис не пишет ошибки, следующий вызов запускает новый. Прямое присваивание `@Field`-поля (`form.name = "x"`) отслеживается сеттером; мутации внутри массивов/plain-объектов (`form.list.push(...)`, `form.config.x = ...`) — нет.
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
