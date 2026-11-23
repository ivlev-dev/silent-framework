# @ivlev-dev/silent-protocol

Бинарный протокол вместо JSON: схема — сам класс, на wire нет имён полей и тегов, значения идут в порядке сортировки имён. Пакет содержит рантайм `encode`/`decode`, generic-кодек по схеме, статические кодеки, примитивы `Writer`/`Reader` и низкоуровневые помощники, которые использует сгенерированный код.

Полная спецификация формата, wire-типы, bitmap, oneof и кросс-языковые векторы — в [`docs/protocol.md`](../../protocol.md).

### Установка

```bash
pnpm add @ivlev-dev/silent-protocol
pnpm add -D @ivlev-dev/silent-protocol-vite
```

- Node.js >= 22, ESM-only, без нативных зависимостей.
- `@ivlev-dev/silent-protocol-vite` нужен только на этапе сборки: он генерирует схему и статический кодек из TS-класса.
- Без плагина схему задают вручную через `defineProtocol`.
- Декораторы рассчитаны на stage-3 `accessor`-поля: `experimentalDecorators: false`, `useDefineForClassFields: true`.

### Базовый пример

```ts
import { decode, encode, ProtocolModel } from "@ivlev-dev/silent-protocol";

class Address extends ProtocolModel {
  public accessor city = "";
  public accessor zip = 0;
}

class User extends ProtocolModel {
  public accessor name = "";
  public accessor address: Address = new Address();
  public accessor tags: string[] = [];
  public accessor email: string | undefined = undefined;
}

const user = new User();
user.name = "Ivan";
user.address.city = "Moscow";
user.tags = ["admin", "beta"];

const bytes: Uint8Array = encode(user);
const restored: User = decode(User, bytes);
```

`ProtocolModel` — пустая база-маркер. Она ничего не делает в рантайме, но делает модель явной и удобной для наследования и поиска.

### Кодирование и декодирование

```ts
import { decode, encode } from "@ivlev-dev/silent-protocol";

const bytes = encode(value, { maxSize: 1 << 20, maxDepth: 64 });
const restored = decode(User, bytes, { allowTrailing: false, validate: true });
```

`encode(value, options?)`:

- принимает только объект; иначе `ProtocolError` с кодом `"value"`;
- пишет поля в порядке сортировки по UTF-8, порядок объявления не важен;
- возвращает новый `Uint8Array` длиной, равной длине сообщения;
- обнаруживает циклы объектов (`"cycle"`), превышение глубины (`"depth"`) и размера (`"size"`);
- при `validate` запускает валидатор до кодирования.

`decode(ctor, bytes, options?)`:

- принимает конструктор и `Uint8Array`; иначе `ProtocolError("value")`;
- создаёт экземпляр через `new ctor()`, поэтому у класса должен быть конструктор без обязательных аргументов;
- по умолчанию требует, чтобы после сообщения не осталось байт (`"trailing"`); `allowTrailing: true` разрешает хвост;
- при `validate` проверяет результат уже после декодирования.

Опции:

| Опция | Где | Тип | По умолчанию | Назначение |
| --- | --- | --- | --- | --- |
| `validate` | `encode`, `decode` | `boolean \| ValidateHook` | нет | Запустить валидацию значения |
| `maxSize` | `encode`, `decode` | `number` | `DEFAULT_MAX_SIZE` (64 MiB) | Лимит размера сообщения в байтах |
| `maxDepth` | `encode`, `decode` | `number` | `DEFAULT_MAX_DEPTH` (256) | Лимит глубины вложенности |
| `allowTrailing` | `decode` | `boolean` | `false` | Разрешить лишние байты после сообщения |

Некорректный лимит (`0`, отрицательное число, `NaN`, `Infinity`) — `ProtocolError` с кодом `"schema"`.

### `ProtocolModel`

```ts
export class ProtocolModel {}
```

Маркер-база без полей и методов. Наследование от неё не обязательно: плагин обрабатывает любой класс с полями, а `defineProtocol` работает с произвольным конструктором. Наследование удобно как соглашение и позволяет типизировать общие операции над моделями.

### `defineProtocol`

Ручное определение схемы без плагина:

```ts
import { decode, defineProtocol, encode, type SchemaInput } from "@ivlev-dev/silent-protocol";

class Point {
  public x = 0;
  public y = 0;
}

const schema: SchemaInput = {
  fields: [
    { name: "x", type: "int32" },
    { name: "y", type: "int32" },
  ],
};

defineProtocol(Point, schema);

const bytes = encode(new Point());
const restored = decode(Point, bytes);
```

Схема принимает две формы:

- массив `SchemaEntry` (`FieldEntry | OneofEntry`) — плоский список;
- объект `SchemaDefinition`: `version?`, `fields` (массив `FieldSchema` или запись `Record<string, TypeSchema>`), `oneofs?` (массив `OneofDefinition` или запись).

`defineProtocol` только прикрепляет описание к конструктору через `PROTOCOL_SCHEMA` (неперечисляемое, конфигурируемое свойство). Валидация схемы ленивая: она выполняется при первом `getSchema`, `encode` или `decode`. Ошибки: дубликаты полей и oneof, неизвестные типы, несовместимые wire-декораторы, неподдерживаемая версия схемы.

Схема наследуется: `getSchema` собирает цепочку прототипов, поля предка входят в схему, одноимённое поле потомка переопределяет базовое. Имена oneof не могут совпадать с именами полей.

### `getSchema`

```ts
import { getSchema } from "@ivlev-dev/silent-protocol";

const normalized = getSchema(User);
normalized.fields;
normalized.oneofs;
```

Возвращает `NormalizedSchema`: поля и oneof, отсортированные по имени, с разрешёнными типами и wire-опциями. Результат кешируется по конструктору, цепочке прототипов и версии опций; повторный вызов не пересобирает схему, пока не изменились декораторы или сама схема. Если схема не задана — `ProtocolError("schema")`.

`NormalizedField` — `{ name, type, optional, wire }`. `NormalizedVariant` — `{ value, field, type, wire }`. `NormalizedOneof` — `{ name, enum, variants }`.

### `registerFieldOption`

```ts
import { registerFieldOption } from "@ivlev-dev/silent-protocol";

registerFieldOption(User, "score", { wire: "int32" });
registerFieldOption(Event, "created", { oneof: 1 });
```

Регистрирует wire-опцию или привязку к oneof для поля вручную, без декораторов. Именно эту функцию вызывают `@Int32`, `@OneOf` и остальные декораторы из инициализатора поля. Опции хранятся в `Map` под символом `PROTOCOL_OPTIONS` и накапливаются: `wire` и `oneof` обновляются только если заданы, повторная регистрация тех же значений ничего не меняет. Функция не создаёт схему сама — поля всё равно должны быть описаны через `defineProtocol` или плагин.

### `compareUtf8`

```ts
import { compareUtf8 } from "@ivlev-dev/silent-protocol";

const names = ["я", "a", "Z"].sort(compareUtf8);
```

Компаратор канонического порядка: сравнивает строки по UTF-8 байтам (code point с корректным обходом surrogate pairs). Используется для сортировки полей, oneof и ключей `Map`/`Set`, чтобы TS, Rust и Kotlin давали одинаковые байты. Возвращает отрицательное число, `0` или положительное число.

### Символы схемы и кодека

| Экспорт | Значение | Назначение |
| --- | --- | --- |
| `PROTOCOL_SCHEMA` | `Symbol.for("silent.protocol.schema")` | Схема, прикреплённая к конструктору |
| `PROTOCOL_OPTIONS` | `Symbol.for("silent.protocol.options")` | `Map` wire/oneof-опций полей |
| `PROTOCOL_CODEC` | `unique symbol`, `Symbol.for("silent.protocol.codec")` | Статический кодек `write`/`read` |
| `VALIDATION_HOOK` | `Symbol.for("silent.validation.validate")` | Глобальный хук валидации |
| `SCHEMA_VERSION` | `1` | Поддерживаемая версия описания схемы |
| `DEFAULT_MAX_DEPTH` | `256` | Лимит глубины по умолчанию |
| `DEFAULT_MAX_SIZE` | `64 * 1024 * 1024` | Лимит размера по умолчанию |

Символы глобальные (`Symbol.for`), поэтому схема и кодек видны между копиями пакета в одном процессе. Схему можно прикрепить и напрямую:

```ts
import { PROTOCOL_SCHEMA } from "@ivlev-dev/silent-protocol";

Object.defineProperty(User, PROTOCOL_SCHEMA, {
  value: { fields: [{ name: "name", type: "string" }] },
  configurable: true,
  writable: true,
});
```

### `ProtocolError` и коды

```ts
import { ProtocolError } from "@ivlev-dev/silent-protocol";

try {
  decode(User, bytes);
} catch (error) {
  if (error instanceof ProtocolError) {
    console.log(error.code, error.path, error.message);
  }
}
```

`ProtocolError` наследуется от `Error`, поле `code: ProtocolErrorCode`, необязательное `path` (путь до поля, например `User.address.city`). Если путь задан, он добавляется к сообщению в виде `path: message`.

| Код | Причина |
| --- | --- |
| `truncated` | Буфер закончился раньше, чем прочитано значение |
| `invalid_varint` | Некорректный varint (слишком длинный или переполненный) |
| `schema` | Нет схемы, дубликаты, несовместимый декоратор, неверный лимит |
| `depth` | Превышен `maxDepth` |
| `cycle` | Цикл объектов при кодировании |
| `range` | Значение вне диапазона wire-типа, невалидная `Date`, переполнение epoch |
| `unknown_enum` | Значение enum или дискриминатора oneof отсутствует в схеме |
| `trailing` | После сообщения остались байты, а `allowTrailing` выключен |
| `size` | Превышен лимит размера сообщения или длины |
| `validation` | Хук не установлен, упал или вернул неуспех |
| `value` | Неверный JS-тип значения или поля |
| `oneof` | Дискриминатор не целый, выбрано несколько вариантов или у варианта нет значения |

### Декораторы

Все декораторы — функции, возвращающие `ProtocolAccessorDecorator`. Они применяются только к stage-3 `accessor`-полям, не приватным и не статическим; на обычном поле или при `experimentalDecorators: true` рантайм бросит `TypeError`.

```ts
import {
  EpochMillis,
  Fixed32,
  Fixed64,
  Float32,
  Int32,
  Int64,
  ProtocolModel,
  Uint32,
  Uint64,
} from "@ivlev-dev/silent-protocol";

class Metrics extends ProtocolModel {
  @Int32()
  public accessor delta = 0;

  @Uint32()
  public accessor requests = 0;

  @Float32()
  public accessor ratio = 0;

  @Fixed32()
  public accessor mask = 0;

  @Fixed64()
  public accessor checksum = 0n;

  @Uint64()
  public accessor total = 0n;

  @Int64()
  public accessor signed = 0n;

  @EpochMillis()
  public accessor at: Date = new Date(0);
}
```

| Декоратор | Wire-тип | Допустимый TS-тип |
| --- | --- | --- |
| `Int32` (`@Int32()`) | zigzag varint | `number` |
| `Uint32` (`@Uint32()`) | varint | `number` |
| `Float32` (`@Float32()`) | IEEE 754, 4 байта LE | `number` |
| `Fixed32` (`@Fixed32()`) | 4 байта LE | `number` |
| `Fixed64` (`@Fixed64()`) | 8 байт LE | `number` или `bigint` |
| `Uint64` (`@Uint64()`) | varint | `number` или `bigint` |
| `Int64` (`@Int64()`) | zigzag varint | только `bigint` |
| `EpochMillis` (`@EpochMillis()`) | epoch ms | `number`, `bigint` или `Date` |

Без декоратора `number` кодируется как `float64`, `bigint` — как `bigint` (int64 zigzag), `Date` — как `date`. `@Int64` на `number` — ошибка схемы: 64-битные целые в TS представляются `bigint`. Несколько wire-декораторов на одном поле не проверяются в момент применения; схема оставит последнюю зарегистрированную опцию и проверит её совместимость с типом.

### `OneOf` и oneof

```ts
import { OneOf, ProtocolModel } from "@ivlev-dev/silent-protocol";

enum EventKind {
  Created = 1,
  Updated = 2,
  Deleted = 3,
}

class Event extends ProtocolModel {
  public accessor kind: EventKind = EventKind.Created;

  @OneOf(EventKind.Created)
  public accessor created: string | undefined = undefined;

  @OneOf(EventKind.Updated)
  public accessor updated: number | undefined = undefined;

  @OneOf(EventKind.Deleted)
  public accessor deleted: null | undefined = undefined;
}
```

`OneOf(value)` принимает целое число `0..0x7fffffff` (значение члена enum) и привязывает optional-поле к дискриминатору. Правила:

- дискриминатор — непустое enum-поле, не optional;
- каждый вариант — optional-поле с `@OneOf(значение)`;
- при кодировании ровно один вариант соответствует значению дискриминатора; отсутствующий вариант с payload — `"oneof"`, лишние установленные — `"oneof"`, неизвестное значение — `"unknown_enum"`;
- вариант с типом `null` или литералом считается unit-вариантом и занимает ноль байт payload;
- варианты не входят в bitmap; oneof занимает позицию дискриминатора;
- если вариант описан в схеме, но `@OneOf` отсутствует, привязка берётся из `OneofSchema`; расхождение значения — ошибка схемы.

### `Writer`

```ts
import { Writer } from "@ivlev-dev/silent-protocol";

const writer = new Writer(1024);
writer.varint(300);
writer.string("ok");
const bytes = writer.finish();
```

Низкоуровневый писатель в буфер с лимитом `maxSize`. При переполнении — `ProtocolError("size")`.

| Метод/свойство | Назначение |
| --- | --- |
| `new Writer(maxSize)` | Создать буфер с лимитом |
| `size` | Текущая длина записанных данных |
| `capacity` | Ёмкость буфера |
| `reset(maxSize)` | Сбросить длину и лимит |
| `byte(value)` | Один байт `0..255` |
| `bool(value)` | `0` или `1` |
| `varint(value)` | Varint из `number` или `bigint` |
| `zigzag(value)` | Zigzag-varint из `number` или `bigint` |
| `fixed32(value)` | 4 байта LE |
| `fixed64(value)` | 8 байт LE из `bigint` |
| `float32(value)` / `float64(value)` | IEEE 754 LE |
| `raw(bytes)` | Сырые байты без длины |
| `bytes(value)` | Varint-длина + байты |
| `string(value)` | Varint-длина UTF-8 + байты |
| `bitmap(bits)` | Биты в байтах, LSB-first |
| `bitmapMask(mask, count)` | Маска до 32 бит |
| `finish()` | Копия записанных байт |

### `Reader`

```ts
import { Reader } from "@ivlev-dev/silent-protocol";

const reader = new Reader(bytes, 1024);
const count = reader.readLength("items");
const item = reader.varint("item");
```

Читатель с лимитом `maxSize`; при выходе за границы или неверном varint бросает `ProtocolError` с `path`. Методы принимают `path` и необязательные `part`/`index`, которые формируют путь ошибки.

| Метод/свойство | Назначение |
| --- | --- |
| `new Reader(bytes, maxSize)` | Читатель поверх `Uint8Array` |
| `reset(bytes, maxSize)` | Переиспользовать под другой буфер |
| `release()` | Освободить ссылку на буфер |
| `remaining` | Сколько байт осталось |
| `offset` | Текущая позиция |
| `byte(path, part?, index?)` | Один байт |
| `bool(...)` | `0`/`1` как boolean |
| `varint(...)` | Varint как `bigint` |
| `varintNumber(path, max, part?, index?)` | Varint как `number` с верхней границей |
| `zigzag(...)` | Zigzag-varint как `bigint` |
| `zigzagNumber(...)` | Zigzag-varint как `number` |
| `fixed32(...)` / `fixed64(...)` | LE, `number` / `bigint` |
| `float32(...)` / `float64(...)` | IEEE 754 LE |
| `readLength(...)` | Varint-длина с проверкой лимита |
| `bytes(...)` | Длина + `Uint8Array` (subarray) |
| `string(...)` | Длина + UTF-8 строка |
| `bitmap(count, path, part?, index?)` | Массив boolean |
| `bitmapMask(count, path, part?, index?)` | Маска до 32 бит как `number` |

### `pathWith` и `PathPart`

```ts
import { pathWith, type PathPart } from "@ivlev-dev/silent-protocol";

const part: PathPart = "items";
const path = pathWith("Order", part, 3);
```

`PathPart` — `string | number`. `pathWith(path, part?, index?)` собирает читаемый путь для ошибок (`Order.items[3]`) и возвращает исходный путь, если часть не задана. Помощники и `Reader` используют его, чтобы `ProtocolError.path` указывал на конкретное поле или элемент.

### `EncodeContext` и `DecodeContext`

```ts
import { DecodeContext, EncodeContext } from "@ivlev-dev/silent-protocol";

const encodeContext = new EncodeContext(256);
encodeContext.enter(value, "User");
encodeContext.leave(value);
```

Контексты хранят глубину и стек предков, реализуя лимиты и обнаружение циклов. Их создаёт `encode`/`decode` и передаёт в кодек; вручную нужны только при вызове низкоуровневых помощников.

- `EncodeContext(maxDepth)` — `enter(value, path)` проверяет цикл и глубину, `leave(value)` снимает со стека, `reset(maxDepth)` переиспользует объект.
- `DecodeContext(maxDepth)` — `enter(path, part?, index?)` увеличивает глубину, `leave()` уменьшает, `reset(maxDepth)` сбрасывает.
- Превышение глубины — `"depth"`, повторный объект в стеке — `"cycle"`.

### `writeMessage` и `readMessage`

```ts
import { EncodeContext, Writer, writeMessage } from "@ivlev-dev/silent-protocol";

const writer = new Writer(1024);
const context = new EncodeContext(256);
writeMessage(Address, address, writer, context, "User.address");
```

- `writeMessage(ctor, value, writer, context, path)` — если у конструктора есть `PROTOCOL_CODEC`, вызывает его `write`; иначе идёт generic-путём по схеме. Вход/выход из контекста оборачивает вызов.
- `readMessage(ctor, reader, context, path)` — аналогично, но создаёт экземпляр и возвращает его; статический кодек имеет приоритет над generic.

Эти функции — точка входа для сгенерированных кодеков; вложенные сообщения не имеют length-префикса и читаются по схеме.

### `writeArray` и `readArray`

```ts
import { EncodeContext, Writer, writeArray, writeMessage } from "@ivlev-dev/silent-protocol";

const writer = new Writer(1024);
const context = new EncodeContext(256);
writeArray(addresses, writer, context, "User.addresses", (item, index) => {
  writeMessage(Address, item, writer, context, `User.addresses[${index}]`);
});
```

- `writeArray(items, writer, context, path, writeItem)` — пишет varint-длину и элементы по порядку.
- `readArray(reader, context, path, readItem, part?)` — читает длину, создаёт массив и вызывает `readItem(index)` для каждого элемента.
- Оба входят в контекст, поэтому массивы участвуют в лимите глубины и проверке циклов.

### `writeOptionalArray` и `readOptionalArray`

```ts
import {
  DecodeContext,
  EncodeContext,
  Reader,
  Writer,
  readOptionalArray,
  writeOptionalArray,
} from "@ivlev-dev/silent-protocol";

const writer = new Writer(1024);
const encodeContext = new EncodeContext(256);
writeOptionalArray(values, writer, encodeContext, "items", (item) => {
  writer.string(item);
});

const reader = new Reader(writer.finish(), 1024);
const decodeContext = new DecodeContext(256);
const restored = readOptionalArray(reader, decodeContext, "items", () => reader.string("item"));
```

Формат: `[count][bitmap][значения только для установленных битов]`. До 32 элементов используется компактная маска (`bitmapMask`), больше — побайтовый bitmap. `null` и `undefined` считаются отсутствием. `readOptionalArray` возвращает `(T | undefined)[]`.

### `writeMap` и `readMap`

```ts
import { EncodeContext, Writer, writeMap } from "@ivlev-dev/silent-protocol";

const writer = new Writer(1024);
const context = new EncodeContext(256);
writeMap(
  scores,
  writer,
  context,
  "User.scores",
  (key) => key,
  (key) => writer.string(key),
  (value) => writer.varint(value),
);
```

- `writeMap(map, writer, context, path, sortKey, writeKey, writeValue)` — сортирует записи по `sortKey` канонически (числа численно, строки по UTF-8), пишет длину и пары ключ/значение.
- `readMap(reader, context, path, readKey, readValue)` — возвращает `Map`.
- Ключи: `string`, целые, `bool`, числовой enum. `float`, `bytes` и классы — ошибка схемы.
- Optional-значения кодируются bitmap после count; static-кодек плагина для такого случая не генерируется, работает generic-путь.

### `writeSet` и `readSet`

```ts
import { EncodeContext, Writer, writeSet } from "@ivlev-dev/silent-protocol";

const writer = new Writer(1024);
const context = new EncodeContext(256);
writeSet(tags, writer, context, "User.tags", (value) => value, (value) => writer.string(value));
```

- `writeSet(set, writer, context, path, sortKey, writeValue)` — сортирует значения тем же каноническим компаратором и пишет длину + значения.
- `readSet(reader, context, path, readValue)` — возвращает `Set`.
- Пустая коллекция занимает один байт `0`.

### `StaticCodec`

```ts
import type { StaticCodec } from "@ivlev-dev/silent-protocol";

class Point {
  public x = 0;
  public y = 0;
}

const codec: StaticCodec<Point> = {
  write(value, writer, context, path) {
    writer.zigzag(value.x);
    writer.zigzag(value.y);
  },
  read(reader, context, path) {
    const point = new Point();
    point.x = reader.zigzagNumber(`${path}.x`);
    point.y = reader.zigzagNumber(`${path}.y`);
    return point;
  },
};
```

`StaticCodec<T>` — интерфейс `{ write(value, writer, context, path): void; read(reader, context, path): T }`. Кодек прикрепляется к конструктору под `PROTOCOL_CODEC`; рантайм проверяет, что это объект с функциями `write` и `read`, и предпочитает его generic-схеме. Плагин `protocol()` генерирует такой кодек автоматически; ручное прикрепление полезно для ручных схем и точечных оптимизаций. Байты статического и generic-кодека совпадают.

```ts
import { PROTOCOL_CODEC, decode, encode, type StaticCodec } from "@ivlev-dev/silent-protocol";

Object.defineProperty(Point, PROTOCOL_CODEC, {
  value: codec satisfies StaticCodec<Point>,
  configurable: true,
  writable: true,
});

encode(new Point());
decode(Point, new Uint8Array());
```

### Нативные типы и коллекции

| TS-тип | Wire-тип |
| --- | --- |
| `string` | varint-длина + UTF-8 |
| `boolean` | 1 байт |
| `number` | `float64` (или wire-декоратор) |
| `bigint` | `bigint` / int64 zigzag |
| `Date` | `date`, epoch ms; `Invalid Date` — `"range"` |
| `Uint8Array`, `ArrayBuffer`, `DataView` | `bytes` |
| `Int8Array`…`BigUint64Array` | `bytes`, little-endian |
| `Array<T>`, `ReadonlyArray<T>` | `array` |
| кортеж `[A, B]` | `tuple`, optional-слоты через bitmap |
| `Map<K, V>`, `ReadonlyMap<K, V>` | `map` |
| `Set<T>`, `ReadonlySet<T>` | `set` |
| `Record<string, T>` | `record` = map со строковыми ключами |
| enum | числовой enum — varint, строковый — индекс значения |
| литерал | 0 байт, значение проверяется |

`RegExp`, `URL`, `URLSearchParams`, `WeakMap`, `WeakSet`, функции и `Promise` схемой не поддерживаются. `any` и `unknown` не сериализуются.

### Лимиты, глубина и циклы

- `DEFAULT_MAX_SIZE` — 64 MiB на сообщение; лимит проверяется и при записи, и при чтении длины.
- `DEFAULT_MAX_DEPTH` — 256 уровней вложенности сообщений, массивов, карт, множеств и кортежей.
- Повторная ссылка на тот же объект в стеке кодирования — `"cycle"`. Разделяемые, но не циклические ссылки допускаются, если не образуют цикл.
- `decode` по умолчанию не допускает хвост: лишние байты — `"trailing"`.
- 64-битные значения вне диапазона int64/uint64, `fixed32` вне 32 бит, `Invalid Date` и epoch вне диапазона `Date` — `"range"`.

### Валидация

```ts
import { encode } from "@ivlev-dev/silent-protocol";

const bytes = encode(user, { validate: true });
const bytes2 = encode(user, {
  validate(value) {
    return user.name.length > 0;
  },
});
```

`validate: true` ищет глобальный хук под `VALIDATION_HOOK` (`Symbol.for("silent.validation.validate")`); если его нет — `ProtocolError("validation")`. В `@ivlev-dev/silent-validation` хук устанавливается автоматически. Можно передать собственную функцию `ValidateHook = (value) => ValidateResult`.

`ValidateResult` — `boolean` или `{ valid: boolean; errors?: readonly unknown[] }`. Ложный результат, исключение внутри хука и неверная форма результата превращаются в `ProtocolError("validation")`; массив `errors` попадает в сообщение.

### Справочник типов

| Тип | Описание |
| --- | --- |
| `EncodeOptions` | `{ validate?, maxSize?, maxDepth? }` |
| `DecodeOptions` | `{ validate?, maxSize?, maxDepth?, allowTrailing? }` |
| `ValidateHook` | `(value: object) => ValidateResult` |
| `ValidateResult` | `boolean \| { valid: boolean; errors? }` |
| `ProtocolErrorCode` | Объединение кодов ошибок |
| `ProtocolConstructor` | `new (...args: never[]) => T` |
| `ProtocolAccessorDecorator` | Тип декоратора stage-3 accessor |
| `StaticCodec<T>` | Интерфейс статического кодека |
| `PathPart` | `string \| number` |
| `PrimitiveType` | Строковые wire-типы, включая `epochMillis` и `null` |
| `WireTypeName` | Wire-типы, допустимые в `FieldOptions.wire` |
| `LiteralValue` | `string \| number \| boolean \| null` |
| `TypeSchema` | Рекурсивное описание типа поля |
| `FieldSchema` | `{ name, type, optional? }` |
| `FieldEntry` | `FieldSchema` с `kind: "field"` |
| `OneofSchema` | `{ name, enum, variants }` |
| `OneofEntry` | `OneofSchema` с `kind: "oneof"` |
| `Variant` | `{ value, field, type }` |
| `VariantDefinition` | `{ value, field, type? }` |
| `OneofDefinition` | `{ name, enum, variants }` |
| `SchemaEntry` | `FieldEntry \| OneofEntry` |
| `SchemaObject` | `{ version?, fields, oneofs? }` |
| `SchemaDefinition` | `{ version?, fields, oneofs? }` в форме определения |
| `SchemaInput` | `readonly SchemaEntry[] \| SchemaDefinition` |
| `Schema` | `readonly SchemaEntry[] \| SchemaObject` |
| `FieldOptions` | `{ wire?, oneof? }` |
| `NormalizedField` | Поле после нормализации |
| `NormalizedVariant` | Вариант oneof после нормализации |
| `NormalizedOneof` | oneof после нормализации |
| `NormalizedSchema` | `{ fields, oneofs }` |

### `TypeSchema`

```ts
type TypeSchema =
  | "bool" | "int32" | "uint32" | "int64" | "uint64"
  | "float32" | "float64" | "fixed32" | "fixed64"
  | "string" | "bytes" | "date" | "bigint" | "epochMillis" | "null"
  | readonly ["literal", LiteralValue]
  | readonly ["enum", readonly (string | number)[]]
  | readonly ["class", () => Function]
  | readonly ["array", TypeSchema]
  | readonly ["tuple", readonly TypeSchema[]]
  | readonly ["map", TypeSchema, TypeSchema]
  | readonly ["set", TypeSchema]
  | readonly ["record", TypeSchema]
  | readonly ["optional", TypeSchema]
  | null;
```

`["optional", T]` эквивалентен `optional: true` у поля. `["class", () => Ctor]` хранит ленивую ссылку, чтобы избежать циклических импортов. `["record", T]` — map со строковыми ключами. `null` — литерал null/unit-вариант oneof.
