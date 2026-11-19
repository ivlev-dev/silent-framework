# @ivlev-dev/silent-validation

Валидация классов на stage 3 декораторах: синхронные и асинхронные проверки, вложенные объекты и коллекции, группы, условные правила и сообщения с поддержкой i18n. Типы полей можно не дублировать декораторами — их проверяет Vite-плагин по TS-аннотациям.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-validation)](https://www.npmjs.com/package/@ivlev-dev/silent-validation)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-validation)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-validation)](https://www.npmjs.com/package/@ivlev-dev/silent-validation)

## Возможности

- Декларативные правила на полях класса: наличие, типы, числа, строки, коллекции, сравнения.
- Валидация из TS-типов без декораторов: Vite-плагин `@ivlev-dev/silent-validation-vite` читает аннотации `accessor`-полей и проверяет типы в рантайме.
- Имена декораторов в PascalCase: `@Required`, `@IsEmail`, `@Min`, `@Nested`.
- Синхронный `validate` и асинхронный `validateAsync` с одинаковым набором правил.
- Вложенная валидация объектов (`@Nested`) и элементов коллекций (`@Each`).
- Модификаторы: `@ValidateIf`, `@Optional`, `@Label`, `@Groups`.
- Сообщения: переопределение через `message`/`messageKey`, ярлыки полей, встроенные каталоги `ru`/`en`, глобальная настройка `configureValidation` и собственный резолвер (например, i18next).
- Пути ошибок вида `address.city` и `items[2].name`.
- Ошибки с машинно-читаемыми полями: `field`, `rule`, `params`, `value`, `path`, `label`, `index`.

## Установка

```bash
pnpm add @ivlev-dev/silent-validation
```

```bash
npm install @ivlev-dev/silent-validation
```

```bash
yarn add @ivlev-dev/silent-validation
```

## Требования

- Node.js >= 22.
- ESM-only (`type: "module"`), импорт только через `import`.
- Stage 3 декораторы TypeScript: `experimentalDecorators: false` (значение по умолчанию в современных конфигурациях).

## Быстрый старт

```ts
import { validate, Required, IsEmail, IsInt, Min, Max } from "@ivlev-dev/silent-validation";

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

const result = validate(user);
// только stage-3 accessor-поля

if (!result.valid) {
  for (const error of result.errors) {
    console.log(error.path, error.rule, error.message);
  }
}
```

Валидация явная: декораторы только регистрируют правила, проверка запускается вызовом `validate`/`validateAsync` (или `validateOrThrow`/`validateOrThrowAsync`).

## Валидация из типов

Типы полей уже описаны в TS-аннотациях, и дублировать их декораторами `@IsString()`/`@IsInt()` не нужно. Vite-плагин читает типы на этапе сборки через TypeScript API и вставляет в класс статическую схему. В рантайме `validate` проверяет по ней значения, а декораторы остаются для семантики: формат, диапазоны, сравнения.

Схему получают только классы-потомки `ValidationModel`. Импортируйте базовый класс из пакета и укажите его в `extends`:

```ts
import { ValidationModel } from "@ivlev-dev/silent-validation";

class User extends ValidationModel {
  public accessor email: string = "";
}
```

Наследование может быть многоуровневым: промежуточные классы сохраняют признак, и потомок на любой глубине получает схему. Класс без `ValidationModel` в цепочке наследования метаданных не получает.

### Подключение плагина

Плагин поставляется отдельным пакетом и устанавливается дополнительно:

```bash
pnpm add -D @ivlev-dev/silent-validation-vite
```

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";
import { validation } from "@ivlev-dev/silent-validation-vite";

export default defineConfig({
  plugins: [silent(), validation()],
});
```

| Опция | Тип | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `include` | `RegExp` | `/\.(?:[cm]?ts\|tsx)$/` | Файлы, которые обрабатывает плагин; заменяет набор по умолчанию |
| `exclude` | `RegExp` | `/node_modules/` | Файлы, которые плагин пропускает |
| `tsconfig` | `string` | ближайший `tsconfig.json` | Путь к конфигу относительно корня проекта |
| `base` | `string` | `"ValidationModel"` | Имя базового класса, потомки которого получают схему |

TypeScript используется только на сборке: `typescript` — зависимость пакета `@ivlev-dev/silent-validation-vite`, рантайм от него не зависит. Плагин самостоятельный: `silent()` нужен только для JSX/VM-компиляции, в обычном Vite-конфиге достаточно `validation()`.

### Пример

```ts
import { validate, ValidationModel } from "@ivlev-dev/silent-validation";

class Address extends ValidationModel {
  public accessor city: string = "";
}

class Item extends ValidationModel {
  public accessor name: string = "";
  public accessor quantity: number = 0;
}

class Order extends ValidationModel {
  public accessor email: string = "";
  public accessor age: number | undefined = undefined;
  public accessor address: Address = new Address();
  public accessor items: Item[] = [];
  public accessor counts: Record<string, number> = {};
}

const order = new Order();
order.email = "user@example.com";
order.address.city = "Москва";
order.items = [new Item()];
order.counts = { apples: 3 };

const result = validate(order);
```

Декораторов в классах нет, но `validate` проверяет типы: `email` — строка, `age` — число или `undefined`, `address` — экземпляр `Address` с корректным `city`, каждый элемент `items` — `Item`, значения `counts` — числа. Для этого плагин добавляет в класс статический блок вида:

```js
static {
  this[Symbol.for("silent.validation.schema")] = { fields: { email: "string", age: ["optional", "number"] } };
}
```

Ошибка типа получает `rule: "type"`, `params.type` с именем ожидаемого типа, сообщение по ключу `validation.type` и обычный `path`:

```ts
const broken = new Order();
Object.assign(broken, { email: 42 });

const { errors } = validate(broken);
// errors[0].rule === "type"
// errors[0].params.type === "string"
// errors[0].path === "email"
```

### Вложенность и пути

Вложенные классы, массивы, `Record` и index-signature дают те же пути, что и `@Nested`/`@Each`:

```ts
class Order extends ValidationModel {
  public accessor address: Address = new Address();
  public accessor items: Item[] = [];
  public accessor counts: Record<string, number> = {};
}
```

Ошибки приходят как `address.city`, `items[0].quantity`; для элементов массива заполняется `index`. Ключи объектов и `Record` идут через точку (`counts.apples`), ключи `Map` — в скобках (`map[userId]`).

### Смешивание с декораторами

Тип проверяется первым. По умолчанию включён каскад (`cascade: true`): даже при неверном типе выполняются декораторы поля, поэтому `@Min(0)` на строке даст и `type`, и `min`. Чтобы остановиться на типовой ошибке, передайте `cascade: false`:

```ts
import { IsEmail, Min, validate, ValidationModel } from "@ivlev-dev/silent-validation";

class User extends ValidationModel {
  @IsEmail()
  public accessor email: string = "";

  @Min(18)
  public accessor age: number = 0;
}

validate(user);
```

`@IsEmail` проверяет формат, `number` и `@Min(18)` — тип и диапазон. `@Required()`/`@Optional()` не нужны: `undefined` и `null` описываются в типе (`string | undefined`, `number | null`), а `@ValidateIf`, `@Label`, `@Groups` работают как раньше.

### Отключение проверки типов

```ts
validate(instance, { types: false });
```

Флаг `types` в `ValidationOptions` по умолчанию `true`. С `types: false` остаются только правила декораторов — удобно, когда схема приходит извне или типы описывают данные шире, чем допустимо в конкретном вызове. Флаг `cascade` (по умолчанию `true`) управляет каскадом: `false` останавливает декораторы поля после ошибки типа. Оба флага можно задать глобально через `configureValidation` и переопределить на вызов.

### Поддерживаемые типы

| Группа | Типы |
| --- | --- |
| Примитивы | `string`, `number`, `boolean`, `bigint`, `symbol`, `object`, `function`, `undefined`, `null`, `void`, `never` |
| Литералы | `"admin"`, `42`, `true` — значение сверяется с литералом |
| Объединения и пересечения | `string \| number`, `A & B`, `T \| null`, `T \| undefined` |
| Массивы и кортежи | `T[]`, `ReadonlyArray<T>`, `[string, number]`, `[string, number?]`, `[string, ...number[]]` |
| Объекты | `Record<K, V>`, `{ [key: string]: T }`, классы и интерфейсы, type alias’ы (структурно, включая рекурсивные) |
| Коллекции | `Map`, `Set`; `WeakMap`/`WeakSet` — только `instanceof`, без проверки ключей и значений |
| Встроенные | `Promise`, `Date`, `RegExp`, `Error` и подклассы, `ArrayBuffer`, `SharedArrayBuffer`, `DataView`, typed arrays, `URL`, `URLSearchParams` |
| Итераторы | `Iterable`, `Iterator`, `AsyncIterable`, `AsyncIterator` |
| Enum | значения `enum` — как у `@IsEnum` |

Валидируются только `accessor`-поля с явной аннотацией; обычные поля и поля без аннотации плагин пропускает.

### Стоимость

- Рантайм: около **3 µs** на `validate` для модели из 6 полей с вложенным классом и массивом из трёх элементов (Intel i5-10400); с `types: false` — около **0.15 µs**. Схемы и планы полей кешируются по конструктору.
- Сборка: TypeScript Program создаётся один раз на проект (около **0.3–0.4 s** на холодную для проекта из 120 файлов); повторные сборки и HMR с тем же экземпляром плагина добавляют единицы миллисекунд. Файлы без `accessor`/`extends` плагин пропускает до создания Program.

### Ограничения

- Метаданные получают только классы с `accessor`-полями и аннотациями; файл должен попадать под `include` и не попадать под `exclude`.
- Схема генерируется только для классов-потомков `ValidationModel`; класс без базового класса не валидируется по типу.
- Optional-поле описывается как `public accessor age: number | undefined = undefined;`. Синтаксис `accessor age?: number` в TypeScript запрещён.
- Mapped-утилиты (`Partial`, `Pick`, `Omit`, `Readonly`, `Required`) поддерживаются структурно. Глубина данных ограничена 256 уровнями (глубже — ошибка `validation.depth`). Условные, template и indexed-типы, а также generic-параметры без конкретизации пропускаются с диагностикой.
- Если класс импортирован только как тип (`import type { Item }`), плагин добавляет namespace-импорт, чтобы проверять экземпляры в рантайме.
- Плагин вставляет статический блок в бандл: без него `validate` увидит только правила декораторов.

## API

| Символ | Назначение |
| --- | --- |
| `validate(instance, options?)` | Синхронная проверка, возвращает `ValidationResult` |
| `validateAsync(instance, options?)` | Асинхронная проверка, возвращает `Promise<ValidationResult>` |
| `validateProperty(instance, field, options?)` | Проверка одного поля |
| `validatePropertyAsync(instance, field, options?)` | Асинхронная проверка одного поля |
| `validatePartial(instance, fields, options?)` | Проверка выбранных полей |
| `validatePartialAsync(instance, fields, options?)` | Асинхронная проверка выбранных полей |
| `safeParse(instance, options?)` | Проверка без исключения: `{ success, data, errors }` |
| `safeParseAsync(instance, options?)` | Асинхронный вариант `safeParse` |
| `validateOrThrow(instance, options?)` | Синхронная проверка, при ошибках бросает `ValidationException` |
| `validateOrThrowAsync(instance, options?)` | Асинхронная проверка, при ошибках бросает `ValidationException` |
| `ValidationResult` | `{ valid: boolean; errors: readonly ValidationError[] }` |
| `ValidationError` | Ошибка правила: `field`, `rule`, `message`, `params`, `value`, `path`, `label`, `index?` |
| `ValidationException` | Исключение с полями `errors` и `result` |
| `AsyncRuleError` | Бросается синхронным `validate`, если правило вернуло промис |
| `ValidationModel` | Базовый класс-маркер: схема из TS-типов генерируется только для его потомков |
| `ValidationOptions` | `groups`, `stopAtFirst`, `labels`, `types`, `cascade`, `locale`, `resolve`, `messages` |

```ts
import {
  validate,
  validateAsync,
  validateOrThrow,
  validateOrThrowAsync,
  ValidationException,
  AsyncRuleError,
} from "@ivlev-dev/silent-validation";
```

- `groups` — проверять только поля с указанными группами; поле без групп участвует всегда.
- `stopAtFirst` — остановиться на первой ошибке.
- `labels` — карта `имя поля → человекочитаемый ярлык`, переопределяет `@Label`.
- `types` — проверка типов из TS-аннотаций (по умолчанию `true`, см. «Валидация из типов»).
- `locale`, `resolve`, `messages` — переопределяют глобальный конфиг сообщений для конкретного вызова.

`validate` бросает `AsyncRuleError`, если встретилось асинхронное правило (`Custom` с `async`-функцией). Для таких моделей используйте `validateAsync`.

## Правила

Все декораторы-правила принимают необязательный последний аргумент `RuleOptions` (`message`, `messageKey`, `label`, `groups`, `when`, `each`). Поведение каскада задаётся `ValidationOptions.cascade` (по умолчанию `true`). Имена декораторов — PascalCase.

### Наличие

| Декоратор | Проверка |
| --- | --- |
| `@Required()` | Значение не `undefined`, не `null` и не пустая строка |
| `@NotNull()` | Значение не `null` и не `undefined` |
| `@NotUndefined()` | Значение не `undefined` |
| `@NotEmpty()` | Непустая строка без пробелов, непустые массив/`Map`/`Set`/объект |
| `@IsDefined()` | Значение не `undefined` |

### Типы

| Декоратор | Проверка |
| --- | --- |
| `@IsString()` | Строка |
| `@IsBoolean()` | `boolean` |
| `@IsInt()` | Целое конечное число |
| `@IsFloat()` | Конечное нецелое число |
| `@IsNumber()` | Конечное число |
| `@IsArray()` | Массив |
| `@IsDate()` | Валидный объект `Date` |
| `@IsEnum(values)` | Значение входит в массив или enum-объект (без обратных ключей числовых enum) |
| `@IsInstanceOf(Ctor)` | Экземпляр указанного класса |
| `@IsObject()` | Объект, не `null` и не массив |
| `@IsFunction()` | Функция |

### Числа

| Декоратор | Проверка |
| --- | --- |
| `@Min(limit)` | `value >= limit` |
| `@Max(limit)` | `value <= limit` |
| `@Between(min, max)` | `min <= value <= max` |
| `@Positive()` | `value > 0` |
| `@Negative()` | `value < 0` |
| `@NonNegative()` | `value >= 0` |
| `@NonPositive()` | `value <= 0` |
| `@MultipleOf(factor)` | Кратность `factor` с допуском `1e-9` |

Числовые правила принимают только конечные числа; `NaN`, `Infinity`, строки и `null` не проходят.

### Строки

| Декоратор | Проверка |
| --- | --- |
| `@MinLength(min)` | Длина не меньше `min` |
| `@MaxLength(max)` | Длина не больше `max` |
| `@Length(length)` | Длина ровно `length` |
| `@Matches(pattern)` | Совпадение с `RegExp` или строковым шаблоном |
| `@IsEmail()` | Корректный email |
| `@IsUrl()` | URL с протоколом `http:` или `https:` |
| `@IsUUID()` | UUID |
| `@IsISO8601()` | Дата ISO 8601 |
| `@IsPhone()` | Телефон: `+`, цифры, пробелы, скобки, дефисы; 7–20 символов |
| `@IsAlpha()` | Только буквы (Unicode) |
| `@IsAlphanumeric()` | Только буквы и цифры (Unicode) |
| `@IsSlug()` | `kebab-case` из строчных латинских букв и цифр |
| `@IsHexColor()` | Цвет `#RGB`, `#RGBA`, `#RRGGBB` или `#RRGGBBAA` |
| `@IsBase64()` | Корректная Base64-строка |
| `@IsJSON()` | Строка с валидным JSON |

### Коллекции

| Декоратор | Проверка |
| --- | --- |
| `@ArrayMinSize(min)` | Не меньше `min` элементов |
| `@ArrayMaxSize(max)` | Не больше `max` элементов |
| `@ArrayNotEmpty()` | Непустая коллекция |
| `@ArrayUnique()` | Элементы не повторяются |
| `@HasKey(key)` | Объект содержит ключ |
| `@Nested()` | Вложенный объект валидируется своими правилами |
| `@Each()` | Каждый элемент массива или `Set` валидируется как вложенный объект |

Для примитивных элементов используйте `each` в опциях правила:

```ts
class Model {
  @Min(0, { each: true })
  public accessor scores!: number[];
}
```

### Сравнения

| Декоратор | Проверка |
| --- | --- |
| `@Equals(expected)` | Равенство `expected` |
| `@NotEquals(expected)` | Неравенство `expected` |
| `@IsIn(values)` | Значение входит в список |
| `@NotIn(values)` | Значение не входит в список |

### Custom

```ts
import { Custom, validate } from "@ivlev-dev/silent-validation";

class Order {
  @Custom((value) => typeof value === "string" && value.startsWith("ORD-"))
  public accessor number!: string;

  @Custom(async (value) => value !== "blocked")
  public accessor status!: string;
}
```

`Custom` принимает функцию `(value, context) => boolean | Promise<boolean>`. Асинхронная функция требует `validateAsync`, иначе синхронный `validate` бросит `AsyncRuleError`.

## Модификаторы

| Декоратор | Назначение |
| --- | --- |
| `@ValidateIf(predicate)` | Проверять поле, только если `predicate(instance)` истинно |
| `@Optional()` | Пропустить все правила поля, если значение `null` или `undefined` |
| `@Label(text)` | Человекочитаемое имя поля для сообщений |
| `@Groups(...groups)` | Отнести поле к группам; проверяется при совпадении `options.groups` |
| `@ValidateOnSet()` | Проверять поле при каждом присваивании и бросать `ValidationException` |

```ts
import { Groups, Label, Optional, ValidateIf, Min, validate } from "@ivlev-dev/silent-validation";

class Profile {
  @Label("Возраст")
  @Optional()
  @Min(18)
  public accessor age: number | undefined = undefined;

  @ValidateIf((instance: Profile) => instance.age !== undefined)
  @Label("Согласие")
  public accessor consent: boolean | undefined = undefined;

  @Groups("admin")
  public accessor role: string | undefined = undefined;
}

validate(profile, { groups: ["admin"] });
```

Поле без групп выполняется при любом `groups`; поле с группой выполняется, только если хотя бы одна его группа указана в вызове.

## Сообщения

Каждое правило формирует ключ `validation.<rule>`, например `validation.min` или `validation.isEmail`. Встроенные каталоги — `ru` (по умолчанию, `DEFAULT_LOCALE`) и `en`.

```ts
import { validate, Required, Min, IsEmail } from "@ivlev-dev/silent-validation";

class User {
  @Required({ message: "Укажите email" })
  @IsEmail({ messageKey: "validation.required" })
  public accessor email!: string;

  @Min(18, { message: ({ label, params }) => `${label}: минимум ${params.min}` })
  public accessor age!: number;
}
```

- `message` — строка с плейсхолдерами `{label}`, `{value}`, `{field}`, `{index}` и параметрами правила, либо функция `(context) => string`. Имеет приоритет над резолвером и каталогом.
- `messageKey` — другой ключ каталога, например `validation.required`.
- `label` — ярлык поля в сообщении; приоритет: `options.label` → `@Label` → `options.labels[field]` → имя поля.

### Глобальный конфиг

```ts
import {
  configureValidation,
  getValidationConfig,
  resetValidationConfig,
} from "@ivlev-dev/silent-validation";

configureValidation({
  locale: "en",
  messages: {
    en: {
      "validation.min": "{label} must be at least {min}",
    },
  },
});

const config = getValidationConfig();
resetValidationConfig();
```

`configureValidation` мержит переданные поля с текущими настройками: `locale`, `resolve`, `messages`. Значения `messages` переопределяют встроенные каталоги. Если ключа нет в выбранной локали, используется `ru`, затем встроенный `en`.

### Резолвер (i18next)

```ts
import { configureValidation } from "@ivlev-dev/silent-validation";
import i18next from "i18next";

configureValidation({
  locale: "en",
  resolve: ({ key, params, locale }) => i18next.t(key, { ...params, lng: locale }),
});
```

Резолвер `MessageResolver` получает `key`, `params`, `locale`, `label`, `field`, `value`, `path` и возвращает строку или `undefined`. При `undefined` используется каталог. Возвращённая строка интерполируется так же, как шаблон каталога.

Резолвер может быть асинхронным: `resolve` вправе вернуть `Promise<string | undefined>`, но такой режим работает только в `validateAsync` (и других async-функциях); синхронный `validate` бросит `Error`. Для i18next есть готовый адаптер `createI18nextResolver`.

Для правил размера и длины (`arrayMinSize`, `arrayMaxSize`, `minLength`, `maxLength`) встроенные каталоги содержат плюральные формы (`_one`/`_few`/`_many` в `ru`, `_one`/`_other` в `en`). Форма выбирается по числу из `params.count`/`min`/`max`/`length` или по значению.

## Вложенность

```ts
import { Nested, Each, Required, IsInt, validate } from "@ivlev-dev/silent-validation";

class Address {
  @Required()
  public accessor city!: string;
}

class Item {
  @Required()
  public accessor name!: string;

  @IsInt()
  public accessor quantity!: number;
}

class Order {
  @Nested()
  public accessor address!: Address;

  @Each()
  public accessor items!: Item[];
}

const result = validate(order);
```

Пути ошибок: `address.city`, `items[0].name`, `items[2].quantity`. Для ошибок элементов коллекций заполняется `ValidationError.index` и доступен плейсхолдер `{index}`; путь всегда содержит индекс элемента.

`@Nested()` проверяет вложенный объект правилами его класса. `@Each()` делает то же для каждого элемента массива или `Set` и сообщает ошибку, если коллекция или элемент имеют неверный тип. Для примитивных элементов используйте `@Min(0, { each: true })`.

Элементы `@Each()` должны быть созданы конструктором класса с декораторами — правила регистрируются при инициализации экземпляра. Plain-объекты без декораторов считаются валидными (у них нет правил).

## Ограничения и совместимость

- Поддерживаются только stage-3 `accessor`-поля (`public accessor email!: string`). Обычные поля, приватные (`#field`) и статические поля не поддерживаются — декоратор бросает `TypeError` (и типы не дадут применить его к обычному полю).
- Optional-поле описывается через `| undefined`: `public accessor age: number | undefined = undefined;`. Синтаксис `accessor age?: number` в TypeScript запрещён.
- Типы проверяются только из аннотаций `accessor`-полей и только при подключённом плагине `validation()` из `@ivlev-dev/silent-validation-vite`. Обычные поля и поля без аннотации остаются без проверки типов; условные/mapped/template/indexed-типы и generic-параметры пропускаются.
- Валидация явная: ни декораторы, ни типы из аннотаций не запускают проверку без вызова `validate`/`validateAsync`.
- Нужны stage 3 декораторы: `experimentalDecorators: false`. Legacy-декораторы (`experimentalDecorators: true`) не поддерживаются.
- ESM-only, Node.js >= 22.
- `validate` не поддерживает асинхронные правила — используйте `validateAsync`.
- Вложенный объект должен быть создан конструктором класса с декораторами: правила регистрируются при инициализации экземпляра. Plain-объекты без декораторов считаются валидными (у них нет правил). Кольцевые ссылки не приводят к бесконечной рекурсии.
- Пути и сообщения не зависят от фреймворка: пакет не требует `@ivlev-dev/silent-core`.

## Ссылки

- Репозиторий: https://github.com/ivlev-dev/silent-framework
- Документация API: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/validation.md
- CHANGELOG: https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md
- Issues: https://github.com/ivlev-dev/silent-framework/issues

---

MIT © ivlev-dev
