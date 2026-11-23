# Silent Protocol для PHP

Побайтно совместимая с TS/Rust/Kotlin реализация Silent Protocol на PHP 8.2+.
Схема — сам класс с атрибутами, кодеки кешируются по классу, в горячем пути нет
повторной рефлексии атрибутов.

```php
use Ivlev\Silent\Protocol\Attributes\ArrayOf;
use Ivlev\Silent\Protocol\Attributes\Int64;
use Ivlev\Silent\Protocol\Attributes\Proto;
use Ivlev\Silent\Protocol\Protocol;

#[Proto]
final class Address
{
    public string $city = '';
    public int $zip = 0;
}

#[Proto]
final class User
{
    public bool $active = false;
    public Address $address;
    public int $age = 0;
    public \DateTimeImmutable $createdAt;
    public ?string $email = null;
    #[Int64]
    public int $id = 0;
    public string $name = '';
    #[ArrayOf('string')]
    public array $tags = [];
    public float $score = 0.0;
}

$bytes = Protocol::encode($user);
$restored = Protocol::decode(User::class, $bytes);
```

## Установка

```bash
composer require ivlev-dev/silent-protocol
```

Пакет без внешних зависимостей, autoload — PSR-4 (`Ivlev\Silent\Protocol\`).
Для локальной разработки из этого репозитория можно подключить `php/` как path-репозиторий:

```json
{
  "repositories": [{ "type": "path", "url": "php" }],
  "require": { "ivlev-dev/silent-protocol": "*" }
}
```

Либо подключите `src/` своим PSR-4-автозагрузчиком с префиксом
`Ivlev\Silent\Protocol\`.

## Публичный API

```php
Protocol::VERSION;                                    // '0.14.0'
Protocol::encode(object $value, ?Options $options = null): string;
Protocol::decode(string $class, string $bytes, ?Options $options = null): object;
Protocol::schema(string $class): Schema;

new Options(
    int $maxSize = 64 * 1024 * 1024,
    int $maxDepth = 256,
    bool $allowTrailing = false,
);

$schema->entries;        // отсортированные поля/oneof
$schema->optionalCount;  // число optional-полей (без oneof-вариантов)
$schema->canonical();    // текстовое представление для отладки
```

`encode`/`decode` бросают единый
`Ivlev\Silent\Protocol\Errors\ProtocolException` с полями `$errorCode`
(`schema`, `value`, `range`, `truncated`, `invalid_varint`, `utf8`, `bool`,
`unknown_enum`, `oneof`, `cycle`, `depth`, `size`, `trailing`) и `$path`
(например, `User.address.zip`).

Валидационный слой (`@ivlev-dev/silent-validation`) в PHP-пакет не входит:
`Options` не содержит `validate`, чтобы флаг не игнорировался молча.

## Правила типов

| Объявление в PHP | Wire-тип |
| --- | --- |
| `bool` | `bool` (0/1) |
| `int` | **`int32`** (zigzag varint) |
| `int` + `#[Int64]` / `#[BigInt]` | `int64` (zigzag varint) |
| `int` + `#[Uint32]`, `#[Uint64]`, `#[Fixed32]`, `#[Fixed64]` | соответствующий тип |
| `float` | `float64` |
| `float` + `#[Float32]` | `float32` |
| `string` | `string` (UTF-8, varint-длина) |
| `string` + `#[Bytes]` | `bytes` (сырые байты) |
| `\DateTimeInterface`, `\DateTime`, `\DateTimeImmutable` | `date` (epoch ms, zigzag varint) |
| `int` + `#[Date]` | `date`, при декодировании остаётся `int` epoch ms |
| int-backed `enum` | `enum` (varint backing value) |
| класс с `#[Proto]` | вложенное сообщение без префикса длины |
| `?T` / `T|null` | optional: бит в bitmap |
| `array` + коллекционный атрибут | массив/map/set/tuple/record |

Ключевое правило: **`int` по умолчанию — `int32`**, `float` — `float64`.
Для `int64` нужен `#[Int64]`. Именно так общий вектор `user.json` остаётся
совместимым: `age`/`zip` — `int32`, `id` — `#[Int64]`, `score` — `float64`.

Поля кодируются в порядке возрастания **UTF-8 байт имени** (`strcmp`), а не в
порядке объявления. Унаследованные свойства входят в схему; одноимённое
свойство потомка переопределяет базовое.

## Атрибуты

```php
#[Proto]                                  // класс-сообщение (обязателен)
#[Int32] #[Uint32] #[Int64] #[BigInt]     // переопределение wire-типа int
#[Uint64] #[Float32] #[Fixed32] #[Fixed64]
#[Bytes]                                  // string → bytes
#[Date]                                   // DateTimeInterface/int → epoch ms
#[Literal(7)]                             // 0 байт, значение проверяется
#[OneOf(EventKind::Created)]              // вариант oneof
#[ArrayOf('int32')]                       // массив элементарного типа
#[MapOf('string', 'uint32')]              // map
#[SetOf('string')]                        // set (канонический порядок)
#[Tuple('int32', '?string')]              // кортеж, '?' — optional-слот
#[RecordOf('uint32')]                     // map(string, T)
```

Тип элемента коллекции — строка: wire-имя (`bool`, `int32`, `uint32`,
`int64`, `uint64`, `float32`, `float64`, `fixed32`, `fixed64`, `string`,
`bytes`, `date`, `bigint`/`int` как синонимы) или FQCN класса/int-backed enum.
Префикс `?` помечает optional-элемент: `#[ArrayOf('?int32')]`,
`#[MapOf('string', '?uint32')]`, `#[Tuple('int32', '?string')]`.

```php
#[Proto]
final class Message
{
    #[ArrayOf('?string')]
    public array $maybe = [];           // count, bitmap, значения

    #[MapOf('string', '?uint32')]
    public array $counts = [];          // bitmap после count

    #[SetOf('string')]
    public array $roles = [];           // PHP-массив значений, порядок канонизируется

    #[Tuple('int32', '?string')]
    public array $pair = [0, null];

    #[RecordOf('uint32')]
    public array $record = [];
}
```

### oneof

Дискриминатор — отдельное не-nullable свойство с int-backed enum. Варианты —
nullable-свойства с `#[OneOf(Enum::Case)]`. Unit-вариант объявляется через
`#[Literal(null)]` (payload нулевой длины).

```php
enum EventKind: int
{
    case Created = 1;
    case Updated = 2;
    case Deleted = 3;
}

#[Proto]
final class Event
{
    public EventKind $kind = EventKind::Created;

    #[OneOf(EventKind::Created)]
    public ?CreatedPayload $created = null;

    #[OneOf(EventKind::Updated)]
    public ?int $updated = null;

    #[Literal(null)]
    #[OneOf(EventKind::Deleted)]
    public ?string $deleted = null;
}
```

Wire: `[1][payload]`, `[2][varint]`, `[3]`. Варианты не занимают биты bitmap;
группа стоит в позиции свойства-дискриминатора. Для нескольких групп в одном
классе используйте разные enum-типы дискриминаторов.

## Декодирование объектов

`decode` создаёт объект через `newInstanceWithoutConstructor()` и заполняет
свойства. Конструктор не вызывается. Readonly-свойства и не-public свойства
инициализируются замыканием, привязанным к scope объявляющего класса (работает
на PHP 8.3). Отсутствующие optional-поля получают `null`; отсутствие
обязательного поля проявляется как обрезка буфера или ошибка
«поле не инициализировано» при кодировании.

## Лимиты и ошибки

- Глубина вложенности — 256 (`Options::maxDepth`).
- Размер сообщения/строки/коллекции — 64 MiB (`Options::maxSize`).
- Обрезка буфера, varint длиннее 64 бит, неверный bool/enum, лишние байты,
  циклы объектов — `ProtocolException`.
- Циклы объектов при encode обнаруживаются через `SplObjectStorage`.

## Тесты

Plain-runner без PHPUnit и Composer — достаточно PHP 8.2+:

```bash
cd php && php tests/run.php   # или: composer test
# из корня репозитория:
php php/tests/run.php
```

Проверка синтаксиса:

```bash
cd php
find src tests -name '*.php' -print0 | xargs -0 -n1 php -l
```

Покрыты примитивы и крайние int64, bitmap (включая >32 полей), nested,
наследование и переопределение, коллекции и канонический порядок, oneof
(hex `010e026869`, `0254`, `03`), общий вектор `protocol/vectors/user.json`
(hex и значения читаются из JSON, не хардкодятся), ошибки и регрессия
`encode(decode(x)) == encode(x)`.

## Известные ограничения и расхождения

- **uint64/fixed64 > `PHP_INT_MAX`.** PHP int знаковый 64-битный. Значения
  `uint64`/`fixed64` больше `PHP_INT_MAX` не представимы: encode отвергает
  отрицательные, decode бросает `range` при чтении такого значения с wire.
  Диапазон `int64` (`PHP_INT_MIN`…`PHP_INT_MAX`) поддерживается полностью.
- **Только int-backed enum.** String-backed enum — ошибка схемы (как в
  Rust/Kotlin; wire-значение enum — число).
- **Один дискриминатор на enum-тип.** В классе может быть несколько oneof-групп,
  но каждой нужен свой enum-тип дискриминатора.
- **Ключи map — ключи PHP-массива.** `bool`-ключи декодируются в `0/1`,
  enum-ключи — в backing int. Объекты (в том числе enum cases) ключами PHP-массива
  быть не могут; на wire при этом всё совместимо.
- **Set классов** сортируется по закодированным байтам (поведение TS generic).
  Rust `BTreeSet` сортирует по `Ord` типа; для числовых/строковых/enum-элементов
  порядок совпадает, для пользовательских классов с нестандартным `Ord` может
  отличаться.
- **Строки — строгий UTF-8.** Некорректный UTF-8 отвергается и при encode, и при
  decode (поведение Rust; TS `TextDecoder` заменяет битые последовательности).
- **Вложенные generic-коллекции** в токене не выражаются: тип элемента — wire-имя
  или FQCN. Для вложенных коллекций используйте класс-обёртку.
- **Даты.** Декодирование возвращает `DateTimeImmutable` (или `DateTime`, если
  свойство объявлено как `\DateTime`); кастомные наследники `DateTime` не
  инстанцируются.
- **Циклы массивов** (PHP reference-циклы) не детектируются как циклы; сработает
  лимит глубины. Циклы объектов детектируются.
- **Валидация** (`validate`) в пакет не входит.

## Структура

```
php/
  composer.json
  README.md
  src/
    Protocol.php
    Options.php
    Writer.php
    Reader.php
    Schema.php
    SchemaBuilder.php
    Codec.php
    Errors/ProtocolException.php
    Internal/{Utf8,EncodeContext,DecodeContext,PropertyAccess}.php
    Attributes/{Proto,Int32,Uint32,Int64,BigInt,Uint64,Float32,Fixed32,Fixed64,
                Bytes,Date,Literal,OneOf,ArrayOf,MapOf,SetOf,Tuple,RecordOf}.php
  tests/
    run.php
    primitives_test.php
    bitmap_test.php
    nested_test.php
    collections_test.php
    oneof_test.php
    vector_test.php
    errors_test.php
    regression_test.php
```
