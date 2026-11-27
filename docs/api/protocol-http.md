# HTTP-контракт на `@ivlev-dev/silent-protocol`

Практический контракт использования бинарного протокола в HTTP API. Реализация —
демонстрационный сервер `examples/ui/server` (Rust/axum) и SPA `examples/ui`
(TS). Полная спецификация wire-формата — в
[`docs/protocol.md`](../../protocol.md), публичный API пакета — в
[`protocol.md`](./protocol.md).

## Заголовки

| Заголовок       | Значение                          | Где обязателен                       |
| --------------- | --------------------------------- | ------------------------------------ |
| `Content-Type`  | `application/x-silent-protocol`   | тела `POST`/`PATCH`                  |
| `Accept`        | `application/x-silent-protocol`   | рекомендован клиенту                 |

Тело — сырые байты `encode(value)`, без base64, конвертов и `Content-Length`
внутри payload. Query-параметры (фильтры, сортировка, пагинация) остаются
обычным URL. `GET /uploads/{file}` — исключение: отдаёт файл с его MIME.
`204 No Content` не имеет тела.

Сервер обязан проверять `Content-Type` до декодирования и отвечать `415`
(`invalid_content_type`) при JSON или отсутствующем заголовке. Пустое тело —
`400 empty_body`, тело больше лимита — `413 payload_too_large` (до
декодирования), битые байты или превышение объявленных длин/глубины —
`400 invalid_payload`.

## Ошибки

Ошибки кодируются той же схемой, что и успешные ответы:

```ts
class ApiError {
  public code = "";
  public message = "";
}
defineProtocol(ApiError, {
  fields: [
    { name: "code", type: "string" },
    { name: "message", type: "string" },
  ],
});
```

HTTP-статус сохраняется (`400`, `404`, `413`, `415`, `500`), `code` —
машиночитаемый (`invalid_query`, `invalid_input`, `not_found`, ...).
Клиент сначала проверяет `response.ok`, затем декодирует `ApiError`; при
неудачном декодировании использует запасной код `http_<status>`.

## Схема примера

```ts
class Project {
  public budget = 0;          // float64
  public createdAt = new Date(0); // date, epoch ms
  public id = 0;              // uint32
  public name = "";
  public owner = "";
  public status: ProjectStatus = "active"; // enum: active=0, review=1, done=2, paused=3
  public tags: string[] = []; // array<string>
}

class ProjectPage {
  public items: Project[] = [];
  public page = 0;      // uint32
  public pageSize = 0;  // uint32
  public total = 0;     // uint32
}
```

Rust-эквивалент (`#[derive(SilentProto)]`): `id: u32`,
`#[proto(date)] created_at: i64`, `budget: f64`, `status` — enum с
`#[proto(enum_type)]`. Поля кодируются в порядке сортировки имён, поэтому
`created_at` получает `#[proto(rename = "createdAt")]`.

## Общие правила

- `Option<T>`/необязательные поля выносятся в bitmap присутствия; порядок
  битов — порядок имён после сортировки.
- Вложенные сообщения пишутся без префикса длины; массивы — varint количества
  и элементы.
- Имена полей на wire не передаются: обе стороны должны иметь идентичную
  схему. Меняйте схему с версионированием или отдельным endpoint.
- Даты передавайте как `date` (`Date` ↔ epoch ms `i64`), чтобы не терять
  часовой пояс и не парсить строки.
- Счётчики и идентификаторы в примере — `uint32`/`number`: не используйте
  `bigint` без необходимости, иначе TS и Rust разойдутся по wire-типу.
- Декодируйте с явными лимитами (`Limits::new(max_depth, max_size)` в Rust,
  `decode(..., { maxDepth, maxSize })` в TS) и ограничивайте размер тела на
  уровне HTTP-слоя.

## Проверка совместимости

Общий набор векторов лежит в `examples/ui/protocol-vectors/` — по паре
`<name>.json` (описание, `hex`, `fields`) и `<name>.hex` на каждый тип:
`Project`, `ProjectPage`, `ProjectMeta`, `ProjectInput`, `ProjectPatch`,
`ApiError`, `UploadResult`, плюс `*-empty` с пустыми массивами/строками и
`project-patch-tags-empty` для отличия отсутствующего `tags` от пустого.

- Rust-тест `examples/ui/server/tests/vector.rs` кодирует фикстуры и сверяет
  байты с `.hex`, затем декодирует их с `wire::LIMITS`;
- TS-тест `examples/ui/tests/protocol-vector.test.ts` декодирует те же байты,
  кодирует обратно и проверяет `maxSize`/`maxDepth`, обрезку и лишние байты.

Такой набор ловит расхождения в порядке полей, wire-типах enum/date, bitmap
необязательных полей и обработке пустых коллекций без запуска обоих сервисов.

## Загрузка файлов

`multipart/form-data` остаётся стандартным: бинарный протокол не заменяет
multipart. Меняется только ответ — `UploadResult` кодируется протоколом.
Клиент на `XMLHttpRequest` с `responseType = "arraybuffer"` получает прогресс
отправки и декодирует как успешный `UploadResult`, так и бинарный `ApiError`
при ошибке.
