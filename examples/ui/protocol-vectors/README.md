# Кросс-языковые векторы примера

Бинарные примеры для схем `examples/ui` (Rust-сервер + TS-клиент). Формат:

- `<name>.json` — `name`, `description`, ожидаемый `hex` и декодированные
  `fields` (для людей и TS-теста);
- `<name>.hex` — только hex-байты, читается Rust-тестом через
  `include_str!`.

Источник байтов — Rust (`#[derive(SilentProto)]` в
`examples/ui/server/src/wire.rs`). Если меняется схема, hex нужно обновить в
обоих файлах. Проверки:

- Rust: `cargo test -p silent-example-ui-server --test vector` — кодирует
  фикстуру, сверяет hex, декодирует обратно (включая `wire::LIMITS`);
- TS: `pnpm --filter @ivlev-dev/silent-example-ui test` — декодирует hex,
  кодирует обратно, проверяет лимиты, обрезку, лишние байты и неизвестный
  enum.

Набор:

| Вектор | Что покрывает |
| --- | --- |
| `project` | базовый `Project`: float64, date, uint32, enum, массив |
| `project-empty` | пустые строки и `tags`, нулевые `id`/`createdAt`/`budget` |
| `project-page` | вложенные `Project`, `uint32::MAX`, отрицательная дата, кириллица |
| `project-meta` | кириллические владельцы/теги, все четыре статуса |
| `project-meta-empty` | три пустых массива (`00 00 00`) |
| `project-input` | обязательные поля без bitmap |
| `project-input-empty` | пустые строки и `tags` |
| `project-patch` | bitmap `0b0001_1000`: только `status` и `tags` |
| `project-patch-empty` | пустой патч (`00`) |
| `project-patch-tags-empty` | `tags` присутствует, но пуст (`10 00`) |
| `api-error` | код ошибки и кириллическое сообщение |
| `upload-result` | кириллическое имя файла, `size = uint32::MAX` |
