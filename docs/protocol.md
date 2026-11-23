# Silent Protocol

Бинарный формат обмена данными вместо JSON. Схема — сам класс; на wire нет имён полей и тегов. Формат оптимизирован под скорость и детерминизм, совместим по возможностям с protobuf (varint, packed, map, oneof, unknown-field skipping не требуется).

## Цели

- Класс в TS, Rust или Kotlin является схемой.
- Поля кодируются в порядке сортировки по имени, порядок объявления не важен.
- Нет имён полей и числовых тегов; только значения и bitmap присутствия.
- Один и тот же бинарный формат в TS, Rust и Kotlin.
- Нет рефлексии в горячем пути: TS-кодеки кешируются/генерируются, Rust — derive, Kotlin — KSP.
- Интеграция с `@ivlev-dev/silent-validation`: типы и декораторы не дублируются.

## Не цели v1

- Совместимость с protobuf wire (формат свой, возможности те же).
- Эволюция схемы без изменения класса: класс фиксирует версию схемы.
- Циклы объектов и общие ссылки: ошибка при кодировании.
- Произвольные union-типы без enum-дискриминатора.
- `any`, `unknown`, функции, `Promise`, `WeakMap`, `WeakSet` — ошибка схемы.

## Схема

Схема сообщения:

```ts
type SchemaEntry =
  | { kind: "field"; name: string; type: TypeSchema; optional: boolean }
  | { kind: "oneof"; name: string; enum: () => object; variants: Variant[] };

type Variant = { value: number; field: string; type: TypeSchema };

type TypeSchema =
  | "bool" | "int32" | "uint32" | "int64" | "uint64"
  | "float32" | "float64" | "fixed32" | "fixed64"
  | "string" | "bytes" | "date" | "bigint"
  | ["literal", string | number | boolean]
  | ["enum", readonly (string | number)[]]
  | ["class", () => Function]
  | ["array", TypeSchema]
  | ["tuple", readonly TypeSchema[]]
  | ["map", TypeSchema, TypeSchema]
  | ["set", TypeSchema]
  | ["optional", TypeSchema];
```

Правила:

- Поля сортируются по имени: по возрастанию UTF-8 байт. В TS порядок вычисляется плагином, в Rust — `str::cmp`, в Kotlin — сравнением UTF-8.
- Унаследованные поля входят в схему. Одноимённое поле потомка переопределяет базовое.
- `oneof` занимает позицию поля-дискриминатора; поля-варианты не имеют собственной позиции и не входят в bitmap.
- Дубликаты имён и значений enum в oneof — ошибка схемы.

## Wire

### Примитивы

| Тип | Кодирование |
| --- | --- |
| `bool` | 1 байт: 0 или 1 |
| `int32`, `int64` | zigzag varint |
| `uint32`, `uint64` | varint |
| `fixed32` | 4 байта little-endian |
| `fixed64` | 8 байт little-endian |
| `float32` | IEEE 754, 4 байта LE |
| `float64` | IEEE 754, 8 байт LE |
| `string` | varint длина UTF-8 + байты |
| `bytes` | varint длина + сырые байты |
| `date` | zigzag varint, epoch milliseconds |
| `bigint` | zigzag varint, int64 |
| `enum` | varint значения (0..2^31-1) |
| `literal` | 0 байт |

`number` в TS по умолчанию — `float64`. Декораторы `@Int32`, `@Uint32`, `@Float32`, `@Fixed32`, `@Fixed64`, `@Uint64` переопределяют wire-тип. 64-битные целые в TS представляются `bigint`; `number` с `@Int64` — ошибка схемы.

### Bitmap

Bitmap присутствует, если в сообщении есть optional-поля (не считая oneof-вариантов):

```
bitmapLength = ceil(optionalCount / 8)
```

- Бит `i` (LSB-first) соответствует `i`-му optional-полю в порядке сортировки имён.
- `null` и `undefined` считаются отсутствием.
- Если optional-полей нет, bitmap отсутствует.
- Вложенное сообщение имеет собственный bitmap в начале своего payload.

### Сообщение

```
[bitmap?][entries в порядке схемы]
```

`field` кодируется своим TypeSchema. `oneof` кодируется как:

```
[enum: varint][payload выбранного варианта]
```

Вариант с типом `null`/литералом имеет payload нулевой длины. При кодировании ровно один вариант должен соответствовать значению enum. При декодировании неизвестное значение enum — ошибка.

### Массивы и кортежи

```
array(T)      = [count: varint][element...]
array(optional(T)) = [count][bitmap(count бит)][element для установленных битов]
tuple(T1..Tn) = [bitmap optional-слотов?][value...]
```

Элементы самодостаточны по длине: строка/bytes/вложенный класс/массив/карта знают свои границы. Префикс длины у вложенных классов не используется.

### Map/Set/Record

```
map(K,V)           = [count][key value]...
map(K, optional(V)) = [count][bitmap(count бит)][key value для установленных битов]
set(T)             = [count][value...]
record(T)          = map(string, T)
```

- Ключи map: `string`, целые, `bool`, enum. `float`/`bytes`/классы — ошибка схемы.
- `Map`/`Set`/`Record` кодируются в каноническом порядке: числа численно, строки по UTF-8, `bool` false < true, enum по числу.
- Пустая коллекция — один байт `0`.

### Optional

- `T | null | undefined` — optional-поле, бит в bitmap.
- Optional-элементы массива — bitmap после count.
- Optional-значения map — bitmap после count.
- Optional-слоты кортежа — bitmap в начале кортежа.

### Нативные типы TS

| TS | Wire |
| --- | --- |
| `Date` | date; `Invalid Date` — ошибка |
| `bigint` | bigint (int64 zigzag); `@Uint64` — uint64 |
| `Uint8Array`, `ArrayBuffer` | bytes |
| `Int8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array`, `BigInt64Array`, `BigUint64Array` | bytes, little-endian |
| `Map` | map |
| `Set` | set |
| enum | enum |

`RegExp`, `URL`, `URLSearchParams`, `WeakMap`, `WeakSet` в v1 не поддерживаются.

## oneof

```ts
enum EventKind { Created = 1, Updated = 2, Deleted = 3 }

class Event {
  public accessor kind: EventKind = EventKind.Created;

  @OneOf(EventKind.Created)
  public accessor created?: CreatedPayload;

  @OneOf(EventKind.Updated)
  public accessor updated?: UpdatedPayload;

  @OneOf(EventKind.Deleted)
  public accessor deleted?: null;
}
```

Wire: `[1][payload CreatedPayload]`, `[2][payload UpdatedPayload]`, `[3]`.

Правила:

- Дискриминатор — enum-поле, не optional.
- Каждый вариант — optional-поле с `@OneOf(значение)`.
- При кодировании ровно один вариант соответствует `kind`.
- Варианты не входят в bitmap.
- Enum-значения должны быть явными и стабильными.

## Ошибки и лимиты

- Обрезка буфера, неверный varint, неверный enum, отсутствие обязательного поля, лишние байты — `ProtocolError`.
- Лимит глубины вложенности — 256.
- Циклы объектов при кодировании — ошибка.
- `bigint` вне int64 — ошибка.
- Размер сообщения/строки/массива — настраиваемый лимит (по умолчанию 64 MiB).

## TS API

```ts
import { encode, decode, ProtocolModel, OneOf, Int32 } from "@ivlev-dev/silent-protocol";

class User extends ProtocolModel {
  public accessor email: string = "";
  public accessor age: number = 0;

  @Int32()
  public accessor score: number = 0;
}

const bytes = encode(user);
const restored = decode(User, bytes);
```

- `encode(value, options?: { validate?: boolean; maxSize?: number }): Uint8Array`
- `decode(ctor, bytes, options?: { validate?: boolean; maxDepth?: number }): T`
- Схема плагина хранится в `Symbol.for("silent.protocol.schema")`.
- Без плагина можно задать схему вручную через `defineProtocol(Ctor, schema)`.
- Кодеки кешируются по конструктору.
- `encode`/`decode` без `validate` не запускают валидатор.

## Rust API

```rust
use silent_protocol::{SilentProto, ProtocolError};

#[derive(SilentProto)]
struct User {
    email: String,
    age: u32,
    #[proto(int32)]
    score: i32,
}

let bytes = user.encode()?;
let restored = User::decode(&bytes)?;
```

- Поля сортируются макросом по имени.
- `Option<T>` — optional/bitmap.
- `Vec<T>` — массив; `Bytes` — bytes; `BTreeMap`/`BTreeSet` — канонические map/set.
- oneof: `#[proto(oneof(EventKind::Created))]` на optional-полях.
- Дата — `i64` epoch ms; опционально `chrono::DateTime<Utc>` за feature.

## Kotlin API (JVM/Android, KMP-ready)

```kotlin
@Proto
data class User(
    val email: String,
    val age: UInt,
    @Int32 val score: Int,
    val createdAt: Instant,
)

val bytes = UserCodec.encode(user)
val restored = UserCodec.decode(bytes)
```

- KSP генерирует `UserCodec`; рефлексии в рантайме нет.
- `Instant` — `kotlinx.datetime.Instant` (epoch ms); `Long` — через `@EpochMillis`.
- `ByteArray`/`IntArray`/... — bytes little-endian.
- `List`, `Set`, `Map` — коллекции; `Map`/`Set` сортируются.
- oneof — enum-дискриминатор + nullable-поля с `@OneOf(EventKind.Created)`.
- Nullable-поля — bitmap.

## Кросс-языковые векторы

`protocol/vectors/` содержит пары «JSON-значение + hex» для всех типов. CI проверяет:

1. TS кодирует → hex совпадает.
2. Rust декодирует hex → JSON совпадает; Rust кодирует → hex совпадает.
3. Kotlin декодирует/кодирует аналогично.
4. Отпечаток схемы (sorted names + types) совпадает между языками.

## Реализации

| Язык | Пакет/крейт | Статус |
| --- | --- | --- |
| TS | `packages/protocol` (`@ivlev-dev/silent-protocol`) | encode/decode, все wire-типы, bitmap, oneof, Date/bigint/typed arrays |
| TS build | `packages/protocol-vite` (`@ivlev-dev/silent-protocol-vite`) | схема из TS-класса, декораторы, oneof, наследование |
| Rust | `crates/silent-protocol` + `crates/silent-protocol-macros` | `#[derive(SilentProto)]`, примитивы, коллекции, oneof, лимиты |
| Kotlin | `kotlin/protocol` + `kotlin/ksp-processor` | JVM/Android, KSP-кодеки, `Instant`, коллекции, oneof |

Кросс-языковые векторы: `protocol/vectors/` и тесты `cross-vector`/`cross_language`/`CrossLanguageTest` (TS, Rust, Kotlin дают одинаковые байты). Отпечатки схемы (`schema_hash`/`schemaFingerprint`) сейчас имеют разные форматы и не сравниваются между языками; источник истины для совместимости — бинарные векторы.

### Ограничения реализаций

- Rust: `Vec<u8>` трактуется как bytes; enum-поля вне oneof требуют `#[proto(enum_type)]`; нет tuple/литералов схемы и fixed-size массивов.
- Kotlin: одна oneof-группа на класс; `@OneOf` принимает числовой wire-код (не enum-entry); поддерживаются только свойства primary-конструктора; кодек генерируется KSP.
- TS-плагин: union без дискриминатора, `any`/`unknown`, rest-кортежи и строковые enum в oneof не поддерживаются; numeric index-signature не разворачивается.
