# Silent UI — пример SPA

Демонстрационное приложение на Silent Framework: дашборд, серверная таблица проектов,
команда и настройки. Навигация работает через History API
(`@ivlev-dev/silent-router`), данные приходят из `examples/ui/server` по
`application/x-silent-protocol`.

## Запуск

```bash
# терминал 1 — API на http://127.0.0.1:6108
cargo run -p silent-example-ui-server

# терминал 2 — SPA на http://127.0.0.1:6107
pnpm --filter @ivlev-dev/silent-example-ui dev
```

Первый запуск после изменения пакетов фреймворка:

```bash
pnpm --filter @ivlev-dev/silent-ui build
pnpm --filter @ivlev-dev/silent-example-ui typecheck
```

Приложение импортирует `@ivlev-dev/silent-ui` из собранного `dist`: Vite-плагин Silent
трансформирует только файлы внутри корня приложения, а UI-пакет компилируется своей
сборкой. Поэтому после правок в `packages/ui` его нужно пересобрать.

## Маршруты

| Путь        | Экран     | Особенности                                      |
| ----------- | --------- | ------------------------------------------------ |
| `/`         | Dashboard | сводка и последние проекты                       |
| `/projects` | Проекты   | фильтры, сортировка, пагинация, CRUD             |
| `/team`     | Команда   | владельцы и теги из `/api/meta`                  |
| `/settings` | Настройки | тяжёлые контролы загружаются только на маршруте  |

- Неизвестный путь (`/missing`) перенаправляется на `/`.
- Старая hash-ссылка `/#/projects` перенаправляется на `/projects`.
- Фильтры проектов хранятся в query: `q`, `status`, `owner`, `tag`,
  `budgetMin`, `budgetMax`, `createdFrom`, `createdTo`, `page`, `pageSize`,
  `sort`, `order`. Deep link и кнопки назад/вперёд восстанавливают состояние.
- Активный пункт боковой и нижней навигации обновляется из состояния роутера.

## API и протокол

Фронтенд обращается только к `/api` на `http://127.0.0.1:6108`. Контракт —
бинарный [`silent-protocol`](../../crates/silent-protocol):

- `Content-Type: application/x-silent-protocol` для `POST /api/projects` и
  `PATCH /api/projects/{id}`, `Accept` — тот же тип для всех ответов;
- тела — сырые `encode(value)` без JSON-обёрток, ошибки — бинарный
  `ApiError { code: string, message: string }` с исходным статусом;
- `DELETE` возвращает `204` без тела, `POST /api/uploads` — `multipart/form-data`;
- лимит протокольного тела — 2 MiB (`413 payload_too_large`), файла — 20 MiB.

Схемы объявлены в `src/api/types.ts` (`Project`, `ProjectPage`,
`ProjectMeta`, `ProjectInput`, `ProjectPatch`, `UploadResult`, `ApiErrorBody`,
`Health`), клиент — в `src/api/client.ts`. Общие бинарные векторы с Rust-сервером
лежат в `protocol-vectors/` и проверяются `tests/protocol-vector.test.ts`:
TS декодирует байты Rust, кодирует обратно и сверяет hex.

Полный HTTP-контракт — [`server/README.md`](./server/README.md) и
[`docs/api/protocol-http.md`](../../docs/api/protocol-http.md), спецификация
формата — [`docs/protocol.md`](../../docs/protocol.md).

## Структура

```text
src/
  app/
    data.ts            # общий ресурс /api/meta
    theme.ts           # тема и плотность
    router/            # Router, типизированные маршруты и query
    layout/            # оболочка: rail, top bar, bottom nav, snackbar
  features/
    dashboard/         # страница и карточка метрики
    projects/          # страница, формы фильтров и проекта
    team/
    settings/
  api/                 # протокольный клиент (не менять контракт)
  lib/                 # форматирование
  ui/                  # локальные общие UI-хелперы
```

Страницы загружаются динамическим `import()` в `Route.load()`. Общие зависимости
вынесены в `vendor-core`, `vendor-ui`, `vendor-form`, `vendor-protocol` и
`vendor-router` через `build.rollupOptions.output.manualChunks`.

## Бюджет бандла

```bash
pnpm --filter @ivlev-dev/silent-example-ui build   # сборка + проверка бюджета
pnpm --filter @ivlev-dev/silent-example-ui budget  # только проверка
```

`scripts/bundle-budget.mjs` читает `dist/index.html`, суммирует gzip стартовых
`modulepreload`-чанков и проверяет маршрутные/vendor-чанки:

- начальный JS — до 80 kB gzip;
- каждый `*-page-*.js` — до 40 kB gzip;
- каждый `vendor-*.js` — до 40 kB gzip.

Лимиты можно переопределить переменными `BUNDLE_INITIAL_KB`, `BUNDLE_ROUTE_KB`,
`BUNDLE_VENDOR_KB`.

Текущие значения (Vite 8, production):

```text
initial JS            66.96 kB gzip
dashboard-page         2.89 kB gzip
projects-page         35.86 kB gzip
settings-page         27.90 kB gzip
team-page              1.69 kB gzip
vendor-core           35.21 kB gzip
vendor-form           22.45 kB gzip
vendor-ui             16.62 kB gzip
vendor-protocol       11.18 kB gzip
vendor-router          8.17 kB gzip
```

Метрики на локальном preview (1440×900): LCP 144–160 ms, CLS 0, TBT 0 при
загрузке, 50–58 ms после перехода в проекты; INP 112–120 ms; `silent:mounted`
77–79 ms, `silent:route-ready` 127–130 ms.

```bash
pnpm --filter @ivlev-dev/silent-example-ui perf
```

## Проверки

```bash
pnpm --filter @ivlev-dev/silent-example-ui typecheck
pnpm --filter @ivlev-dev/silent-example-ui test
pnpm --filter @ivlev-dev/silent-example-ui test:e2e
```

E2E запускает Vite на случайном порту и Chromium, проверяет все маршруты, deep link,
query-фильтры, back/forward, legacy hash, 404 и отсутствие console errors. Скриншоты
360/840/1440/1920 сохраняются в `screenshots/`.

## SPA fallback для продакшена

Vite dev и `vite preview` уже отдают `index.html` для любого пути. Для статического
хостинга нужен fallback на `index.html`, иначе прямой переход на `/projects` даст 404.

Nginx (`deploy/nginx.conf`):

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
location /api/ {
  proxy_pass http://127.0.0.1:6108;
}
```

Caddy (`deploy/Caddyfile`):

```caddyfile
try_files {path} /index.html
file_server
reverse_proxy /api/* 127.0.0.1:6108
```

Для backend-раздачи статики достаточно на любой неизвестный GET без расширения
возвращать `index.html` (кроме `/api/*`).
