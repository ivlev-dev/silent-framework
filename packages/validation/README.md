# @ivlev-dev/silent-validation

Валидация классов на stage 3 декораторах: синхронные и асинхронные проверки, вложенные объекты и коллекции, группы, условные правила и сообщения с поддержкой i18n.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-validation)](https://www.npmjs.com/package/@ivlev-dev/silent-validation)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-validation)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-validation)](https://www.npmjs.com/package/@ivlev-dev/silent-validation)

## Возможности

- Декларативные правила на полях класса: наличие, типы, числа, строки, коллекции, сравнения.
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
// декораторы работают и на обычных полях, и на stage-3 accessor-полях

if (!result.valid) {
  for (const error of result.errors) {
    console.log(error.path, error.rule, error.message);
  }
}
```

Валидация явная: декораторы только регистрируют правила, проверка запускается вызовом `validate`/`validateAsync` (или `validateOrThrow`/`validateOrThrowAsync`).

## API

| Символ | Назначение |
| --- | --- |
| `validate(instance, options?)` | Синхронная проверка, возвращает `ValidationResult` |
| `validateAsync(instance, options?)` | Асинхронная проверка, возвращает `Promise<ValidationResult>` |
| `validateOrThrow(instance, options?)` | Синхронная проверка, при ошибках бросает `ValidationException` |
| `validateOrThrowAsync(instance, options?)` | Асинхронная проверка, при ошибках бросает `ValidationException` |
| `ValidationResult` | `{ valid: boolean; errors: readonly ValidationError[] }` |
| `ValidationError` | Ошибка правила: `field`, `rule`, `message`, `params`, `value`, `path`, `label`, `index?` |
| `ValidationException` | Исключение с полями `errors` и `result` |
| `AsyncRuleError` | Бросается синхронным `validate`, если правило вернуло промис |
| `ValidationOptions` | `groups`, `stopAtFirst`, `labels`, `locale`, `resolve`, `messages` |

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
- `locale`, `resolve`, `messages` — переопределяют глобальный конфиг сообщений для конкретного вызова.

`validate` бросает `AsyncRuleError`, если встретилось асинхронное правило (`Custom` с `async`-функцией). Для таких моделей используйте `validateAsync`.

## Правила

Все декораторы-правила принимают необязательный последний аргумент `RuleOptions` (`message`, `messageKey`, `label`, `groups`, `when`, `each`). Имена декораторов — PascalCase.

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
| `@IsEnum(values)` | Значение входит в массив или набор значений объекта |
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

```ts
import { Groups, Label, Optional, ValidateIf, Min, validate } from "@ivlev-dev/silent-validation";

class Profile {
  @Label("Возраст")
  @Optional()
  @Min(18)
  public accessor age?: number;

  @ValidateIf((instance: Profile) => instance.age !== undefined)
  @Label("Согласие")
  public accessor consent?: boolean;

  @Groups("admin")
  public accessor role?: string;
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

## Ограничения и совместимость

- Поддерживаются обычные и stage-3 `accessor`-поля (`public accessor email!: string`). Приватные (`#field`) и статические поля не поддерживаются — декоратор бросает `TypeError`.
- Валидация явная: декораторы не запускают проверку и не работают без вызова `validate`/`validateAsync`.
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
