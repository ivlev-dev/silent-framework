# Пример API-бэкенда для `examples/ui`

Rust-сервер на `axum` + `redb` для демонстрационного интерфейса `examples/ui`.
Хранит проекты во встроенной ACID-БД, поддерживает фильтрацию, сортировку,
пагинацию и загрузку файлов. Все тела запросов и ответов API кодируются
бинарным протоколом [`silent-protocol`](../../../crates/silent-protocol), JSON
в примере не используется.

## Запуск

```bash
cargo run -p silent-example-ui-server
```

Сервер слушает `http://127.0.0.1:6108`, БД и загруженные файлы создаются в
`examples/ui/.data/`. Vite-прокси фронтенда уже направляет `/api` на порт 6108.

Проверка (health — один байт `0x01`):

```bash
curl -s -D - -o /tmp/health.bin http://127.0.0.1:6108/api/health
# content-type: application/x-silent-protocol
# length: 1
od -An -tx1 /tmp/health.bin
#  01
```

## Переменные окружения

| Переменная            | По умолчанию               | Описание                                                        |
| --------------------- | -------------------------- | --------------------------------------------------------------- |
| `UI_SERVER_HOST`      | `127.0.0.1`                | IP-адрес прослушивания                                          |
| `UI_SERVER_PORT`      | `6108`                     | Порт HTTP-сервера                                               |
| `UI_SERVER_DB`        | `examples/ui/.data/projects.redb` | Путь к файлу redb                                        |
| `UI_SERVER_UPLOADS`   | `examples/ui/.data/uploads`       | Каталог загруженных файлов                               |
| `SILENT_UI_DELAY_MS`  | `120`                      | Искусственная задержка `GET /api/projects` и `GET /api/meta`, мс |
| `RUST_LOG`            | `info,tower_http=info`     | Фильтр логирования `tracing`                                    |

Пути по умолчанию вычисляются от `CARGO_MANIFEST_DIR`, поэтому запуск
`cargo run -p silent-example-ui-server` из корня репозитория и из каталога
крейта работает одинаково.

## Контракт HTTP

- `Content-Type: application/x-silent-protocol` — обязателен для тел
  запросов `POST /api/projects` и `PATCH /api/projects/{id}`.
- `Accept: application/x-silent-protocol` — рекомендован клиентам; сервер
  всегда отвечает этим типом.
- Тело — сырые байты wire-формата `silent-protocol`, без JSON-обёрток.
- `GET /uploads/{file}` отдаёт сам файл с его MIME, `204 No Content` не имеет
  тела, все остальные ответы (включая ошибки) закодированы протоколом.
- Query-параметры фильтров, сортировки и пагинации остаются в URL.
- Лимит тела multipart-запроса — 21 MiB, лимит одного файла — 20 MiB. Тело
  протокольных запросов ограничено 2 MiB: превышение даёт `413
  payload_too_large` до декодирования. Декодирование API-сообщений также
  ограничено глубиной 32 и размером строк/коллекций 2 MiB (`wire::LIMITS`).

Ошибки кодируются схемой `ApiError`:

```text
ApiError { code: string, message: string }
```

HTTP-статус сохраняется (`400`, `404`, `413`, `415`, `500`), а `code` —
машиночитаемый код: `invalid_query`, `invalid_input`, `invalid_path`,
`invalid_content_type`, `invalid_body`, `invalid_payload`, `empty_body`,
`payload_too_large`, `missing_file`, `invalid_multipart`, `not_found`,
`internal_error`.

## Схемы протокола

Поля кодируются в порядке возрастания имён (UTF-8), `Option<T>` вынесен в
bitmap. Rust-схемы объявлены в `src/wire.rs`, TS-схемы — в
`examples/ui/src/api/types.ts`. Даты — `date` (epoch milliseconds: `i64` в
Rust, `Date` в TS), `id`/размеры/счётчики — `uint32`/`number`, `budget` —
`float64`, статус — enum (`active = 0`, `review = 1`, `done = 2`,
`paused = 3`).

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

`ProjectStatus` — строковый enum в TS и числовой `ProtoEnum` в Rust
(`#[proto(enum_type)]`); wire-значение — индекс из списка
`active, review, done, paused`.

## `GET /api/health`

`200 OK`, `Health { ok: true }` — один байт `0x01`.

## `GET /api/projects`

Параметры строки запроса:

| Параметр      | Допустимые значения / формат                                  | По умолчанию |
| ------------- | ------------------------------------------------------------- | ------------ |
| `page`        | целое `>= 1`                                                  | `1`          |
| `pageSize`    | целое `10..=100`                                              | `20`         |
| `sort`        | `name`, `owner`, `status`, `budget`, `createdAt`               | `createdAt`  |
| `order`       | `asc`, `desc`                                                 | `desc`       |
| `q`           | подстрока имени или владельца, регистронезависимая (Unicode)  | —            |
| `status`      | `active`, `review`, `done`, `paused`                          | —            |
| `owner`       | точное совпадение                                             | —            |
| `tag`         | точное совпадение с одним из тегов                            | —            |
| `budgetMin`   | число `>= 0`                                                  | —            |
| `budgetMax`   | число `>= 0`, `>= budgetMin`                                  | —            |
| `createdFrom` | RFC 3339 или `YYYY-MM-DD`                                     | —            |
| `createdTo`   | RFC 3339 или `YYYY-MM-DD` (конец дня)                         | —            |

Ответ — `ProjectPage`. `total` считается после применения всех фильтров.
Некорректные значения параметров дают `400` с кодом `invalid_query`.
Неизвестные параметры игнорируются.

## `GET /api/meta`

Уникальные значения из БД — `ProjectMeta`:

```text
owners:   ["Ада Ловлейс", ...]      // 8 значений в seed
statuses: [active, review, done, paused]
tags:     ["api", ...]              // 12 значений в seed
```

## `POST /api/projects`

Тело — `ProjectInput`:

```text
ProjectInput { name: "Платформа", owner: "Ада Ловлейс", status: review,
               tags: ["api", "docs"], budget: 4242.5 }
```

Возвращает `201 Created` и `Project` (`id` = максимальный + 1, `createdAt` —
текущее время UTC в epoch milliseconds). Некорректные значения полей дают
`400 invalid_input`, пустое/битое тело — `400 empty_body`/`invalid_payload`,
чужой `Content-Type` — `415 invalid_content_type`.

## `PATCH /api/projects/{id}`

Тело — `ProjectPatch`: передаются только изменяемые поля из
`name`, `owner`, `status`, `tags`, `budget`; отсутствующие поля сохраняют
значение. `id` и `createdAt` не меняются. Возвращает `200` с `Project` или
`404`, если проекта нет.

## `DELETE /api/projects/{id}`

Возвращает `204 No Content` или `404`. Тело ответа отсутствует.

## `POST /api/uploads`

`multipart/form-data`, поле `file`. Лимит файла — 20 MiB, тело запроса — 21 MiB.
Ответ — `201 Created` и `UploadResult`:

```text
UploadResult { id: "6f1a3c1e-...", mime: "text/plain", name: "notes.txt",
               size: 12, url: "/uploads/6f1a3c1e-....txt" }
```

Файл сохраняется под уникальным именем `<uuid>.<ext>`; расширение берётся из
исходного имени, если состоит из ASCII-букв/цифр (до 10 символов).
Превышение лимита — `413` с кодом `payload_too_large`, частично записанный
файл удаляется.

## `GET /uploads/{file}`

Отдаёт файл с `Content-Type` по расширению, `X-Content-Type-Options: nosniff`
и кешированием на час. Имя проверяется по строгому шаблону
`<uuid>[.<ext>]`, поэтому `..`, `/` и прочие компоненты пути отклоняются.

## CORS

Разрешены источники `http://localhost:6107` и `http://127.0.0.1:6107`,
методы `GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS`, заголовки
`Accept`, `Content-Type`.

## База данных

Файл `projects.redb` (redb 4.x, ACID, MVCC, один писатель и параллельные
читатели). В одной транзакции создаются таблицы:

| Таблица      | Ключ              | Значение                                  |
| ------------ | ----------------- | ----------------------------------------- |
| `projects`   | `u64` id          | `wire::Project` в silent-protocol         |
| `idx_status` | `(&str, u64)`     | статус → id                               |
| `idx_owner`  | `(&str, u64)`     | владелец → id                             |
| `idx_name`   | `(&str, u64)`     | имя → id                                  |
| `idx_created`| `(i64, u64)`      | timestamp millis → id                     |
| `idx_tag`    | `(&str, u64)`     | тег → id                                  |
| `db_meta`    | `&str`            | маркер формата БД (`format`)              |

Записи кодируются и декодируются через `silent_protocol::SilentProto` с
лимитами API; повреждённая запись возвращает `StoreError::Corrupted`.

Формат файла помечается в таблице `db_meta` ключом `format =
silent-protocol/1`. При старте:

- БД без маркера с декодируемыми протокольными записями помечается текущей и
  сохраняет данные;
- БД без маркера с JSON/несовместимыми значениями или с чужими типами таблиц
  архивируется в `projects.redb.legacy` и создаётся заново (seed 240
  проектов);
- совпадение имени таблицы при другом типе ключа/значения тоже приводит к
  пересозданию, а не к падению сервера.

Так миграция со старой JSON-версии не требует ручного удаления файла, а
резервная копия остаётся рядом.

Вторичные индексы обновляются в той же транзакции, что и запись проекта.
При чтении фильтры по `status`, `owner`, `tag` и диапазону `createdAt`
сначала сужают набор id через индексы, после чего оставшиеся условия (`q`,
`budget`) и сортировка/пагинация выполняются в памяти. `total` считается
после фильтрации. Такой подход сохраняет корректность на 240 записях и
оставляет основу для роста.

Если таблица `projects` пуста, при старте детерминированно создаются 240
проектов: 16 префиксов × 15 существительных, 8 владельцев, 4 статуса
(по 60), 12 тегов, бюджеты и даты за последний год.

## Разработка

```bash
cargo fmt -p silent-example-ui-server
cargo clippy -p silent-example-ui-server --all-targets -- -D warnings
cargo test -p silent-example-ui-server
pnpm --filter @ivlev-dev/silent-example-ui typecheck
pnpm --filter @ivlev-dev/silent-example-ui test
pnpm --filter @ivlev-dev/silent-example-ui build
```

Тесты:

- `src/query.rs` — разбор и валидация параметров, фильтры, сортировка,
  пагинация;
- `src/model.rs` — валидация полей и частичные обновления;
- `src/wire.rs` — кодирование/декодирование схем, bitmap патча, enum,
  лимиты, переполнение `uint32`;
- `src/store.rs` — seed, CRUD, синхронизация индексов, переоткрытие БД,
  миграция legacy-БД (JSON и чужие типы таблиц) с архивом `.legacy`,
  повреждённые записи, откат неуспешного обновления и конкурентные записи
  (8 потоков, уникальные id, согласованные индексы);
- `src/uploads.rs` — безопасность имён, MIME, расширения;
- `tests/api.rs` — HTTP-тесты через `tower::ServiceExt::oneshot` с временной
  redb: health, meta, список, CRUD, все ошибки в бинарном `ApiError`, неверный
  `Content-Type`, пустое/битое/слишком большое тело, превышение объявленных
  длин, CORS, загрузка файлов, path traversal;
- `tests/vector.rs` — 12 общих бинарных векторов из
  `examples/ui/protocol-vectors/`: `Project`, `ProjectPage`, `ProjectMeta`,
  `ProjectInput`, `ProjectPatch`, `ApiError`, `UploadResult` (включая пустые
  массивы, кириллицу, границы `uint32`, отсечение по лимитам, обрезанные и
  удлинённые буферы);
- `examples/ui/tests/protocol-vector.test.ts` — TS декодирует те же векторы,
  кодирует обратно и проверяет лимиты/негативные случаи (vitest).

## Кросс-языковые векторы

`examples/ui/protocol-vectors/` — пары `<name>.json` (описание + `hex` +
`fields`) и `<name>.hex` (только байты) для всех схем примера:

| Вектор | Покрывает |
| --- | --- |
| `project` | базовый Project: float64, date, uint32, enum, массив |
| `project-empty` | пустые строки, пустой `tags`, нулевые `id`/`createdAt` |
| `project-page` | вложенные Project, `uint32::MAX`, отрицательная дата, кириллица |
| `project-meta` | владельцы/теги на кириллице, все 4 статуса |
| `project-meta-empty` | три пустых массива (`00 00 00`) |
| `project-input` / `project-input-empty` | обязательные поля без bitmap, пустые строки |
| `project-patch` | bitmap `0b0001_1000`: только `status` и `tags` |
| `project-patch-empty` | один байт `00` |
| `project-patch-tags-empty` | `tags` присутствует, но пуст (`10 00`) |
| `api-error` | код и кириллическое сообщение |
| `upload-result` | кириллическое имя файла, `size = uint32::MAX` |

Rust-тест (`tests/vector.rs`) — источник байтов: кодирует фикстуру, сверяет
hex, декодирует обратно с `wire::LIMITS`. TS-тест
(`examples/ui/tests/protocol-vector.test.ts`) делает обратное и дополнительно
проверяет `maxSize`/`maxDepth`, обрезку, лишние байты и неизвестный enum.

Регенерация после изменения схемы: обновить hex в `.hex`/`.json` из
Rust-энкодера и прогнать оба набора тестов — расхождение означает несовместимый
wire-формат.

## Ограничения

- Нет аутентификации и авторизации — пример для локальной разработки.
- Загрузки не индексируются в БД; MIME при выдаче определяется по расширению.
- `SILENT_UI_DELAY_MS` действует только на `GET /api/projects` и
  `GET /api/meta`, чтобы имитировать загрузку данных.
- `budget` — `f64`; значения `NaN`/`Infinity` и отрицательные отклоняются.
- `id`, `total`, `page`, `pageSize` и размер загрузки ограничены `uint32`;
  переполнение возвращает `500`, а не тихое усечение.
- При очень большом количестве записей потребуется вынести часть фильтров и
  сортировку в индексы/отдельные запросы: текущая реализация сознательно
  держит простую и проверяемую логику для демо.
