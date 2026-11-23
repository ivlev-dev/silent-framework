# silent-protocol (Rust)

Бинарный протокол Silent для Rust: структура или enum описывает схему, а
`#[derive(SilentProto)]` генерирует кодирование, декодирование и описание
схемы. На wire нет имён полей и тегов, поэтому сообщения компактнее JSON, а
формат совпадает с реализациями TS и Kotlin.

- Поля сортируются по имени (возрастание UTF-8), порядок объявления не важен.
- `Option<T>` кодируется битом в bitmap присутствия.
- Вложенные сообщения пишутся без префикса длины.
- `BTreeMap`/`BTreeSet` дают детерминированный порядок.
- oneof — enum-дискриминатор и payload одного варианта.
- Лимиты глубины и размера, ошибки с машиночитаемыми кодами.
- Детерминированный отпечаток схемы (`schema_hash`).

## Установка

Крейты пока не опубликованы на crates.io (версия `0.13.1`), поэтому
подключайте их из репозитория. Закрепляйте тег или rev, чтобы сборка была
воспроизводимой.

```toml
[dependencies]
silent-protocol = { git = "https://github.com/ivlev-dev/silent-framework", tag = "v0.13.1" }
```

Из локальной копии репозитория:

```toml
[dependencies]
silent-protocol = { path = "crates/silent-protocol" }
```

Если поля используют `bytes::Bytes`, добавьте зависимость `bytes`:

```toml
[dependencies]
bytes = "1"
```

После публикации координаты будут такими:

```toml
[dependencies]
silent-protocol = "0.13"
```

Крейт `silent-protocol-macros` подключать отдельно не нужно: derive-макрос
реэкспортируется из `silent_protocol::SilentProto`.

## Быстрый старт

```rust
use silent_protocol::SilentProto;

#[derive(Debug, PartialEq, SilentProto)]
struct User {
    name: String,
    age: u32,
    email: Option<String>,
}

let user = User {
    name: "Иван".into(),
    age: 30,
    email: None,
};

let bytes = user.encode().unwrap();
let restored = User::decode(&bytes).unwrap();
assert_eq!(restored, user);
```

`#[derive(SilentProto)]` реализует трейт `SilentProto`:

| Метод | Назначение |
| --- | --- |
| `encode(&self) -> Result<Vec<u8>, ProtocolError>` | Кодирует в новый буфер |
| `encode_to(&self, out: &mut Vec<u8>)` | Дописывает в конец буфера |
| `encode_to_with_limits(&self, out, limits)` | Дописывает с лимитами |
| `decode(bytes) -> Result<Self, ProtocolError>` | Декодирует и отвергает лишние байты |
| `decode_with_limits(bytes, limits)` | Декодирует с лимитами |
| `decode_from(&mut Decoder)` | Читает из общего декодера без проверки остатка |
| `schema() -> Vec<SchemaEntry>` | Описание полей и oneof-групп |
| `schema_hash() -> u64` | Отпечаток схемы |

Низкоуровневый доступ:

```rust
use silent_protocol::{Decoder, Encoder, Limits, SilentProto};

let limits = Limits::new(64, 1024 * 1024);
let mut out = Vec::new();
user.encode_to_with_limits(&mut out, limits).unwrap();

let mut decoder = Decoder::with_limits(&out, limits);
let value = User::decode_from(&mut decoder).unwrap();
decoder.finish().unwrap();

let mut encoder = Encoder::new(&mut out);
encoder.write_message(&value).unwrap();
```

## Поддерживаемые типы и wire

| Rust | Схема | Wire |
| --- | --- | --- |
| `bool` | `bool` | 1 байт: 0 или 1 |
| `i32` | `int32` | zigzag varint |
| `i64` | `int64` | zigzag varint |
| `u32` | `uint32` | varint |
| `u64` | `uint64` | varint |
| `f32` | `float32` | IEEE 754, 4 байта LE |
| `f64` | `float64` | IEEE 754, 8 байт LE |
| `String` | `string` | varint длины UTF-8 + байты |
| `Vec<u8>` | `bytes` | varint длины + сырые байты |
| `bytes::Bytes` | `bytes` | varint длины + сырые байты |
| `Option<T>` | `optional(T)` | бит в bitmap + значение при наличии |
| `Vec<T>` | `array(T)` | varint количества + элементы |
| `Vec<Option<T>>` | `array(optional(T))` | количество + bitmap + значения |
| `BTreeMap<K, V>` | `map(K,V)` | количество + пары ключ/значение |
| `BTreeSet<T>` | `set(T)` | количество + элементы |
| struct с derive | `message(Type)` | поля без префикса длины |
| enum с derive + `enum_type` | `enum(Type)` | varint значения |

`Vec<u8>` — это именно bytes, а не массив чисел: `vec![1, 2]` кодируется как
`[2, 1, 2]` (длина и байты), а `Vec<u32>` — как `[count][varint...]`.
`Vec<Vec<u8>>` даёт `array(bytes)`. `u8`, `u16`, `i16`, `usize`, `char`,
`&str` и другие примитивы вне `Vec<u8>` не поддерживаются.

### Bitmap и `Option`

Если в сообщении есть optional-поля (не считая вариантов oneof), в начале
payload пишется bitmap:

```text
bitmap_len = ceil(optional_count / 8)
```

Бит `i` (LSB-first) соответствует `i`-му optional-полю в порядке сортировки
имён. Если optional-полей нет, bitmap отсутствует. Вложенное сообщение имеет
собственный bitmap в начале своего payload.

```rust
#[derive(Debug, PartialEq, SilentProto)]
struct Flags {
    a: Option<u32>,
    h: Option<u32>,
}

assert_eq!(Flags { a: None, h: None }.encode().unwrap(), vec![0]);
assert_eq!(Flags { a: Some(1), h: Some(9) }.encode().unwrap(), vec![0x81, 1, 9]);
```

`Option<()>` допустим: он кодируется только битом присутствия и не пишет
payload. `Option<Option<T>>` запрещён на этапе компиляции.

### Коллекции

- `Vec<T>`: varint количества, затем элементы; пустой вектор — один байт `0`.
- `Vec<Option<T>>`: количество, bitmap элементов (`ceil(count / 8)` байт),
  затем значения для установленных битов.
- `BTreeMap<K, V>`: количество, пары в порядке `Ord` ключей; ключи — `bool`,
  целые (`i32`, `i64`, `u32`, `u64`), `String`. `BTreeMap<K, Option<V>>`
  дополнительно пишет bitmap значений после количества.
- `BTreeSet<T>`: количество и элементы в порядке `Ord`; optional-элементы
  запрещены.
- `HashMap`, `HashSet`, `VecDeque`, `LinkedList`, `BinaryHeap` запрещены,
  потому что не дают детерминированного порядка.

```rust
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, PartialEq, SilentProto)]
struct Catalog {
    tags: BTreeSet<String>,
    counts: BTreeMap<String, u32>,
    chunks: Vec<Vec<u8>>,
}
```

### oneof

oneof-группа занимает позицию поля-дискриминатора. Варианты — `Option<T>`
поля с атрибутом `#[proto(oneof(Enum::Variant))]`; в bitmap они не входят.
Wire: `[enum: varint][payload выбранного варианта]`. Вариант с payload `()`
не пишет байтов после дискриминатора.

```rust
use silent_protocol::SilentProto;

#[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
enum EventKind {
    Created = 1,
    Updated = 2,
    Deleted = 3,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Created {
    count: i32,
    text: String,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Event {
    kind: EventKind,
    #[proto(oneof(EventKind::Created))]
    created: Option<Created>,
    #[proto(oneof(EventKind::Updated))]
    updated: Option<i32>,
    #[proto(oneof(EventKind::Deleted))]
    deleted: Option<()>,
}

let event = Event {
    kind: EventKind::Created,
    created: Some(Created { count: 7, text: "hi".into() }),
    updated: None,
    deleted: None,
};
assert_eq!(event.encode().unwrap(), vec![1, 0x0e, 2, b'h', b'i']);
```

Правила:

- Ровно один вариант должен быть `Some` и соответствовать дискриминатору;
  иначе при кодировании возвращается `oneof.cardinality` или `oneof.mismatch`.
- При декодировании неизвестное значение enum — `enum.unknown`, неизвестный
  вариант группы — `oneof.unknown`.
- На одном поле допускается только одна аннотация `oneof`; одно поле не может
  входить в несколько групп.
- Поддерживается несколько oneof-групп в одном сообщении, если у каждой свой
  enum-тип дискриминатора. Дискриминатор не может быть optional, общим для
  двух групп или иметь явный wire-тип.
- Имена вариантов группы (с учётом `rename`) должны быть уникальны, а
  enum-значения в группе — различны.

### Даты

Дата — `i64` в epoch milliseconds. Обычное `i64`-поле кодируется zigzag
varint как `int64`; атрибут `#[proto(date)]` меняет только тип в схеме
(`date`) и использует то же кодирование.

```rust
#[derive(Debug, PartialEq, SilentProto)]
struct Record {
    #[proto(date)]
    created_at: i64,
    updated_at: i64,
}
```

`chrono::DateTime` и другие обёртки не поддерживаются: конвертируйте в
milliseconds вручную.

### Enum

`#[derive(SilentProto)]` на enum генерирует `ProtoEnum`:

- только unit-варианты;
- дискриминанты — целочисленные литералы, неотрицательные, не больше
  `2^31 - 1`; без литерала используется автонумерация с нуля;
- дубликаты значений — ошибка компиляции;
- `to_proto`/`from_proto` работают с `u32`, неизвестное значение даёт
  `enum.unknown`.

Enum можно использовать как дискриминатор oneof без дополнительных атрибутов.
Для enum-поля вне oneof нужен `#[proto(enum_type)]`:

```rust
#[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
enum Status {
    Draft = 1,
    Published = 2,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Post {
    #[proto(enum_type)]
    status: Status,
    title: String,
}
```

### Атрибуты `#[proto(...)]`

| Атрибут | Где | Действие |
| --- | --- | --- |
| `int32` | поле `i32` | Явный `int32` (по умолчанию и так `int32`) |
| `uint32` | поле `u32` | Явный `uint32` |
| `int64` | поле `i64` | Явный `int64` |
| `uint64` | поле `u64` | Явный `uint64` |
| `float32` | поле `f32` | Явный `float32` |
| `fixed32` | поле `u32` | 4 байта LE вместо varint |
| `fixed64` | поле `u64` | 8 байт LE вместо varint |
| `date` | поле `i64` | Тип `date` в схеме, wire — zigzag varint |
| `enum_type` | поле enum | Разрешает enum вне oneof |
| `oneof(Enum::Variant)` | `Option<T>` поле | Включает поле в oneof-группу |
| `rename = "name"` | поле | Имя в схеме; меняет порядок сортировки и бит bitmap |
| `skip` | любое поле | Поле не кодируется, не декодируется и не входит в схему |

Атрибуты можно объединять: `#[proto(rename = "id", uint64)]`. `skip` нельзя
комбинировать с другими атрибутами; пропущенное поле при декодировании
получает `Default::default()`. Явный wire-тип должен соответствовать Rust-типу
(`fixed32`/`uint32` — только `u32`, `date`/`int64` — только `i64` и т.д.).

## Схема и `schema_hash`

`schema()` возвращает `Vec<SchemaEntry>`:

- `SchemaEntry::Field(SchemaField { name, ty, optional })` — обычное поле;
- `SchemaEntry::OneOf(SchemaOneOf { name, enum_name, variants })` — группа,
  где `name` — имя дискриминатора, варианты отсортированы по `value`.

Записи идут в порядке кодирования (сортировка по имени поля). `SchemaType`
описывает примитивы, `Enum`, `Message`, `Array`, `Map`, `Set`, `Optional`,
`Date`, `Unit`.

`canonical(&entries)` даёт стабильный текст, `fingerprint(&entries)` — FNV-1a
64-битный хеш от него. `schema_hash()` — это `fingerprint(&Self::schema())`.

```rust
use silent_protocol::{canonical, SchemaEntry, SilentProto};

let text = canonical(&User::schema());
assert!(text.starts_with("field|age|uint32|0\n"));
assert_ne!(User::schema_hash(), 0);
```

Отпечаток учитывает имена полей и типы, но не имя Rust-структуры. Формат
отпечатка в Rust, TS и Kotlin различается; для межъязыковой совместимости
используйте бинарные векторы из `protocol/vectors/` (тест
`tests/cross_language.rs`).

## Лимиты

`Limits { max_depth, max_size }`, значения по умолчанию: глубина 256, размер
64 MiB.

- `max_depth` считает вложенные сообщения (`write_message`/`read_message`);
  превышение — `limit.depth`.
- `max_size` для `Encoder` — количество байт, записанных этим кодировщиком с
  момента создания (включая вложенные сообщения); для `Decoder` — объявленные
  длины строк, bytes и коллекций. Превышение — `limit.size`.
- Лимиты задаются через `Limits::new(depth, size)`,
  `encode_to_with_limits`, `decode_with_limits`, `Encoder::with_limits`,
  `Decoder::with_limits`.

```rust
use silent_protocol::{Limits, SilentProto};

let bytes = user.encode().unwrap();
let tight = Limits::new(8, 5);
let error = User::decode_with_limits(&bytes, tight).unwrap_err();
assert_eq!(error.code(), "limit.size");
```

## Ошибки

`ProtocolError` реализует `std::error::Error`, `Display`, `Clone`, `PartialEq`.
Метод `code()` возвращает стабильный код:

| Код | Причина |
| --- | --- |
| `eof` | Буфер закончился раньше значения |
| `varint` | Varint длиннее 10 байт без завершения |
| `overflow` | Значение не помещается в целевой тип |
| `bool` | Байт `bool` не 0 и не 1 |
| `utf8` | Строка не является корректным UTF-8 |
| `trailing` | После сообщения остались байты (`decode`/`finish`) |
| `limit.size` | Превышен лимит размера |
| `limit.depth` | Превышен лимит глубины |
| `enum.range` | Значение enum при кодировании больше `2^31 - 1` |
| `enum.unknown` | Неизвестное значение enum при декодировании |
| `oneof.unknown` | Неизвестный вариант oneof при декодировании |
| `oneof.cardinality` | В oneof установлено не ровно одно поле |
| `oneof.mismatch` | Поле не соответствует дискриминатору |

`decode` вызывает `finish()` и отвергает лишние байты; `decode_from` не
проверяет остаток — вызывайте `Decoder::finish` сами, если он важен.
`encode_to` дописывает данные в конец существующего буфера.

## Ограничения

- Нет generic-типов, tuple, tuple-структур, unit-структур, union и
  fixed-size массивов (`[T; N]`). Для массивов используйте `Vec<T>`.
- Нет ссылок, сырых указателей, `Box`/`Rc`/`Arc`/`Cow`, интерьерной
  изменяемости и `impl Trait`/trait objects.
- Нет литералов схемы и tuple в схеме: Rust-маппинг поддерживает только
  перечисленные типы.
- `Vec<u8>` — всегда bytes. Для массива чисел используйте `Vec<u32>` и т.п.
- Enum вне oneof требует `#[proto(enum_type)]`; enum-тип реализует только
  `ProtoEnum`, а не `SilentProto`, поэтому не может быть самостоятельным
  сообщением.
- `Option<Option<T>>` и optional-элементы `BTreeSet` запрещены.
- Ключи map: `bool`, целые, `String`; `f32`/`f64`/bytes/структуры в ключах
  запрещены.
- Одна структура — одна версия схемы: эволюция полей без изменения типа
  приведёт к несовместимости. Неизвестные поля не пропускаются.

## Примеры и тесты

```bash
cargo test -p silent-protocol
cargo test -p silent-protocol-macros
cargo run --release -p silent-protocol --example bench
cargo doc -p silent-protocol --no-deps --open
```

Пример `examples/bench.rs` кодирует и декодирует модель `User`
(8 полей: вложенный `Address`, `Option<String>`, `i64`, `i32`, `bool`,
`Vec<String>`, `f64`) и сравнивает с `serde_json`. На 60-байтовом сообщении
ориентиры (release, зависят от машины):

| Реализация | encode | decode |
| --- | ---: | ---: |
| Rust `silent-protocol` | ~6.41M ops/s, 385 MB/s | ~7.97M ops/s, 478 MB/s |
| TS static | ~1.56M ops/s, 89 MB/s | ~784k ops/s, 45 MB/s |
| Kotlin JVM | ~5.48M ops/s, 329 MB/s | ~5.91M ops/s, 355 MB/s |
| `serde_json` (baseline) | ~5.02M ops/s | ~2.58M ops/s |

Подробная методика и таблица — `docs/protocol.md` в репозитории. Абсолютные
числа зависят от CPU, аллокатора и нагрузки.

## Лицензия

MIT.
