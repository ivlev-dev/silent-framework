# Модуль `protocol`

Рантайм и публичный API Silent Protocol для Kotlin/JVM. Схема — обычный Kotlin-класс с `@Proto`; KSP-процессор из `:ksp-processor` генерирует для него объект-кодек. На wire нет имён полей и тегов, порядок полей определяется сортировкой по имени, а не объявлением. Формат побайтно совместим с TS и Rust, спецификация — [`docs/protocol.md`](../../docs/protocol.md).

## Требования

- JDK 21 — `jvmToolchain(21)` в `protocol/build.gradle.kts` и `ksp-processor/build.gradle.kts`.
- Gradle 9.x; wrapper в репозитории не хранится, команды запускаются установленным `gradle`.
- Kotlin 2.2.20.
- KSP `2.2.20-2.0.4`, версия плагина должна соответствовать версии Kotlin.
- `kotlinx-datetime` 0.6.2 — `api`-зависимость модуля, нужна для `kotlinx.datetime.Instant`.

## Подключение

Координаты публикации:

| Артефакт | Координаты | Назначение |
| --- | --- | --- |
| рантайм | `io.github.ivlev-dev:silent-protocol:<version>` | аннотации, writer/reader, интерфейсы |
| KSP-процессор | `io.github.ivlev-dev:silent-protocol-ksp:<version>` | генерация кодеков на этапе компиляции |

`<version>` — Gradle-свойство `protocolVersion` (по умолчанию `0.14.0`).

Корневой build-скрипт чужого проекта:

```kotlin
plugins {
    kotlin("jvm") version "2.2.20" apply false
    id("com.google.devtools.ksp") version "2.2.20-2.0.4" apply false
}
```

Модуль:

```kotlin
plugins {
    kotlin("jvm")
    id("com.google.devtools.ksp")
}

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()
    mavenLocal()
}

dependencies {
    implementation("io.github.ivlev-dev:silent-protocol:0.14.0")
    ksp("io.github.ivlev-dev:silent-protocol-ksp:0.14.0")
}
```

Настройка KSP сводится к применению плагина и добавлению процессора в конфигурацию `ksp`: провайдер найден через `META-INF/services/com.google.devtools.ksp.processing.SymbolProcessorProvider`, аргументы процессора не используются. Для `@Proto`-классов в тестовых исходниках добавьте `kspTest("io.github.ivlev-dev:silent-protocol-ksp:0.14.0")`.

Если артефакты еще не опубликованы в Maven Central, выполните из каталога `kotlin`:

```bash
gradle :protocol:publishToMavenLocal :ksp-processor:publishToMavenLocal
```

## Пример

```kotlin
package com.example.model

import dev.ivlev.silent.protocol.Int32
import dev.ivlev.silent.protocol.Proto
import kotlinx.datetime.Instant

@Proto
data class User(
    val email: String,
    val age: UInt,
    @Int32 val score: Int,
    val createdAt: Instant,
)

fun roundTrip(user: User): User {
    val bytes: ByteArray = UserCodec.encode(user)
    val fingerprint: String = UserCodec.schemaFingerprint()
    check(fingerprint == "User{age:uint32;createdAt:date;email:string;score:int32}")
    return UserCodec.decode(bytes)
}
```

KSP создаёт `UserCodec` в том же пакете и с той же видимостью, что и класс: для `internal`-класса генерируется `internal object`. Вложенный класс `Holder.Nested` получает кодек `Holder_NestedCodec`.

`UserCodec` реализует `ProtoCodec<User>` и дополнительно предоставляет перегрузки для композиции:

```kotlin
UserCodec.encode(value: User): ByteArray
UserCodec.encode(value: User, options: ProtocolOptions): ByteArray
UserCodec.encode(value: User, writer: ProtoWriter)
UserCodec.decode(bytes: ByteArray): User
UserCodec.decode(bytes: ByteArray, options: ProtocolOptions): User
UserCodec.decode(reader: ProtoReader): User
UserCodec.schemaFingerprint(): String
```

`encode`/`decode` без `options` используют `ProtocolOptions.Default`. `decode(ByteArray)` требует, чтобы после сообщения не осталось байтов.

## Аннотации и интерфейсы

| API | Где применяется | Смысл |
| --- | --- | --- |
| `@Proto` | класс | Помечает схему. Нужен primary constructor и отсутствие type parameters. Private/protected классы не обрабатываются, private/protected свойства запрещены. |
| `@OneOf(code: Int)` | nullable-свойство | Вариант oneof с числовым wire-кодом. Код неотрицательный и уникальный в классе. |
| `@Int32` | `Byte`, `Short`, `Int`, `Long` | Zigzag-varint int32; для `Long` значение обязано помещаться в int32. |
| `@Uint32` | `Int`, `Long`, `UInt`, `ULong` | Varint uint32; для `Long`/`ULong` проверяется диапазон 0..2^32-1. |
| `@Float32` | `Float`, `Double` | IEEE 754 4 байта LE; `Double` сужается до `Float`. |
| `@Fixed32` | `Int`, `UInt`, `Long`, `ULong` | 4 байта LE без varint; для 64-битных типов проверяется диапазон uint32. |
| `@Fixed64` | `Long`, `ULong` | 8 байт LE без varint. |
| `@Uint64` | `Long`, `ULong` | Varint uint64 без zigzag. |
| `@EpochMillis` | `Long` | Zigzag-varint epoch milliseconds, wire-тип `date`. |
| `ProtocolEnum` | enum | Даёт явный `protocolValue: Int`; без интерфейса используется `ordinal`. |
| `ProtoCodec<T>` | объект-кодек | `encode(T): ByteArray`, `decode(ByteArray): T`, `schemaFingerprint(): String`. |

Wire-аннотации применимы только к скалярным свойствам, и на одно свойство можно повесить не более одной из них. Неподходящая комбинация — ошибка компиляции KSP.

```kotlin
enum class EventKind(override val protocolValue: Int) : ProtocolEnum {
    Created(1),
    Updated(2),
    Deleted(3),
}

@Proto
data class Event(
    val kind: EventKind,
    @OneOf(1) val created: CreatedPayload?,
    @OneOf(2) val updated: UpdatedPayload?,
    @OneOf(3) val deleted: Unit?,
)
```

## Поддерживаемые типы

| Kotlin | Wire-тип | Кодирование |
| --- | --- | --- |
| `Boolean` | `bool` | 1 байт, 0 или 1 |
| `Byte`, `Short`, `Int` | `int32` | zigzag varint |
| `Long` | `int64` | zigzag varint |
| `UByte`, `UShort`, `UInt` | `uint32` | varint |
| `ULong` | `uint64` | varint |
| `Float` | `float32` | 4 байта IEEE 754 LE |
| `Double` | `float64` | 8 байт IEEE 754 LE |
| `String` | `string` | varint длина UTF-8 + байты |
| `ByteArray` | `bytes` | varint длина + сырые байты |
| `ShortArray` | packed `int16` | varint длина в байтах + элементы LE |
| `IntArray` | packed `int32` | varint длина в байтах + элементы LE |
| `LongArray` | packed `int64` | varint длина в байтах + элементы LE |
| `FloatArray` | packed `float32` | varint длина в байтах + элементы LE |
| `DoubleArray` | packed `float64` | varint длина в байтах + элементы LE |
| `List<T>`, `MutableList<T>`, `Collection<T>` | `array(T)` | varint count + элементы |
| `Array<T>` | `array(T)` | varint count + элементы |
| `Set<T>`, `MutableSet<T>` | `set(T)` | varint count + элементы в каноническом порядке |
| `Map<K, V>`, `MutableMap<K, V>` | `map(K, V)` | varint count + пары, отсортированные по ключу |
| enum | `enum` | varint `protocolValue` или `ordinal` |
| `kotlinx.datetime.Instant` | `date` | zigzag varint epoch milliseconds |
| `T?` | optional | бит присутствия в bitmap |
| `@Proto`-класс | `class(T)` | вложенное сообщение без префикса длины |
| `Unit?` | пустой вариант oneof | payload нулевой длины |

Поддерживаются `typealias` (разворачиваются), nullable-элементы `List<T?>`/`Array<T?>`, nullable-значения `Map<K, V?>`, вложенные коллекции, nullable-вложенные сообщения и наследование: унаследованные свойства входят в схему, одноимённое свойство потомка переопределяет базовое.

## Wire-формат

Порядок полей — возрастание UTF-8 байтов имени, а не порядок объявления. Имена и теги на wire отсутствуют. Сообщение:

```
[bitmap?][entries в порядке сортировки]
```

Nullable-поля (кроме oneof-вариантов) образуют bitmap в начале сообщения. Бит `i` (LSB-first) соответствует `i`-му nullable-полю в порядке сортировки, `bitmapLength = ceil(count / 8)`. Если nullable-полей нет, bitmap отсутствует. У вложенного сообщения собственный bitmap в начале его payload.

Коллекции:

```
array(T)         = [count: varint][element...]
array(T?)        = [count][bitmap(count)][element для установленных битов]
set(T)           = [count][element...]           // канонический порядок
map(K, V)        = [count][key value...]          // порядок по ключу
map(K, V?)       = [count][bitmap(count)][key value для установленных битов]
```

Элементы самодостаточны по длине, префикс длины у вложенных сообщений не используется. Для `ShortArray`/`IntArray`/`LongArray`/`FloatArray`/`DoubleArray` вместо count пишется длина в байтах, поэтому длина обязана делиться на размер элемента.

oneof кодируется в позиции поля-дискриминатора:

```
[enum: varint][payload выбранного варианта]
```

Варианты не входят в bitmap. Для `Unit?` payload пустой (`EventKind.Deleted` — один байт кода). При кодировании ровно один вариант должен быть не `null` и соответствовать значению дискриминатора; при декодировании неизвестный код — `ProtocolError`.

### Канонический порядок

`Set`, ключи `Map` и ключи сортировки используют один порядок: строки — по UTF-8, целые — численно, `Boolean` — `false < true`, enum — по `protocolValue`, для enum без `ProtocolEnum` — по `ordinal`. Благодаря этому одинаковые значения дают одинаковые байты в TS, Rust и Kotlin.

## `schemaFingerprint`

Строка описывает схему без имени пакета: имя класса, затем поля в UTF-8-порядке через `;`, тип после `:`. Формат:

```
User{age:uint32;createdAt:date;email:string;score:int32}
Event{created:oneof(1,class(CreatedPayload));deleted:oneof(3,unit);kind:enum(EventKind);updated:oneof(2,class(UpdatedPayload))}
```

Типы: `bool`, `int32`, `int64`, `uint32`, `uint64`, `fixed32`, `fixed64`, `float32`, `float64`, `string`, `bytes`, `date`, `enum(Name)`, `class(Name)`, `array(T)`, `set(T)`, `map(K,V)`, `unit`, `oneof(code,type)`. Nullable-тип получает суффикс `?`.

Отпечаток предназначен для диагностики и проверки версии схемы внутри Kotlin. Его формат не совпадает с TS/Rust; кросс-языковая совместимость проверяется бинарными векторами, а не отпечатками.

## Обработка ошибок и лимиты

Все нарушения формата и схемы — `ProtocolError` (наследник `RuntimeException`): обрезанный буфер, переполнение varint, лишние байты, неверный boolean-байт, неизвестный enum/oneof-код, отсутствующий или лишний oneof-вариант, выход значения за диапазон `@Int32`/`@Uint32`/`@Fixed32`, циклы объектов, превышение лимитов.

`ProtocolOptions`:

| Параметр | По умолчанию | Смысл |
| --- | ---: | --- |
| `maxSize` | 64 MiB | максимальный размер сообщения в байтах |
| `maxDepth` | 256 | максимальная глубина вложенности |
| `maxCollectionSize` | 1 048 576 | максимальное число элементов коллекции |

`ProtocolOptions` можно передать в `encode(value, options)` и `decode(bytes, options)`; для собственной композиции используйте `ProtoWriter`/`ProtoReader` и перегрузки с writer/reader.

## Ограничения

- Одна oneof-группа на класс; дискриминатор — единственное non-nullable enum-поле, варианты — nullable-свойства с `@OneOf`.
- `@OneOf` принимает числовой wire-код, а не entry enum; код неотрицательный и уникальный.
- Все свойства класса обязаны быть параметрами primary-конструктора. Дополнительные параметры конструктора допустимы только со значением по умолчанию.
- Свойства и классы — `public` или `internal`; `private`/`protected` запрещены. `@Proto` применяется только к классам (не к `object`, `interface`, enum или аннотации).
- Нет generic-классов `@Proto` и generic enum.
- `Set<T>` и ключи `Map<K, V>` требуют канонического порядка: `String`, `Boolean`, целые (`Byte`..`ULong`), enum. `Float`, `Double`, `ByteArray`, классы и nullable-ключи запрещены. Элементы `Set` также не могут быть nullable.
- `Map` с nullable-значениями поддерживается, с nullable-ключами — нет.
- `Unit` допустим только как пустой вариант oneof (`Unit?`).
- Типы из локальных/анонимных классов не поддерживаются.
- Реализация JVM/Android: модули собраны `kotlin("jvm")`, но API не использует рефлексию и пригоден для переноса на KMP.
- Циклические ссылки при кодировании — ошибка; общие ссылки не сохраняются.

## Тесты и бенчмарк

Из каталога `kotlin`:

```bash
gradle :protocol:test
gradle :protocol:bench
```

`test` использует JUnit Platform и покрывает примитивы wire, границы чисел, bitmap, oneof, коллекции, наследование, ошибки, отпечатки и кросс-языковые векторы (`protocol/vectors/`). `bench` запускает `BenchMain`: модель `BenchUser` (8 полей, вложенный адрес, optional email, `string[]`, `Long`, `Int`, `Double`) занимает 60 байт и кодируется/декодируется вместе с JSON-базлайном Gson.

Ориентиры из [`docs/protocol.md`](../../docs/protocol.md):

| Язык / режим | encode | decode | JSON baseline |
| --- | ---: | ---: | ---: |
| TS static | 1.56M ops/s, 89 MB/s | 784k ops/s, 45 MB/s | stringify 523k, parse 655k |
| TS generic | 776k ops/s, 44 MB/s | 440k ops/s, 25 MB/s | — |
| Rust release | 6.41M ops/s, 385 MB/s | 7.97M ops/s, 478 MB/s | serde_json 5.02M / 2.58M |
| Kotlin JVM | 5.48M ops/s, 329 MB/s | 5.91M ops/s, 355 MB/s | Gson 69k / 81k |

Локальный прогон на JDK 21 воспроизводит порядок величин: encode ~5.5M ops/s / ~332 MB/s, decode ~5.3M ops/s / ~315 MB/s, Gson ~71k / ~85k.
