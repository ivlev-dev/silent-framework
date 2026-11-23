# План по протоколу

Проверка TS-реализации Silent Protocol в SPA/SSR и интеграции PHP: что подтверждено, что сломано и в каком порядке чинить. Wire-формат корректен — расхождения сосредоточены в контракте статических кодеков, edge-случаях и тестовом покрытии. Код в рамках этой задачи не менялся; документ фиксирует факты и репро.

Приоритеты: **P1** — ломает публичный контракт или данные, **P2** — неверное поведение на валидном/недоверенном входе, **P3** — совместимость, документация и инварианты.

## Сводка

| # | Приоритет | Дефект | Где |
| --- | --- | --- | --- |
| 1 | P1 | `Record<K,V>` decode → `Map`, generic → plain object | `packages/protocol-vite/src/typegen.ts`, `packages/protocol/src/codec.ts` |
| 2 | P1 | `@Fixed64()`/`@EpochMillis()` на `number` → нерабочий код | `packages/protocol-vite/src/typegen.ts` |
| 3 | P2 | Static-кодек не валидирует домены значений | `packages/protocol-vite/src/typegen.ts` |
| 4 | P2 | `Writer.maxSize` завышен на varint | `packages/protocol/src/writer.ts` |
| 5 | P2/P1 untrusted | Амплификация памяти на decode массива | `packages/protocol/src/codec.ts` |
| 6 | P2 | Подкласс без own-codec наследует кодек базы | `packages/protocol/src/codec.ts` |
| 7 | P3 | Browser baseline не задан | `packages/protocol/src/writer.ts`, `codec.ts`, `reader.ts` |
| 8 | P3 | Typed arrays: static raw memory vs generic LE | `packages/protocol-vite/src/typegen.ts`, `packages/protocol/src/codec.ts` |
| 9 | P3 | Module-level пулы и синхронное допущение | `packages/protocol/src/codec.ts`, `writer.ts`, `reader.ts` |
| 10 | P3 | HMR/watch и тихий пропуск модулей | `packages/protocol-vite/src/vite.ts` |
| 11 | P3 | Мелочи контракта и документации | `codec.ts`, `docs/api/protocol.md` |

## 1. Статус проверки SPA/SSR

Проверка ручная: постоянных браузерных и SSR-тестов протокола в репозитории нет (см. раздел 5), поэтому результат ниже — разовый прогон на валидных данных и 14 edge-кейсах.

- [x] SPA: `vite build` и `vite dev`, generic-путь через `defineProtocol` — hex совпадает с эталоном.
- [x] SPA: плагинный путь `@ivlev-dev/silent-protocol-vite` (static-кодек) — hex совпадает.
- [x] SSR: `vite build --ssr` в обоих режимах (`noExternal`/bundled и `external`) — hex совпадает.
- [x] SSR: `vite.ssrLoadModule` в dev — hex совпадает.
- [x] Cross-режим (клиентский и серверный бандлы в одном прогоне) — байт-в-байт.
- [x] Эталон на валидных данных: `user.json` — hex `01010c…002940` из `protocol/vectors/user.json`; oneof — `010e026869`, `0254`, `03`.
- [x] 14 edge-кейсов: результаты совпали с эталонным generic-путём; регрессий wire-формата нет.
- [x] Бандлы без `Buffer`/`process`/`node:` — статический кодек и рантайм не тянут Node-полифиллы.
- [x] Ошибок в консоли браузера и SSR-логе нет.

Вывод: **wire-формат и байты корректны**, дефекты — в контракте (типы значений после decode), валидации доменов и edge-случаях ниже. Их не видно на «счастливом» векторе, поэтому нужны постоянные parity/e2e-тесты.

## 2. P1. Контракт статических кодеков

### 2.1. `Record<K,V>` декодируется в `Map`

- [ ] Исправить тип результата static-decode для `Record`: plain object, как в generic-пути.

Факт: typegen распознаёт `Record` и помечает узел `record: true` (`packages/protocol-vite/src/typegen.ts:771-779`, `:797`), но:

- `renderNode` для `map` теряет признак `record` — в схему уходит `["map", key, value]` (`typegen.ts:1040-1042`);
- static encode конвертирует объект в `Map` (`typegen.ts:1366-1374`);
- static decode всегда вызывает `readMap` (`typegen.ts:1529-1530`).

Эталон: `recordCodec` возвращает plain object через `Object.defineProperty` (`packages/protocol/src/codec.ts:1201-1253`); рантайм уже умеет `["record", T]` (`packages/protocol/src/types.ts:42`, `packages/protocol/src/schema.ts:176`) и `readMap` — это отдельный тип.

Репро (static-кодек):

```ts
class Meta { public accessor a = 0; }
class Doc {
  public accessor meta: Record<string, number> = {};
}

const doc = new Doc();
doc.meta = { a: 42 };
const restored = decode(Doc, encode(doc));

restored.meta instanceof Map;        // true
restored.meta["a"];                  // undefined
JSON.stringify(restored.meta);       // "{}"
```

Байты при этом совпадают с generic-путём: расходится только форма значения.

Фикс: эмитить в runtime-схему `["record", T]` (сейчас `ProtocolTypeSchema` такого варианта не имеет — `typegen.ts:37-45`), добавить `writeRecord`/`readRecord` в `ProtocolHelperName` и использовать их вместо `map` + `new Map(Object.entries(...))`. Кодек писать по образцу `recordCodec`. Добавить тест parity `Record` static vs generic.

### 2.2. `@Fixed64()`/`@EpochMillis()` на `number` дают нерабочий код

- [ ] Сохранять wire-подсказку декоратора в сгенерированной схеме/кодеке, а не подменять тип поля.
- [ ] Покрыть `@Fixed64`, `@EpochMillis`, `@Uint64` на `number` тестами encode/decode.

Факт: `applyDecorators` для `number` заменяет примитив на wire-имя (`typegen.ts:881-912`: `@Fixed64` → `primitive("fixed64")`, `@EpochMillis` → `primitive("date")`). В рантайме `fixed64` — это `bigint` (`packages/protocol/src/writer.ts:139-143`, `reader.ts:307-312`), а `date` — `Date` (`typegen.ts:1115-1137`, `:1150-1176`). Generic-путь при этом хранит wire отдельно от типа поля (`FieldOptions.wire`, `packages/protocol/src/types.ts:129`; `checkWire`, `schema.ts:405-430`) и для поля, объявленного `number`, возвращает `number`: safe-range конверсия в `fixed64Codec`/`uint64Codec` (`codec.ts:335-415`) и `epochMillisCodec("number")` (`codec.ts:455-483`). То есть static расходится с generic не только по коду, но и по типу результата.

Репро (static-кодек, сгенерированный плагином):

```ts
class Msg {
  public accessor a = 0;   // @Fixed64()
  public accessor b = 0;   // @EpochMillis()
  public accessor c = 0;   // @Uint64()
}

encode(msg);   // TypeError: Cannot convert 42 to a BigInt       (writer.fixed64)
encode(msg);   // TypeError: value.getTime is not a function    (writer.zigzag)
decode(...);   // a → 42n, b → Date; обратный encode падает
```

Для сравнения, generic-путь на тех же объявлениях даёт `a: number`, `b: number`, `c: number` и корректно кодирует. `@Uint64()` на `number` в static-пути декодируется в `5n`, а fallback-encode бросает `ProtocolError` (значение не того типа).

Фикс: не терять `wire` при генерации (отдельное поле схемы или узел `{kind:"primitive", name:"float64", wire:"fixed64"}`) и повторить generic-семантику: внутри `bigint`/`Date`-безопасная работа, на границе — `number` с проверкой safe-range. Альтернатива — запрещать такие комбинации диагностикой, но это осознанно сузит текущий generic-контракт.

## 3. P2. Валидация и лимиты

### 3.1. Static-кодек не валидирует домены значений

- [ ] Привести ошибки static-кодека к generic: невалидный enum, bool, string, fixed32, длина tuple.

Факт (`packages/protocol-vite/src/typegen.ts:1115-1137`, `:1150-1176`, `:1291-1297`, `:1315-1353`, `:1462-1465`):

- неизвестный enum → `undefined` без ошибки;
- `fixed32 = -1` → `4294967295` (молчаливое переполнение);
- `bool = 1` → `true`;
- `string = 42` пишет 0 байт;
- tuple лишней длины обрезается;
- `uint32 = 1.5` уже бросает — то есть поведение непоследовательно.

Generic-путь проверяет домены и бросает `ProtocolError` с кодом `"value"`/`"range"`. Нужно либо повторить проверки в static-кодеке (цена — ветки в горячем пути), либо задокументировать, что static-кодек доверяет типу, и добавить `validate`-режим.

### 3.2. `Writer.maxSize` завышен на varint

- [ ] Считать `maxSize` по фактической длине varint, а не по худшему случаю 10 байт.

Факт: `varintUnsafe` делает `ensure(10)` до записи (`packages/protocol/src/writer.ts:75-87`), `varint` — тоже (`:104-115`). Поэтому `new Writer(1).varint(1)` падает с `"size"`, хотя результат — 1 байт; сообщение из 9 байт при `maxSize: 9` отвергается.

Репро:

```ts
const writer = new Writer(1);
writer.varint(1);   // ProtocolError("size"), хотя нужно 1 байт
```

Фикс: вычислять длину varint до `ensure` (или проверять `length + needed` после), сохранив проверку на переполнение буфера.

### 3.3. Амплификация памяти на decode массива

- [ ] Ограничить `count` до аллокации: `count * минимальный размер элемента <= остаток буфера` или отдельный потолок.

Факт: `readArray`/`readOptionalArray`/generic-ветка массива сразу делают `new Array(count)` (`packages/protocol/src/codec.ts:953-954`, `:1420-1421`, `:1440-1457`). Payload из 3 байт с `count = 1e6` даёт +8.2 MB, затем падение `truncated`; при `DEFAULT_MAX_SIZE = 64 MiB` возможны ~512 MB до ошибки.

Репро: `decode(Message, new Uint8Array([0xc0,0x84,0x3d]))` для поля-массива — аллокация происходит до чтения элементов.

Фикс: sanity-check `count` по остатку буфера и минимальному размеру элемента (1 байт для varint/bool/bytes-длины, 4/8 для fixed, 2 для date и т.п.), либо жёсткий потолок элементов. Это важно для недоверенного входа и SSR.

### 3.4. Подкласс без own-codec наследует кодек базы

- [ ] Проверять `PROTOCOL_CODEC` только как own-свойство конструктора.

Факт: `staticCodecFor` читает `(ctor as ...)[PROTOCOL_CODEC]` (`packages/protocol/src/codec.ts:139-152`), поэтому `class DynamicSub extends Base` без собственного кодека получает static-кодек `Base`: `decode(DynamicSub)` возвращает `Base`, поля подкласса теряются. Generic-опции при этом читаются только как own (`packages/protocol/src/schema.ts:76-81`, `readOwn`).

Плагинный путь с `protocol()` корректен — там кодек есть у каждого класса. Дефект проявляется у ручных/динамических подклассов.

Фикс: `Object.hasOwn(ctor, PROTOCOL_CODEC)`; при отсутствии — generic-путь по нормализованной схеме (она уже учитывает наследование полей).

## 4. P3. Совместимость, инварианты, инструменты

### 4.1. Browser baseline не задан

- [ ] Зафиксировать целевые браузеры (browserslist) и добавить guards/фолбэки для API из списка.

Факт: `TextEncoder.encodeInto` (`packages/protocol/src/writer.ts:9-18`), `BigInt64Array instanceof` (`codec.ts:517-564`), `DataView.getBigUint64` (`reader.ts:307-312`) используются без feature-detect. `package.json` объявляет только `engines.node >= 22`, `browserslist` в репозитории нет. Для SSR/Node это нормально, для браузерного бандла — неявный baseline.

### 4.2. Typed arrays: static raw memory vs generic LE

- [ ] Привести static-путь к little-endian или задокументировать расхождение.

Факт: static `bytesEncode` для view передаёт сырой буфер (`packages/protocol-vite/src/typegen.ts:1102-1110`), generic — канонизирует в LE через `littleEndianBytes` (`packages/protocol/src/codec.ts:517-564`). На BE-хостах байты разойдутся; на распространённых LE-платформах — совпадают.

### 4.3. Module-level пулы и синхронное допущение

- [ ] Задокументировать инвариант: `encode`/`decode` синхронны и не реентерабельны на одном модуле.
- [ ] По возможности добавить assert/очистку при исключении.

Факт: пулы Writer/Reader/контекстов и общий `utf8Scratch` — модульные (`codec.ts:1710-1715`, `writer.ts:10`, `reader.ts:6`). Корректно при синхронном кодеке; асинхронный/вложенный вызов из хука или прокси может перетереть состояние. Это ограничение, а не баг, но оно нигде не описано.

### 4.4. HMR/watch и тихий пропуск

- [ ] Предупреждать, если модуль с протокол-классом остался без схемы.
- [ ] Покрыть `add`/`unlink` в `vite build --watch` и модули с query.

Факт (`packages/protocol-vite/src/vite.ts:24`, `:66-84`, `:335-348`): `configureServer` слушает `change`/`add`/`unlink`, но сборка `--watch` идёт через `watchChange`; модули с нестандартным query отсекаются, а модуль с `static {` в нестандартном форматировании может не распознаться как уже сгенерированный. В этих случаях класс остаётся без схемы **без warning** — падение случится позже, в рантайме.

### 4.5. Мелочи контракта и документации

- [ ] `maxDepth` off-by-one: encode проверяет `depth >= maxDepth` при `depth = 0`, decode — при `depth = -1` (`codec.ts:92`, `:119`); выровнять семантику и покрыть тестом.
- [ ] `decode` принимает только `Uint8Array`; `ArrayBuffer`/`Buffer` нужно оборачивать. Задокументировать или расширить сигнатуру.
- [ ] `docs/api/protocol.md` обещает, что `@ivlev-dev/silent-validation`自动 ставит `VALIDATION_HOOK` (`docs/api/protocol.md:572`), но в `packages/validation/src` установки нет — `validate: true` даёт `ProtocolError("validation")`. Либо поставить хук, либо исправить документацию.
- [ ] Non-strict typegen молча выбрасывает неподдерживаемое поле (`typegen.ts:1987-1992`); в `strict` — падает. Добавить в docs таблицу «поле пропущено» vs «сборка упала».
- [ ] `accessor` + `JSON.stringify` даёт `{}` (значения живут в аксессорах) — задокументировать, чтобы не выглядело потерей данных.

## 5. Пробелы тестов

- [ ] Все тесты протокола — `environment: "node"` (`packages/protocol/vitest.config.ts:7`, `packages/protocol-vite/vitest.config.ts:5`). Нет постоянных браузерных и SSR-тестов, поэтому проверка из раздела 1 не защищена от регрессий.
- [ ] `packages/protocol-vite/tests/typegen.test.ts:218-232` закрепляет неверные ожидания: `ts → "date"` и `record → ["map", ...]`. После фиксов P1 тест нужно обновить, иначе он будет охранять дефект.
- [ ] Нет parity-тестов static vs generic для `Record`, декораторов (`@Fixed64`/`@EpochMillis`/`@Uint64` на `number`) и ошибок домена (`bool`, `fixed32`, enum, tuple).
- [ ] Нет тестов: подкласс без собственного кодека, `maxSize` на границе varint, амплификация `count` на decode, `> 32` optional-полей в статическом кодеке.
- [ ] Нет e2e, который собирает SPA (`build`/`dev`) и SSR (`build --ssr`, `ssrLoadModule`) и сверяет hex с `protocol/vectors/user.json` — именно он поймал бы расхождения бандлов.

## 6. PHP: сделано и хвосты

Сделано (пакет `php/`, composer `ivlev-dev/silent-protocol`). В окружении проверки PHP не установлен, поэтому счётчик тестов подтверждён статически (62 вызова `test(...)`), а прогон — в CI job:

- [x] Атрибуты + рефлексия: `#[Proto]`, wire-атрибуты, коллекции, `#[OneOf]`, `#[Date]`, `#[Literal]`, `#[Bytes]` (`php/src/Attributes/`).
- [x] 62 теста в plain-runner без PHPUnit (`php/tests/run.php`; 62 вызова `test(...)`).
- [x] Общий вектор `protocol/vectors/user.json` читается из JSON, hex не хардкодится (`php/tests/vector_test.php`).
- [x] CI job `php`: `composer validate --strict`, `php -l` по всем файлам, `php tests/run.php` (`.github/workflows/ci.yml:151-169`).
- [x] Синхронизация версии: `scripts/version.mjs:9,66-78` и `scripts/verify-versions.mjs:7,41-58` проверяют `Protocol::VERSION` (`php/src/Protocol.php:17`) и запрещают поле `version` в `composer.json`.
- [x] Документация: `docs/protocol.md` (раздел «PHP API»), `php/README.md`, запись в `README.md`.

Хвосты:

- [x] `protocol/vectors/README.md`: «TS, Rust, Kotlin и PHP» (исправлено в этом изменении).
- [ ] PHP 8.2 не проверяется в CI: `composer.json` требует `>=8.2`, job ставит 8.3. Добавить матрицу `8.2`/`8.3` или явно зафиксировать 8.3 как минимально проверенную.
- [ ] Публикация в Packagist не настроена: нет workflow и хука на тег; `composer.json` версии не содержит (это правильно для Packagist). Нужен тег-триггер (общий релизный или отдельный `php-vX.Y.Z`) и шаг публикации/вебхук Packagist.
- [ ] Политика `php/composer.lock`: файла нет и он в `.gitignore` не упомянут (игнорируется только `php/vendor/`). Для библиотеки lock обычно не коммитят — зафиксировать это в `php/README.md`.
- [ ] Известные ограничения PHP (уже описаны в `php/README.md:233-259`, нужен только явный чек-лист совместимости): `uint64`/`fixed64` > `PHP_INT_MAX`, только int-backed enum, строгий UTF-8 (TS заменяет битые последовательности), `validate` не входит в пакет, set классов сортируется по байтам.

## 7. Порядок работ

1. **P1** — контракт:
   - [ ] `Record` → plain object в static-кодеке + parity-тест.
   - [ ] wire-декораторы на `number` (`@Fixed64`, `@EpochMillis`, `@Uint64`) + parity-тест.
   - [ ] Обновить `typegen.test.ts:218-232`, чтобы он не закреплял дефект.
2. **P2** — валидация и лимиты:
   - [ ] Домены значений static-кодека (enum/bool/string/fixed32/tuple).
   - [ ] `maxSize` по фактической длине varint.
   - [ ] Sanity-check `count` при decode массива (недоверенный вход, SSR).
   - [ ] Own-only `PROTOCOL_CODEC` для подклассов.
3. **Тесты** — защита от регрессий:
   - [ ] Browser/SSR e2e: SPA `build`/`dev` + SSR `build --ssr`/`ssrLoadModule`, сверка hex с `protocol/vectors/user.json` и oneof (`010e026869`, `0254`, `03`).
   - [ ] Static-vs-generic parity: `Record`, декораторы, ошибки, `maxSize`, `count`, `> 32` optional, подкласс без кодека.
   - [ ] Отдельный прогон в браузерном окружении (Playwright/vitest browser) хотя бы для encode/decode и generated code.
4. **P3 и документация**:
   - [ ] Browserslist/guards, LE-канонизация typed arrays, инвариант синхронности пулов.
   - [ ] Warning при пропуске модуля (HMR/watch), `maxDepth`, `ArrayBuffer`/`Buffer` на входе `decode`.
   - [ ] Синхронизировать `docs/api/protocol.md` про `VALIDATION_HOOK`, non-strict typegen и `JSON.stringify`.
   - [ ] PHP: PHP 8.2 в CI, Packagist, политика `composer.lock`, явный чек-лист ограничений.
