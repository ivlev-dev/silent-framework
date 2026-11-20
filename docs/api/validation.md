# @ivlev-dev/silent-validation

Валидация классов на stage 3 декораторах: синхронные и асинхронные правила, вложенные объекты и коллекции, группы, условные проверки и локализуемые сообщения.

```ts
import { validate, Required, IsEmail, IsInt, Min, Max } from "@ivlev-dev/silent-validation";
import type { ValidationResult } from "@ivlev-dev/silent-validation";

class User {
  @Required()
  @IsEmail()
  public accessor email!: string;

  @IsInt()
  @Min(0)
  @Max(120)
  public accessor age!: number;
}

const user = new User();
user.email = "user@example.com";
user.age = 30;

const result: ValidationResult = validate(user);
```

Все декораторы-правила имеют PascalCase-имена и возвращают `RuleDecorator`. Последний аргумент каждого правила — `RuleOptions`. Декораторы только регистрируют правила; проверка запускается явно через `validate`, `validateAsync`, `validateOrThrow`, `validateOrThrowAsync`, `validateProperty`/`validatePropertyAsync`, `validatePartial`/`validatePartialAsync` и `safeParse`/`safeParseAsync`. Исключение — opt-in модификатор `@ValidateOnSet`: он запускает проверку поля при каждом присваивании.

## Валидация из типов

Типы `accessor`-полей можно не дублировать декораторами: отдельный Vite-плагин читает TS-аннотации на этапе сборки и добавляет классу статическую схему. В рантайме `validate` проверяет типы автоматически, а декораторы используются для семантики — формата, диапазонов, сравнений. Схема генерируется только для классов, унаследованных от `ValidationModel` — напрямую или через промежуточные классы. Класс без `ValidationModel` в цепочке наследования метаданных не получает: у него проверяются только правила декораторов.

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";
import { validation } from "@ivlev-dev/silent-validation-vite";

export default defineConfig({
  plugins: [silent(), validation()],
});
```

Плагин поставляется отдельным пакетом `@ivlev-dev/silent-validation-vite` (устанавливается дополнительно к `@ivlev-dev/silent-validation`). Опции:

| Опция | Тип | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `include` | `RegExp` | `/\.(?:[cm]?ts\|tsx)$/` | Файлы, которые обрабатывает плагин; заменяет набор по умолчанию |
| `exclude` | `RegExp` | `/node_modules/` | Файлы, которые пропускаются |
| `tsconfig` | `string` | ближайший `tsconfig.json` | Путь к конфигу относительно корня проекта |
| `base` | `string` | `"ValidationModel"` | Имя базового класса, потомки которого получают схему |
| `strict` | `boolean` | `false` | Бросать ошибку вместо предупреждения при неподдерживаемом типе |

Базовый класс определяется по символу `ValidationModel` из `@ivlev-dev/silent-validation`: плагин находит импорт/резолвит модуль и сравнивает цепочку наследования по символу. Если символ пакета не найден, используется fallback по имени класса `base`.

```ts
import { IsEmail, Min, validate, ValidationModel } from "@ivlev-dev/silent-validation";

class Address extends ValidationModel {
  public accessor city: string = "";
}

class Item extends ValidationModel {
  public accessor name: string = "";
  public accessor quantity: number = 0;
}

class Order extends ValidationModel {
  @IsEmail()
  public accessor email: string = "";

  @Min(18)
  public accessor age: number = 0;

  public accessor address: Address = new Address();

  public accessor items: Item[] = [];

  public accessor counts: Record<string, number> = {};
}

const order = new Order();
const result = validate(order);
```

Плагин вставляет в класс статический блок `static { this[Symbol.for("silent.validation.schema")] = { version: 1, fields: ... } }`. По этой схеме `validate` проверяет `string`, `number`, вложенный `Address`, элементы `Item[]` и значения `Record`. Ошибка типа имеет `rule: "type"`, `params.type` с именем ожидаемого типа, сообщение по ключу `validation.type` (ru/en) и обычные `field`/`path`, например `address.city`, `items[0].name`; `index` заполняется только у прямых ошибок элемента коллекции. Ключи `Record` и объектов идут через точку (`counts.apples`), ключи `Map` — в скобках (`map[key]`).

**Порядок проверок.** Тип проверяется первым. По умолчанию `cascade: true`: декораторы поля выполняются и при неверном типе, поэтому `@Min(18)` на строке даст две ошибки — `type` и `min`. `cascade: false` останавливает декораторы поля после ошибки типа. Для верного типа декораторы работают как обычно.

**Optional и nullable в схеме.** `| undefined` и `| null` в типе поля (схема `optional`/`nullable`) отключают только проверку типа при `undefined`/`null`: декораторные правила поля продолжают выполняться. Например, `@Required()` на `age: number | undefined` даст ошибку `required`, а `@Min(18)` — ошибку `min`. Чтобы полностью пропустить поле при `undefined`/`null`, используйте явный `@Optional()`.

**Отключение.** `validate(instance, { types: false })` оставляет только правила декораторов. По умолчанию `types: true`. Каскад управляется `cascade` (по умолчанию `true`) глобально через `configureValidation` или на вызов.

**Поддерживаемые типы.** Примитивы (`string`, `number`, `boolean`, `bigint`, `symbol`, `object`, `function`, `undefined`, `null`, `void`, `never`), литералы, union и intersection (включая `| null` и `| undefined`), массивы, `ReadonlyArray` и `ArrayLike<T>` (массивы и array-like объекты), кортежи с optional-элементами и rest-хвостом (`[string, ...number[]]`), `Record` и строковые index-signature, `Map`/`ReadonlyMap`, `Set`/`ReadonlySet` (и `WeakMap`/`WeakSet` — только `instanceof`, без проверки ключей и значений), `Promise`, `Date`, `RegExp`, `Error` и подклассы, `ArrayBuffer`/`SharedArrayBuffer`/`DataView`, typed arrays (`Buffer` проверяется как `Uint8Array`), `URL`/`URLSearchParams`, `Iterable`/`Iterator`/`AsyncIterable`/`AsyncIterator`, значения `enum`, mapped-утилиты (`Partial`, `Pick`, `Omit`, `Readonly`, `Required` — структурно), пользовательские классы (вложенная проверка экземпляра) и структурные интерфейсы/type alias’ы (включая рекурсивные — через ленивые ссылки).

**Стоимость.** Рантайм — около 3 µs на `validate` для 6 полей с вложенным классом и массивом; `types: false` — около 0.15 µs. TypeScript Program создаётся один раз на проект (~0.3–0.4 s холодная сборка для 120 файлов), повторные сборки/HMR используют кеш плагина.

**Ограничения.** Проверяются только `accessor`-поля с явной аннотацией и identifier-именем; обычные поля, поля без аннотации, вычисляемые и символьные имена пропускаются. Схема генерируется только для классов-потомков `ValidationModel` (наследование может быть многоуровневым); класс без базового класса не валидируется по типу. Optional-поле описывается как `public accessor age: number | undefined = undefined;` — `?` для `accessor` в TypeScript запрещён. Mapped-утилиты (`Partial`, `Pick`, `Omit`, `Readonly`, `Required`) поддерживаются структурно. Числовая index-signature учитывается только у типов без именованных свойств. Символьные свойства структурных типов пропускаются с диагностикой (в `strict` — ошибка). Ambient-классы (`declare class`) без рантайм-модуля пропускаются. Глубина данных ограничена 256 уровнями (в том числе для рекурсии `@Nested()`): глубже возвращается ошибка `validation.depth`, а не «валидно». Условные, template и indexed-типы, а также generic-параметры без конкретизации пропускаются с диагностикой (в `strict` — ошибка). Если класс импортирован только как тип, плагин добавляет namespace-импорт при наличии рантайм-файла; если рантайма нет, поле пропускается с диагностикой (в `strict` — ошибка). Метаданные попадают в бандл статическим блоком; без плагина типы не проверяются.

## Функции

### `validate`

```ts
function validate(instance: object, options?: ValidationOptions): ValidationResult;
```

Синхронно проверяет экземпляр класса и возвращает результат со списком ошибок. Бросает `TypeError`, если аргумент не объект или является обычным массивом (`Array`); подклассы `Array` валидируются. Бросает `AsyncRuleError`, если встретилось асинхронное правило, и `Error`, если `MessageResolver` вернул промис.

```ts
const result = validate(user, { stopAtFirst: true });
```

Ограничения: не поддерживает правила, возвращающие промис, и асинхронные резолверы сообщений: в первом случае бросает `AsyncRuleError`, во втором — `Error`.

### `validateAsync`

```ts
function validateAsync(
  instance: object,
  options?: ValidationOptions,
): Promise<ValidationResult>;
```

Асинхронная проверка: последовательно ожидает результат каждого правила. Поддерживает синхронные и асинхронные `Custom`-правила.

```ts
const result = await validateAsync(user, { groups: ["admin"] });
```

### `validateProperty`

```ts
function validateProperty(
  instance: object,
  field: string,
  options?: ValidationOptions,
): ValidationResult;
```

Синхронно проверяет одно поле экземпляра по его правилам и возвращает `ValidationResult`. Остальные поля не проверяются. Бросает `TypeError`, если аргумент — не объект или обычный массив (подклассы `Array` валидируются), `AsyncRuleError` при асинхронном правиле и `Error` при асинхронном резолвере.

```ts
const result = validateProperty(user, "email");
```

### `validatePropertyAsync`

```ts
function validatePropertyAsync(
  instance: object,
  field: string,
  options?: ValidationOptions,
): Promise<ValidationResult>;
```

Асинхронный вариант `validateProperty`: ожидает асинхронные правила выбранного поля.

### `validatePartial`

```ts
function validatePartial(
  instance: object,
  fields: readonly string[],
  options?: ValidationOptions,
): ValidationResult;
```

Синхронно проверяет только перечисленные поля: схему из типов, декораторы и вложенные объекты. Неизвестные имена игнорируются, пустой список даёт валидный результат. Бросает `TypeError`, если аргумент — не объект или обычный массив (подклассы `Array` валидируются), `AsyncRuleError` при асинхронном правиле и `Error` при асинхронном резолвере.

```ts
const result = validatePartial(user, ["email", "address"]);
```

### `validatePartialAsync`

```ts
function validatePartialAsync(
  instance: object,
  fields: readonly string[],
  options?: ValidationOptions,
): Promise<ValidationResult>;
```

Асинхронный вариант `validatePartial`: ожидает асинхронные правила и асинхронный `MessageResolver`.

### `safeParse`

```ts
type SafeParseSuccess<T extends object> = {
  readonly success: true;
  readonly data: T;
  readonly errors: readonly [];
};
type SafeParseFailure = {
  readonly success: false;
  readonly errors: readonly ValidationError[];
};
type SafeParseResult<T extends object> = SafeParseSuccess<T> | SafeParseFailure;

function safeParse<T extends object>(
  instance: T,
  options?: ValidationOptions,
): SafeParseResult<T>;
```

Проверяет экземпляр и не бросает `ValidationException`: при успехе возвращает `{ success: true, data: instance, errors: [] }`, при ошибках валидации — `{ success: false, errors }`. `data` — исходный объект без копирования. Бросает `TypeError`, если аргумент — не объект или обычный массив (подклассы `Array` валидируются), `AsyncRuleError` при асинхронном правиле и `Error` при асинхронном резолвере.

```ts
const result = safeParse(user);
if (!result.success) {
  console.log(result.errors[0]?.message);
}
```

### `safeParseAsync`

```ts
function safeParseAsync<T extends object>(
  instance: T,
  options?: ValidationOptions,
): Promise<SafeParseResult<T>>;
```

Асинхронный вариант `safeParse`: не бросает `ValidationException`, ошибки валидации возвращает в `errors`; если аргумент — не объект или обычный массив, бросает `TypeError`.

### `validateOrThrow`

```ts
function validateOrThrow(instance: object, options?: ValidationOptions): void;
```

Синхронная проверка, которая при ошибках бросает `ValidationException`. При успехе ничего не возвращает. Как и `validate`, бросает `TypeError`, если аргумент — не объект или обычный массив (подклассы `Array` валидируются), `AsyncRuleError` при асинхронном правиле и `Error` при асинхронном резолвере.

```ts
import { validateOrThrow, ValidationException } from "@ivlev-dev/silent-validation";

try {
  validateOrThrow(user);
} catch (error) {
  if (error instanceof ValidationException) {
    console.log(error.errors[0]?.message);
  }
}
```

### `validateOrThrowAsync`

```ts
function validateOrThrowAsync(
  instance: object,
  options?: ValidationOptions,
): Promise<void>;
```

Асинхронный вариант `validateOrThrow`: ожидает все правила и при ошибках отклоняется `ValidationException`.

### `configureValidation`

```ts
function configureValidation(config: ValidationConfig): void;
```

Мержит глобальные настройки: `cascade`, `locale`, `resolve`, `messages`. Переданные поля заменяют предыдущие значения, остальные сохраняются.

```ts
configureValidation({ locale: "en" });
configureValidation({ messages: { en: { "validation.required": "{label} is required" } } });
```

Ограничения: глобальный конфиг общий на процесс; для локальных настроек передавайте `locale`, `resolve`, `messages` в `ValidationOptions`.

### `resetValidationConfig`

```ts
function resetValidationConfig(): void;
```

Очищает глобальный конфиг сообщений до значений по умолчанию (встроенные каталоги, локаль `ru`).

### `getValidationConfig`

```ts
function getValidationConfig(): ValidationConfig;
```

Возвращает текущий глобальный конфиг сообщений. Используется движком валидации и может применяться для диагностики.

```ts
const config: ValidationConfig = getValidationConfig();
```

## Правила наличия

### `Required`

```ts
function Required(options?: RuleOptions): RuleDecorator;
```

Значение не `undefined`, не `null` и не пустая строка. Ключ сообщения — `validation.required`.

### `NotNull`

```ts
function NotNull(options?: RuleOptions): RuleDecorator;
```

Значение не `null` и не `undefined`. Ключ — `validation.notNull`.

### `NotUndefined`

```ts
function NotUndefined(options?: RuleOptions): RuleDecorator;
```

Значение не `undefined` (в отличие от `NotNull`, `null` допускается). Ключ — `validation.notUndefined`.

### `NotEmpty`

```ts
function NotEmpty(options?: RuleOptions): RuleDecorator;
```

Значение содержит данные: строка без пробелов, непустые массив, `Map`, `Set` или объект с ключами. Ключ — `validation.notEmpty`.

### `IsDefined`

```ts
function IsDefined(options?: RuleOptions): RuleDecorator;
```

Значение определено, то есть не `undefined`. Ключ — `validation.isDefined`.

## Правила типов

### `IsString`

```ts
function IsString(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — строка. Ключ — `validation.isString`.

### `IsBoolean`

```ts
function IsBoolean(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — `boolean`. Ключ — `validation.isBoolean`.

### `IsInt`

```ts
function IsInt(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — целое конечное число. Ключ — `validation.isInt`.

### `IsFloat`

```ts
function IsFloat(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — конечное нецелое число. Ключ — `validation.isFloat`.

### `IsNumber`

```ts
function IsNumber(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — конечное число (`NaN` и `Infinity` не проходят). Ключ — `validation.isNumber`.

### `IsArray`

```ts
function IsArray(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — массив. Ключ — `validation.isArray`.

### `IsDate`

```ts
function IsDate(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — `Date` с корректной датой. Ключ — `validation.isDate`.

### `IsEnum`

```ts
function IsEnum(
  values: readonly unknown[] | Record<string, unknown>,
  options?: RuleOptions,
): RuleDecorator;
```

Проверяет, что значение входит в массив или в значения enum-объекта. Для числовых enum числовые ключи обратного отображения (`"0" → "Low"`) пропускаются: допустимы только сами значения (`0`, `1`, …), а имена (`"Low"`) не принимаются. Ключ — `validation.isEnum`.

```ts
enum Role {
  Admin = "admin",
  User = "user",
}

enum Level {
  Low,
  High,
}

class Member {
  @IsEnum(Role)
  public accessor role: Role = Role.Admin;

  @IsEnum(Level)
  public accessor level: Level = Level.Low;
}
```

### `IsInstanceOf`

```ts
function IsInstanceOf(
  ctor: abstract new (...args: never[]) => unknown,
  options?: RuleOptions,
): RuleDecorator;
```

Проверяет, что значение — экземпляр указанного класса. В сообщении доступен параметр `{type}` с именем конструктора. Ключ — `validation.isInstanceOf`.

### `IsObject`

```ts
function IsObject(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — объект, не `null` и не массив. Ключ — `validation.isObject`.

### `IsFunction`

```ts
function IsFunction(options?: RuleOptions): RuleDecorator;
```

Проверяет, что значение — функция. Ключ — `validation.isFunction`.

## Числовые правила

### `Min`

```ts
function Min(limit: number, options?: RuleOptions): RuleDecorator;
```

Значение не меньше `limit`. Параметр сообщения — `{min}`. Ключ — `validation.min`.

### `Max`

```ts
function Max(limit: number, options?: RuleOptions): RuleDecorator;
```

Значение не больше `limit`. Параметр сообщения — `{max}`. Ключ — `validation.max`.

### `Between`

```ts
function Between(min: number, max: number, options?: RuleOptions): RuleDecorator;
```

Значение в диапазоне `min..max` включительно. Параметры сообщения — `{min}`, `{max}`. Ключ — `validation.between`.

### `Positive`

```ts
function Positive(options?: RuleOptions): RuleDecorator;
```

Значение строго больше нуля. Ключ — `validation.positive`.

### `Negative`

```ts
function Negative(options?: RuleOptions): RuleDecorator;
```

Значение строго меньше нуля. Ключ — `validation.negative`.

### `NonNegative`

```ts
function NonNegative(options?: RuleOptions): RuleDecorator;
```

Значение больше или равно нулю. Ключ — `validation.nonNegative`.

### `NonPositive`

```ts
function NonPositive(options?: RuleOptions): RuleDecorator;
```

Значение меньше или равно нулю. Ключ — `validation.nonPositive`.

### `MultipleOf`

```ts
function MultipleOf(factor: number, options?: RuleOptions): RuleDecorator;
```

Значение кратно `factor` с допуском `1e-9`. Бросает `RangeError`, если `factor` не конечное число или равен нулю. Параметр сообщения — `{factor}`. Ключ — `validation.multipleOf`.

## Строковые правила

### `MinLength`

```ts
function MinLength(min: number, options?: RuleOptions): RuleDecorator;
```

Длина строки не меньше `min`. Параметр сообщения — `{min}`. Ключ — `validation.minLength`.

### `MaxLength`

```ts
function MaxLength(max: number, options?: RuleOptions): RuleDecorator;
```

Длина строки не больше `max`. Параметр сообщения — `{max}`. Ключ — `validation.maxLength`.

### `Length`

```ts
function Length(length: number, options?: RuleOptions): RuleDecorator;
```

Длина строки ровно `length`. Параметр сообщения — `{length}`. Ключ — `validation.length`.

### `Matches`

```ts
function Matches(pattern: RegExp | string, options?: RuleOptions): RuleDecorator;
```

Строка соответствует регулярному выражению или строковому шаблону. Параметр сообщения — `{pattern}`. Ключ — `validation.matches`.

### `IsEmail`

```ts
function IsEmail(options?: RuleOptions): RuleDecorator;
```

Корректный email-адрес. Ключ — `validation.isEmail`.

### `IsUrl`

```ts
function IsUrl(options?: RuleOptions): RuleDecorator;
```

Корректный URL с протоколом `http:` или `https:` без пробелов по краям. Ключ — `validation.isUrl`.

### `IsUUID`

```ts
function IsUUID(options?: RuleOptions): RuleDecorator;
```

Строка в формате UUID. Ключ — `validation.isUUID`.

### `IsISO8601`

```ts
function IsISO8601(options?: RuleOptions): RuleDecorator;
```

Строка с датой ISO 8601, которую принимает `Date.parse`. Ключ — `validation.isISO8601`.

### `IsPhone`

```ts
function IsPhone(options?: RuleOptions): RuleDecorator;
```

Телефонный номер из цифр, пробелов, скобок, дефисов и необязательного `+`, длиной 7–20 символов. Ключ — `validation.isPhone`.

### `IsAlpha`

```ts
function IsAlpha(options?: RuleOptions): RuleDecorator;
```

Строка только из букв Unicode. Ключ — `validation.isAlpha`.

### `IsAlphanumeric`

```ts
function IsAlphanumeric(options?: RuleOptions): RuleDecorator;
```

Строка только из букв и цифр Unicode. Ключ — `validation.isAlphanumeric`.

### `IsSlug`

```ts
function IsSlug(options?: RuleOptions): RuleDecorator;
```

Slug в `kebab-case` из строчных латинских букв и цифр. Ключ — `validation.isSlug`.

### `IsHexColor`

```ts
function IsHexColor(options?: RuleOptions): RuleDecorator;
```

HEX-цвет `#RGB`, `#RGBA`, `#RRGGBB` или `#RRGGBBAA`. Ключ — `validation.isHexColor`.

### `IsBase64`

```ts
function IsBase64(options?: RuleOptions): RuleDecorator;
```

Непустая корректная Base64-строка, длина кратна четырём. Ключ — `validation.isBase64`.

### `IsJSON`

```ts
function IsJSON(options?: RuleOptions): RuleDecorator;
```

Строка, которую успешно разбирает `JSON.parse`. Ключ — `validation.isJSON`.

## Правила коллекций

### `ArrayMinSize`

```ts
function ArrayMinSize(min: number, options?: RuleOptions): RuleDecorator;
```

В массиве или `Set` не меньше `min` элементов. Параметр сообщения — `{min}`. Ключ — `validation.arrayMinSize`.

### `ArrayMaxSize`

```ts
function ArrayMaxSize(max: number, options?: RuleOptions): RuleDecorator;
```

В массиве или `Set` не больше `max` элементов. Параметр сообщения — `{max}`. Ключ — `validation.arrayMaxSize`.

### `ArrayNotEmpty`

```ts
function ArrayNotEmpty(options?: RuleOptions): RuleDecorator;
```

Массив или `Set` содержит хотя бы один элемент. Ключ — `validation.arrayNotEmpty`.

### `ArrayUnique`

```ts
function ArrayUnique(options?: RuleOptions): RuleDecorator;
```

Элементы массива или `Set` не повторяются. Ключ — `validation.arrayUnique`.

### `HasKey`

```ts
function HasKey(key: PropertyKey, options?: RuleOptions): RuleDecorator;
```

Объект содержит собственный ключ, а `Map` — указанный ключ. Параметр сообщения — `{key}`. Ключ — `validation.hasKey`.

### `Nested`

```ts
function Nested(options?: RuleOptions): RuleDecorator;
```

Значение — вложенный объект, который проверяется собственными зарегистрированными правилами. Ошибки получают путь с префиксом поля, например `address.city`. Ключ — `validation.nested`.

### `Each`

```ts
function Each(options?: RuleOptions): RuleDecorator;
```

Проверяет каждый элемент массива или `Set` как вложенный объект с его зарегистрированными правилами. Для ошибок внутри вложенного класса индекс есть только в пути (`items[2].name`); `index` и плейсхолдер `{index}` заполняются у прямых ошибок элемента — при неверном типе элемента и для правил с `each: true`. Если значение не коллекция, ошибка получает ключ `validation.eachValue`; если элемент не является объектом — `validation.each`.

```ts
class Order {
  @Each()
  public accessor items!: Item[];
}
```

Для примитивных элементов применяйте правило с опцией `each: true`:

```ts
class Order {
  @Min(0, { each: true })
  public accessor scores!: number[];
}
```

## Правила сравнения

### `Equals`

```ts
function Equals(expected: unknown, options?: RuleOptions): RuleDecorator;
```

Значение совпадает с `expected` по `Object.is`. Параметр сообщения — `{expected}`. Ключ — `validation.equals`.

### `NotEquals`

```ts
function NotEquals(expected: unknown, options?: RuleOptions): RuleDecorator;
```

Значение не совпадает с `expected` по `Object.is`. Параметр сообщения — `{expected}`. Ключ — `validation.notEquals`.

### `IsIn`

```ts
function IsIn(values: readonly unknown[], options?: RuleOptions): RuleDecorator;
```

Значение входит в список допустимых. Параметр сообщения — `{values}`. Ключ — `validation.isIn`.

### `NotIn`

```ts
function NotIn(values: readonly unknown[], options?: RuleOptions): RuleDecorator;
```

Значение не входит в список запрещённых. Параметр сообщения — `{values}`. Ключ — `validation.notIn`.

## Собственные правила

### `Custom`

```ts
function Custom(
  check: (
    value: unknown,
    context: {
      readonly instance: object;
      readonly field: string;
      readonly label: string;
      readonly path: string;
      readonly params: Readonly<Record<string, unknown>>;
    },
  ) => boolean | Promise<boolean>,
  options?: RuleOptions,
): RuleDecorator;
```

Пользовательская проверка. Функция получает значение и контекст с `instance`, `field`, `label`, `path`, `params`. Асинхронная функция поддерживается только async-функциями: `validateAsync`, `validatePropertyAsync`, `validatePartialAsync`, `safeParseAsync`, `validateOrThrowAsync`. Синхронные `validate`, `validateProperty`, `validatePartial`, `safeParse` и `validateOrThrow` бросят `AsyncRuleError`. Ключ — `validation.custom`.

```ts
class Order {
  @Custom((value) => typeof value === "string" && value.startsWith("ORD-"))
  public accessor number!: string;
}
```

## Модификаторы

### `ValidateIf`

```ts
function ValidateIf(predicate: (instance: object) => boolean): RuleDecorator;
```

Выполняет правила поля, только если предикат вернул `true` для экземпляра. Несколько `ValidateIf` на одном поле объединяются по «И».

### `Optional`

```ts
function Optional(): RuleDecorator;
```

Пропускает все правила поля, если значение `null` или `undefined`. Для `""` правила продолжают действовать.

### `Label`

```ts
function Label(label: string): RuleDecorator;
```

Задаёт человекочитаемое имя поля для сообщений. Приоритет: `RuleOptions.label` → `@Label` → `ValidationOptions.labels[path]` → `ValidationOptions.labels[field]` → имя поля.

### `Groups`

```ts
function Groups(...groups: string[]): RuleDecorator;
```

Относит поле к группам. Поле проверяется, если `ValidationOptions.groups` пуст или пересекается с группами поля; поле без групп проверяется всегда.

### `ValidateOnSet`

```ts
function ValidateOnSet(options?: ValidationOptions): RuleDecorator;
```

Включает проверку поля при каждом присваивании: после записи значения выполняется `validateProperty` для этого поля с переданными опциями (`groups`, `stopAtFirst`, `types`, `cascade`, сообщения), а при ошибках бросается `ValidationException`. Валидация при инициализации поля не запускается; невалидное значение остаётся в поле.

```ts
class User {
  @ValidateOnSet()
  @IsEmail()
  public accessor email: string = "";
}
```

Ограничение: работает только с синхронными правилами; асинхронное правило приводит к `AsyncRuleError`.

## Типы

### `ValidationModel`

```ts
class ValidationModel {}
```

Базовый класс-маркер для генерации схемы из TS-типов: наследуйтесь от него напрямую или через промежуточные классы, иначе плагин не создаст метаданные и `validate` увидит только правила декораторов.

### `ValidationOptions`

```ts
interface ValidationOptions extends ValidationConfig {
  readonly groups?: readonly string[] | undefined;
  readonly stopAtFirst?: boolean | undefined;
  readonly labels?: Readonly<Record<string, string>> | undefined;
  readonly types?: boolean | undefined;
  readonly cascade?: boolean | undefined;
}
```

Опции вызова `validate`/`validateAsync`: фильтр групп, остановка на первой ошибке, карта ярлыков, проверка типов из аннотаций (`types`, по умолчанию `true`), каскад типовых и декораторных ошибок (`cascade`, по умолчанию `true`) и локальные настройки сообщений (`locale`, `resolve`, `messages`).

### `ValidationResult`

```ts
interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}
```

Результат проверки. `valid` истинно, когда `errors` пуст.

### `ValidationError`

```ts
interface ValidationError {
  readonly field: string;
  readonly rule: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly value: unknown;
  readonly path: string;
  readonly label: string;
  readonly index?: number | undefined;
}
```

Ошибка одного правила. `path` содержит полный путь (`address.city`, `items[2].name`). `index` заполняется у прямых ошибок элемента коллекции (например, при `each: true` или неверном типе элемента); у ошибок внутри вложенного класса индекс есть только в `path`.

### `SafeParseSuccess`

```ts
type SafeParseSuccess<T extends object> = {
  readonly success: true;
  readonly data: T;
  readonly errors: readonly [];
};
```

Успешный результат `safeParse`: исходный экземпляр без копирования и пустой список ошибок.

### `SafeParseFailure`

```ts
type SafeParseFailure = {
  readonly success: false;
  readonly errors: readonly ValidationError[];
};
```

Неуспешный результат `safeParse`: ошибки валидации лежат в `errors`, `ValidationException` не бросается.

### `SafeParseResult`

```ts
type SafeParseResult<T extends object> = SafeParseSuccess<T> | SafeParseFailure;
```

Объединение успешного и неуспешного результатов `safeParse`/`safeParseAsync`. Дискриминант — `success`.

### `ValidationConfig`

```ts
interface ValidationConfig {
  readonly cascade?: boolean | undefined;
  readonly locale?: string | undefined;
  readonly resolve?: MessageResolver | undefined;
  readonly messages?: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
}
```

Настройки: каскад ошибок (`cascade`), локаль, резолвер и каталоги вида `локаль → ключ → шаблон`. Используется в `ValidationOptions` и `configureValidation`.

### `MessageContext`

```ts
interface MessageContext {
  readonly rule: string;
  readonly key: string;
  readonly field: string;
  readonly label: string;
  readonly value: unknown;
  readonly params: Readonly<Record<string, unknown>>;
  readonly locale: string;
  readonly instance: object;
  readonly path: string;
  readonly index?: number | undefined;
  readonly message?: string | MessageFactory | undefined;
  readonly messageKey?: string | undefined;
}
```

Контекст формирования сообщения: правило, ключ каталога, поле, ярлык, значение, параметры правила, локаль, экземпляр, путь и индекс элемента.

### `MessageFactory`

```ts
type MessageFactory = (context: MessageContext) => string;
```

Функция сообщения из `RuleOptions.message`. Получает `MessageContext` с актуальной локалью; возвращённая строка используется как есть.

### `MessageResolver`

```ts
type MessageResolver = (
  context: MessageContext,
) => string | undefined | Promise<string | undefined>;
```

Резолвер сообщений (например, обёртка над i18next). Возвращает строку или `undefined`, чтобы передать формирование сообщения каталогу. Строка резолвера интерполируется. Асинхронный резолвер поддерживается только в async-функциях: `validateAsync`, `validatePropertyAsync`, `validatePartialAsync`, `safeParseAsync`, `validateOrThrowAsync`; синхронные `validate`, `validateProperty`, `validatePartial`, `safeParse` и `validateOrThrow` в этом случае бросают `Error`.

```ts
configureValidation({
  locale: "en",
  resolve: ({ key, params, locale }) => i18next.t(key, { ...params, lng: locale }),
});
```

### `I18nextLike`

```ts
interface I18nextLike {
  t(key: string, options?: Readonly<Record<string, unknown>>): string;
}
```

Минимальный структурный интерфейс i18next для `createI18nextResolver`: достаточно метода `t`. Зависимости от пакета i18next нет.

### `RuleOptions`

```ts
interface RuleOptions {
  readonly message?: string | MessageFactory | undefined;
  readonly messageKey?: string | undefined;
  readonly label?: string | undefined;
  readonly groups?: readonly string[] | undefined;
  readonly when?: ((instance: object) => boolean) | undefined;
  readonly each?: boolean | undefined;
}
```

Опции правила: собственное сообщение или ключ, ярлык, группы, условие выполнения и опция `each` — применить правило к каждому элементу массива или `Set` вместо значения целиком.

### `RuleDecorator`

```ts
type RuleDecorator = <C extends object, V>(
  value: ClassAccessorDecoratorTarget<C, V>,
  context: ClassAccessorDecoratorContext<C, V>,
) => void;
```

Тип декоратора для stage-3 `accessor`-полей. Все правила и модификаторы возвращают этот тип; обычные поля не поддерживаются.

### `ValidationException`

```ts
class ValidationException extends Error {
  readonly errors: readonly ValidationError[];
  readonly result: ValidationResult;
}
```

Исключение `validateOrThrow`/`validateOrThrowAsync`. Сообщение равно первой ошибке или `"Проверка не пройдена"`, поля `errors` и `result` содержат полный результат.

### `AsyncRuleError`

```ts
class AsyncRuleError extends Error {
  readonly field: string;
  readonly rule: string;
}
```

Бросается синхронными `validate`, `validateProperty`, `validatePartial`, `safeParse` и `validateOrThrow`, если правило вернуло промис. Содержит имя поля и правила.

## Функции сообщений

### `createI18nextResolver`

```ts
function createI18nextResolver(
  i18n: I18nextLike,
  options?: { readonly keyPrefix?: string },
): MessageResolver;
```

Адаптер i18next. Резолвер вызывает `i18n.t(prefix + key, { ...params, label, lng: locale, defaultValue, count })`, где `prefix` — `keyPrefix` (по умолчанию `""`):

- `lng` — текущая локаль (`context.locale`);
- `label` — ярлык поля;
- `defaultValue` — встроенный шаблон для локали, а если его нет — сам ключ;
- `count` — передаётся только для правил `arrayMinSize`, `arrayMaxSize`, `arrayNotEmpty`, `arrayUnique`, `length`, `minLength`, `maxLength`, `each`, `eachValue`; берётся из `params.count`/`min`/`max`/`length`, иначе из длины массива/строки или `Set.size`.

Если `i18n.t` вернул не строку, пустую строку или сам ключ, резолвер возвращает `undefined` и используется встроенный каталог.

```ts
import { configureValidation, createI18nextResolver } from "@ivlev-dev/silent-validation";
import i18next from "i18next";

configureValidation({ resolve: createI18nextResolver(i18next) });
```

## Константы

### `DEFAULT_LOCALE`

```ts
const DEFAULT_LOCALE = "ru";
```

Локаль по умолчанию для сообщений.

### `validationMessages`

```ts
const validationMessages: Readonly<
  Record<string, Readonly<Record<string, string>>>
>;
```

Встроенные каталоги сообщений `ru` и `en`. Ключи имеют вид `validation.<rule>`, шаблоны поддерживают `{label}`, `{value}`, `{field}`, `{index}` и параметры правила (`{min}`, `{max}` и т. д.). Кроме правил есть служебные ключи: `validation.type` (несовпадение типа из схемы), `validation.depth` (вложенность глубже 256 уровней), `validation.each` (ошибка элемента коллекции в `@Each`) и `validation.eachValue` (значение для `@Each` не является коллекцией).

Для правил размера и длины есть плюральные варианты с суффиксами категорий `Intl.PluralRules`: `validation.arrayMinSize_one`, `_few`, `_many`, `_other` для `ru` и `_one`/`_other` для `en` (аналогично `arrayMaxSize`, `minLength`, `maxLength`). Нужная форма выбирается по числу: `params.count`, затем `min`, `max`, `length`, затем число из значения, длина массива/строки или `Set.size`. Например, для `ru`: `1 символ`, `2 символа`, `5 символов`.

```ts
const template = validationMessages.en?.["validation.min"];
```
