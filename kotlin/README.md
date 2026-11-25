# Silent Protocol для Kotlin

Kotlin/JVM-реализация бинарного протокола Silent: класс данных является схемой, KSP генерирует кодек без рефлексии в рантайме. Формат совместим по байтам с TS и Rust-реализациями, описание wire-формата — в [`docs/protocol.md`](../docs/protocol.md).

## Состав проекта

| Модуль | Назначение | Координаты |
| --- | --- | --- |
| `protocol` | рантайм: аннотации, `ProtoWriter`/`ProtoReader`, `ProtocolOptions`, `ProtocolError`, `ProtoSort`, `ProtoNumbers`, интерфейсы `ProtoCodec`/`ProtocolEnum` | `dev.ivlev.silent:silent-protocol` |
| `ksp-processor` | KSP-процессор, который по `@Proto` генерирует `object <Class>Codec : ProtoCodec<Class>` | `dev.ivlev.silent:silent-protocol-ksp` |

Тесты протокола лежат в `protocol/src/test/kotlin`, включая кросс-языковые векторы (`CrossLanguageTest`) и замеры (`BenchMain`). Подробный справочник по API, типам и ограничениям — в [`protocol/README.md`](protocol/README.md).

## Требования

- JDK 21 (тулчейн задан через `jvmToolchain(21)`).
- Gradle 9.x. Wrapper в репозитории отсутствует, используется установленный `gradle`.
- Kotlin 2.2.20.
- KSP `2.2.20-2.0.4` (версия должна соответствовать версии Kotlin).
- `kotlinx-datetime` 0.6.2 — транзитивная зависимость `protocol` (тип `Instant`).

## Быстрый старт

```kotlin
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

val user = User("user@example.com", 30u, 42, Instant.fromEpochMilliseconds(1_700_000_000_000))
val bytes = UserCodec.encode(user)
val restored: User = UserCodec.decode(bytes)
val fingerprint: String = UserCodec.schemaFingerprint()
```

`UserCodec` генерируется KSP в том же пакете, что и `User`, и реализует `ProtoCodec<User>`.

## API одним взглядом

| API | Назначение |
| --- | --- |
| `@Proto` | помечает класс-схему с primary constructor |
| `@OneOf(code: Int)` | nullable-вариант oneof с числовым wire-кодом |
| `@Int32`, `@Uint32`, `@Float32`, `@Fixed32`, `@Fixed64`, `@Uint64` | переопределяют wire-представление скалярного свойства |
| `@EpochMillis` | `Long` как epoch milliseconds (wire-тип `date`) |
| `ProtocolEnum` | явные коды enum через `protocolValue`; без него используется `ordinal` |
| `ProtoCodec<T>` | `encode`, `decode`, `schemaFingerprint` у сгенерированного кодека |
| `ProtocolOptions` | лимиты `maxSize` (64 MiB), `maxDepth` (256), `maxCollectionSize` (1 048 576) |
| `ProtocolError` | единый тип ошибок формата и схемы |

Поддерживаются `Boolean`, `Byte`/`Short`/`Int` (`int32`), `Long` (`int64`), `UByte`/`UShort`/`UInt` (`uint32`), `ULong` (`uint64`), `Float`/`Double`, `String`, `ByteArray`, `ShortArray`/`IntArray`/`LongArray`/`FloatArray`/`DoubleArray`, `List`/`Set`/`Map`/`Array`, enum, `Instant`, nullable-поля, вложенные `@Proto`-классы и oneof.

Сообщение на wire: `[bitmap?][поля в UTF-8-порядке имён]`. Nullable-поля (кроме oneof-вариантов) дают bitmap в начале сообщения, бит `i` — LSB-first. Числа — zigzag/varint или fixed LE, строки и `ByteArray` — varint-длина + payload, коллекции — count + элементы, `Set`/`Map` сортируются канонически, oneof — varint-код + payload выбранного варианта.

## Подключение в чужом Gradle-проекте

Корневой `build.gradle.kts`:

```kotlin
plugins {
    kotlin("jvm") version "2.2.20" apply false
    id("com.google.devtools.ksp") version "2.2.20-2.0.4" apply false
}
```

Модуль приложения:

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
    implementation("dev.ivlev.silent:silent-protocol:0.14.0")
    ksp("dev.ivlev.silent:silent-protocol-ksp:0.14.0")
}
```

Процессор регистрируется автоматически через `META-INF/services`, дополнительная настройка KSP не нужна. Если `@Proto`-классы объявлены в тестовых исходниках, добавьте `kspTest("dev.ivlev.silent:silent-protocol-ksp:0.14.0")`.

Артефакт `silent-protocol-ksp` нужен только на конфигурации `ksp` (это процессор, а не рантайм-зависимость). Версия KSP-плагина должна совпадать с версией Kotlin, которой собран проект.

## Сборка и проверки

Все команды выполняются из каталога `kotlin`:

```bash
gradle :protocol:test
gradle :protocol:bench
gradle :ksp-processor:build
gradle :protocol:publishToMavenLocal :ksp-processor:publishToMavenLocal
gradle :protocol:test :ksp-processor:build :protocol:publishToMavenLocal --console=plain
```

`bench` — `JavaExec`-задача, печатающая ops/s и MB/s для кодирования/декодирования и JSON-базлайна Gson на модели из 8 полей (60 байт на wire).

## Публикация

Версия берётся из Gradle-свойства `protocolVersion` (файл `gradle.properties`), переопределяется через `-PprotocolVersion=...` или `ORG_GRADLE_PROJECT_protocolVersion`. Публикация настроена через `maven-publish` и `components["java"]`:

| Publication | Group | Artifact | Версия |
| --- | --- | --- | --- |
| `maven` в `:protocol` | `dev.ivlev.silent` | `silent-protocol` | `protocolVersion` |
| `maven` в `:ksp-processor` | `dev.ivlev.silent` | `silent-protocol-ksp` | `protocolVersion` |

Локальная публикация:

```bash
gradle :protocol:publishToMavenLocal :ksp-processor:publishToMavenLocal
```

Артефакты появятся в `~/.m2/repository/dev/ivlev/silent/`. Репозитории с секретами в build-скриптах не настроены.

### Публикация в Maven Central

```bash
export MAVEN_CENTRAL_USERNAME=...
export MAVEN_CENTRAL_PASSWORD=...
export GPG_PRIVATE_KEY="$(gpg --armor --export-secret-keys <key>)"
export GPG_PASSPHRASE=""   # если ключ без пароля
pnpm publish:maven
```

Скрипт собирает staging-repo, подписывает артефакты, упаковывает bundle, загружает в Central Portal (`publishingType=AUTOMATIC`) и ждёт `PUBLISHED`. Нужны подтверждённый namespace (`dev.ivlev.silent` или другой из аккаунта) и публичный GPG-ключ на keyserver.

### Что осталось для Maven Central

- Добавить репозиторий Sonatype OSSRH (или Central Portal) и учётные данные из переменных окружения/`gradle.properties`, не из репозитория.
- Подключить подпись публикаций (`signing` plugin, GPG-ключ и пароль из окружения).
- Публиковать `sources`- и `javadoc`-артефакты (для Kotlin обычно Dokka или пустой javadoc-jar), они обязательны для Central.
- Заполнить в POM `url`, `scm`, `developers` и выполнить release-процедуру портала.

## Ограничения и совместимость

- Реализация JVM/Android; API не использует рефлексию и опирается на `kotlinx-datetime`, поэтому пригодна для переноса на KMP, но модули сейчас собраны плагином `kotlin("jvm")`.
- Одна oneof-группа на класс, `@OneOf` принимает числовой wire-код, а не entry enum.
- Все свойства обязаны быть параметрами primary-конструктора.
- Нет generic-классов `@Proto`.
- `Set` и ключи `Map` требуют канонического порядка (строки, целые, `bool`, enum).
- `schemaFingerprint()` стабилен внутри Kotlin, но его формат не сравнивается с TS/Rust; источник истины кросс-языковой совместимости — бинарные векторы в `protocol/vectors/`.

Полный список — в [`protocol/README.md`](protocol/README.md).

## Производительность

Ориентиры с одной и той же модели `User` (8 полей, вложенный `Address`, optional `email`, `Long`/`bigint` id, `int32` age/zip, `string[]`, `float64`), 60 байт на wire, из [`docs/protocol.md`](../docs/protocol.md):

| Язык / режим | encode | decode | JSON baseline |
| --- | ---: | ---: | ---: |
| TS static | 1.56M ops/s, 89 MB/s | 784k ops/s, 45 MB/s | stringify 523k, parse 655k |
| TS generic | 776k ops/s, 44 MB/s | 440k ops/s, 25 MB/s | — |
| Rust release | 6.41M ops/s, 385 MB/s | 7.97M ops/s, 478 MB/s | serde_json 5.02M / 2.58M |
| Kotlin JVM | 5.48M ops/s, 329 MB/s | 5.91M ops/s, 355 MB/s | Gson 69k / 81k |

Локальный прогон `gradle :protocol:bench` на JDK 21 даёт тот же порядок величин (пример: encode ~5.5M ops/s / ~332 MB/s, decode ~5.3M ops/s / ~315 MB/s, Gson ~71k / ~85k). Абсолютные числа зависят от машины и нагрузки.
