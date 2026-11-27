# Silent Protocol

Бинарный формат обмена данными вместо JSON. Схема — сам класс; на wire нет имён полей и тегов. Формат оптимизирован под скорость и детерминизм, совместим по возможностям с protobuf (varint, packed, map, oneof, unknown-field skipping не требуется).

## Цели

- Класс в TS, Rust, Kotlin или PHP является схемой.
- Поля кодируются в порядке сортировки по имени, порядок объявления не важен.
- Нет имён полей и числовых тегов; только значения и bitmap присутствия.
- Один и тот же бинарный формат в TS, Rust, Kotlin и PHP.
- Нет рефлексии в горячем пути: TS-кодеки кешируются/генерируются, Rust — derive, Kotlin — KSP, PHP — рефлексия один раз при сборке схемы, дальше кеш.
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

## HTTP

Сам протокол не задаёт транспорт, но для HTTP API используется один контракт:

- `Content-Type: application/x-silent-protocol` обязателен для тел `POST` и
  `PATCH`; сервер проверяет его до декодирования и отвечает `415`
  `invalid_content_type` на JSON или отсутствующий заголовок.
- Тело — сырые байты `encode(value)` без base64, JSON-конвертов и вложенного
  `Content-Length`. Query-параметры (фильтры, сортировка, пагинация) остаются
  в URL.
- `204 No Content` не имеет тела. Все остальные ответы, включая ошибки,
  закодированы протоколом и имеют тот же `Content-Type`. Исключение —
  `GET /uploads/{file}`: отдаёт файл с его MIME.
- Размер тела ограничивается до декодирования (`413 payload_too_large`), а
  декодер получает явные `Limits` (`maxDepth`, `maxSize`). В примере —
  `Limits::new(32, 2 MiB)`: превышение объявленной длины строки/массива даёт
  `400 invalid_payload`.

Ошибки кодируются отдельной схемой с исходным HTTP-статусом:

```text
ApiError { code: string, message: string }
```

`code` — машиночитаемый (`invalid_query`, `invalid_input`, `invalid_path`,
`invalid_content_type`, `invalid_payload`, `empty_body`, `payload_too_large`,
`not_found`, `internal_error`, ...). Клиент сначала проверяет
`response.ok`, затем декодирует `ApiError`; при неудачном декодировании
использует запасной код `http_<status>`.

### Эндпоинты примера

| Метод и путь | Тело запроса | Успешный ответ |
| --- | --- | --- |
| `GET /api/health` | — | `200 Health { ok: bool }` |
| `GET /api/projects?...` | — | `200 ProjectPage` |
| `POST /api/projects` | `ProjectInput` | `201 Project` |
| `PATCH /api/projects/{id}` | `ProjectPatch` | `200 Project` |
| `DELETE /api/projects/{id}` | — | `204` без тела |
| `GET /api/meta` | — | `200 ProjectMeta` |
| `POST /api/uploads` | `multipart/form-data`, поле `file` | `201 UploadResult` |
| `GET /uploads/{file}` | — | файл с MIME по расширению |

Схемы примера (поля в порядке кодирования, TS-типы):

```text
Health        { ok: bool }
Project       { budget: float64, createdAt: date, id: uint32, name: string,
                owner: string, status: ProjectStatus, tags: array<string> }
ProjectInput  { budget: float64, name: string, owner: string,
                status: ProjectStatus, tags: array<string> }
ProjectPatch  { budget?: float64, name?: string, owner?: string,
                status?: ProjectStatus, tags?: array<string> }
ProjectPage   { items: array<Project>, page: uint32, pageSize: uint32,
                total: uint32 }
ProjectMeta   { owners: array<string>, statuses: array<ProjectStatus>,
                tags: array<string> }
UploadResult  { id: string, mime: string, name: string, size: uint32,
                url: string }
ApiError      { code: string, message: string }
```

`ProjectStatus` — enum `active = 0`, `review = 1`, `done = 2`, `paused = 3`;
в Rust поле помечается `#[proto(enum_type)]`, в TS тип — строковый union.
`date` — epoch milliseconds (`i64` в Rust, `Date` в TS). `ProjectPatch`
использует bitmap: биты `budget`, `name`, `owner`, `status`, `tags` (LSB
сначала), отсутствующее поле не кодируется, `tags: []` кодируется битом и
нулевой длиной.

### Проверка curl

Health — один байт `0x01`:

```bash
curl -s -D /tmp/health.headers -o /tmp/health.bin \
  http://127.0.0.1:6108/api/health
grep -i content-type /tmp/health.headers
# content-type: application/x-silent-protocol
od -An -tx1 -v /tmp/health.bin
#  01
```

Список проектов: тип и размер ответа, первые байты — количество элементов,
`budget` первого проекта и длина строки имени:

```bash
curl -s -D /tmp/projects.headers -o /tmp/projects.bin \
  'http://127.0.0.1:6108/api/projects?pageSize=10&status=active'
grep -i -E 'content-type|content-length' /tmp/projects.headers
# content-type: application/x-silent-protocol
# content-length: 813
od -An -tx1 -v -N 32 /tmp/projects.bin
#  0a 00 00 00 00 00 88 b3 40 d2 c6 97 d4 c3 68 01
#  1b d0 a1 d0 b5 d0 b2 d0 b5 d1 80 d0 bd d1 8b d0
```

Создание проекта из готового вектора (тело — бинарный файл, не JSON):

```bash
xxd -r -p examples/ui/protocol-vectors/project-input.hex /tmp/input.bin
# вариант без xxd:
python3 -c 'import pathlib; pathlib.Path("/tmp/input.bin").write_bytes(bytes.fromhex(pathlib.Path("examples/ui/protocol-vectors/project-input.hex").read_text().strip()))'
curl -s -D - -o /tmp/created.bin -X POST \
  -H 'Content-Type: application/x-silent-protocol' \
  --data-binary @/tmp/input.bin \
  http://127.0.0.1:6108/api/projects
# HTTP/1.1 201 Created
# content-type: application/x-silent-protocol
# content-length: 68
od -An -tx1 -v -N 16 /tmp/created.bin
#  00 00 00 00 80 92 b0 40 88 bb 99 d4 c3 68 f1 01
```

Ошибка тоже бинарная: неверный `Content-Type` даёт `415`, тело —
`ApiError { code: "invalid_content_type", ... }`:

```bash
curl -s -o /tmp/error.bin -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' --data '{}' \
  http://127.0.0.1:6108/api/projects
# 415
od -An -tx1 -v -N 16 /tmp/error.bin
#  14 69 6e 76 61 6c 69 64 5f 63 6f 6e 74 65 6e 74
#  5f 74 79 70 65
```

Пустое тело — `400 empty_body`, битые байты — `400 invalid_payload`,
превышение 2 MiB — `413 payload_too_large` (до декодирования), неизвестный
`id` — `404 not_found`. Полный контракт и таблица схем —
[`docs/api/protocol-http.md`](./api/protocol-http.md), серверная реализация —
[`examples/ui/server/README.md`](../examples/ui/server/README.md).

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

## PHP API (8.2+)

```php
use Ivlev\Silent\Protocol\Attributes\ArrayOf;
use Ivlev\Silent\Protocol\Attributes\Int32;
use Ivlev\Silent\Protocol\Attributes\OneOf;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Protocol;

enum EventKind: int
{
    case Created = 1;
}

#[Proto]
final class CreatedPayload
{
    public string $title = '';
}

#[Proto]
final class User
{
    public string $email = '';
    public int $age = 0;

    #[Int32]
    public int $score = 0;

    #[ArrayOf('string')]
    public array $tags = [];

    // oneof: дискриминатор — int-backed enum, вариант — nullable-свойство.
    public EventKind $kind = EventKind::Created;

    #[OneOf(EventKind::Created)]
    public ?CreatedPayload $created = null;

    public ?string $nickname = null; // ?T — optional, бит в bitmap
}

$bytes = Protocol::encode($user);
$restored = Protocol::decode(User::class, $bytes);
```

- Установка: `composer require ivlev-dev/silent-protocol` (PSR-4 `Ivlev\Silent\Protocol\`).
- Схема собирается из атрибутов рефлексией один раз и кешируется по классу.
- `int` по умолчанию — `int32`; `#[Int64]`/`#[BigInt]` — int64; `#[Uint32]`,
  `#[Uint64]`, `#[Fixed32]`, `#[Fixed64]`, `#[Float32]`, `#[Bytes]`, `#[Date]` —
  переопределения wire-типа.
- Коллекции — `#[ArrayOf('int32')]`, `#[MapOf('string', 'uint32')]`,
  `#[SetOf('string')]`, `#[Tuple('int32', '?string')]`, `#[RecordOf('uint32')]`;
  префикс `?` в токене помечает optional-элемент.
- `\DateTimeInterface` — epoch ms; int-backed `enum` — varint backing value.
- `Protocol::schema()` отдаёт нормализованную схему; ошибки — единый
  `ProtocolException` с `$errorCode` (`schema`, `value`, `range`, `truncated`,
  `invalid_varint`, `utf8`, `bool`, `unknown_enum`, `oneof`, `cycle`, `depth`,
  `size`, `trailing`) и `$path`.
- Тесты: `php tests/run.php` — plain runner без PHPUnit и зависимостей.

Ограничения PHP-реализации: `uint64`/`fixed64` больше `PHP_INT_MAX` не
представимы (encode отвергает, decode бросает `range`); только int-backed
`enum`; каждой oneof-группе нужен свой enum-тип дискриминатора; set
пользовательских классов сортируется по закодированным байтам; строки —
строгий UTF-8 (битые последовательности отвергаются и при encode, и при
decode); валидации (`validate`) нет. Подробнее — [`php/README.md`](../php/README.md).

## Кросс-языковые векторы

`protocol/vectors/` содержит пары «JSON-значение + hex» для всех типов. CI проверяет:

1. TS кодирует → hex совпадает.
2. Rust декодирует hex → JSON совпадает; Rust кодирует → hex совпадает.
3. Kotlin декодирует/кодирует аналогично.
4. PHP декодирует/кодирует `protocol/vectors/user.json` тем же hex.
5. Отпечаток схемы (sorted names + types) совпадает между языками.

Прикладной набор для HTTP-примера лежит в `examples/ui/protocol-vectors/`:
`Project`, `ProjectPage`, `ProjectMeta`, `ProjectInput`, `ProjectPatch`,
`ApiError`, `UploadResult`, плюс кейсы с пустыми массивами, кириллицей,
границами `uint32` и пустым/частичным bitmap. Каждый вектор — `<name>.json`
(описание, `hex`, `fields`) и `<name>.hex` (байты). Rust-тест
`examples/ui/server/tests/vector.rs` кодирует фикстуры и декодирует hex,
TS-тест `examples/ui/tests/protocol-vector.test.ts` делает обратное и
проверяет `maxSize`/`maxDepth`, обрезку и лишние байты.

## Реализации

| Язык | Пакет/крейт | Статус |
| --- | --- | --- |
| TS | `packages/protocol` (`@ivlev-dev/silent-protocol`) | encode/decode, все wire-типы, bitmap, oneof, Date/bigint/typed arrays, generic + static codecs |
| TS build | `packages/protocol-vite` (`@ivlev-dev/silent-protocol-vite`) | схема и статические кодеки из TS-класса, декораторы, oneof, наследование |
| Rust | `silent-protocol` + `silent-protocol-macros` (crates.io `0.14`) | `#[derive(SilentProto)]`, примитивы, коллекции, oneof, лимиты |
| Kotlin | `kotlin/protocol` + `kotlin/ksp-processor` | JVM/Android, KSP-кодеки, `Instant`, коллекции, oneof |
| PHP | `php/` (`ivlev-dev/silent-protocol`) | атрибуты + рефлексия, примитивы, коллекции, oneof, `DateTime`, enum, лимиты |

Кросс-языковые векторы: `protocol/vectors/` и тесты `cross-vector`/`cross_language`/`CrossLanguageTest` (TS, Rust, Kotlin и PHP дают одинаковые байты). Отпечатки схемы (`schema_hash`/`schemaFingerprint`) сейчас имеют разные форматы и не сравниваются между языками; источник истины для совместимости — бинарные векторы.

### Ограничения реализаций

- Rust: `Vec<u8>` трактуется как bytes; enum-поля вне oneof требуют `#[proto(enum_type)]`; нет tuple/литералов схемы и fixed-size массивов.
- Kotlin: одна oneof-группа на класс; `@OneOf` принимает числовой wire-код (не enum-entry); поддерживаются только свойства primary-конструктора; кодек генерируется KSP.
- TS-плагин: union без дискриминатора, `any`/`unknown`, rest-кортежи и строковые enum в oneof не поддерживаются; numeric index-signature не разворачивается.
- PHP: `uint64`/`fixed64` > `PHP_INT_MAX` не представимы; только int-backed enum; один дискриминатор на enum-тип; set классов — по закодированным байтам; строгий UTF-8; нет `validate`.

## Статические кодеки

Плагин `protocol()` вставляет в класс не только схему, но и готовые `write`/`read` в static block:

```ts
this[Symbol.for("silent.protocol.codec")] = {
  write(value, writer, context, path) { ... },
  read(reader, context, path) { ... },
};
```

`@ivlev-dev/silent-protocol` использует кодек, если он есть, иначе generic-кодек по схеме. Generic остаётся для ручных `defineProtocol` и классов без сгенерированного кодека.

Замеры на одной модели `User` (8 полей, nested Address, optional email, bigint/Long id, int32 age/zip, string[], float64), 60 B binary:

| Язык / режим | encode | decode | JSON baseline |
| --- | ---: | ---: | ---: |
| TS static | **1.56M ops/s**, 89 MB/s | **784k**, 45 MB/s | stringify 523k, parse 655k |
| TS generic | 776k, 44 MB/s | 440k, 25 MB/s | — |
| Rust release | **6.41M ops/s**, 385 MB/s | **7.97M**, 478 MB/s | serde_json 5.02M / 2.58M |
| Kotlin JVM | **5.48M ops/s**, 329 MB/s | **5.91M**, 355 MB/s | Gson 69k / 81k |

TS-аллокации: encode 633 B/op, decode 1080 B/op (было 2200/2722). Rust и Kotlin работают на скомпилированном коде и опережают TS в 4–8×; TS static encode/decode быстрее JSON на той же модели. Абсолютные числа зависят от машины и нагрузки; методика — `pnpm bench:protocol`, `cargo run --release -p silent-protocol --example bench`, `cd kotlin && gradle :protocol:bench`.
