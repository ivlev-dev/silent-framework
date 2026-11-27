# Статус проекта — 27.11.2026

Работа приостановлена для фиксации состояния. Ниже — что сделано, что проверено и что осталось.
Актуальные задачи и приоритеты: [`TODO.md`](./TODO.md).

## Кратко

| Направление | Состояние | Проверки |
| --- | --- | --- |
| `@ivlev-dev/silent-ui` | почти готово, идёт доводка DataTable | 925 тестов, typecheck/build |
| SPA-пример `examples/ui` | работает: History API, silent-protocol, оптимизация | typecheck/build, e2e, бюджет 56 kB gzip |
| `examples/ui/server` | полностью на silent-protocol, redb | 71 тест, clippy |
| `ui-rust` | база/перф/hover/таблица/протокол, нужна финальная проверка | workspace-тесты зелёные |
| `kotlin-ui` | hover/damage, DataTable, галерея, протокол; нужна проверка селектов | `core/desktop/android` — BUILD SUCCESSFUL |
| Storybook/доки | частично: DataTable-сценарии не дописаны | build/test проходят |
| CSS-архитектура | откат незавершённого сплита | — |

## Web

### SPA-пример `examples/ui`

- **History API** (`@ivlev-dev/silent-router`): `/`, `/projects`, `/team`, `/settings`, deep links, back/forward, `/#/projects` → `/projects`, 404 → `/`. Фильтры и страница — в query.
- **silent-protocol**: backend и клиент без JSON; `application/x-silent-protocol`, бинарные ошибки, upload, redb.
- **Бандл**: route-level lazy + manualChunks; initial JS **56.29 kB gzip** (было ~130), route-чанки ≤ 27.6 kB; бюджет в `scripts/bundle-budget.mjs`.
- **Перф** (последний замер): LCP ~144–160 ms, TBT 0 ms, INP ~112–120 ms, CLS 0.
- **Структура**: `src/app/{router,layout,data,theme}`, `src/features/{dashboard,projects,team,settings}`.
- **Тёмная тема**: soft charcoal `#17181B → #333439`, тёплый нейтральный акцент.
- **Настройки**: панель «Готовность формы» по React-эталону (`FormReadinessCard`), белый фон, клик → скролл/фокус поля.
- **Карточки**: явная рамка + мягкая тень; поповеры (Color/Date/Tree/Select) не обрезаются.
- **Кнопки**: исправлено мигание при уходе курсора (state layer через opacity, без смены background на `currentColor`).
- Исправлено зависание страниц: в `component-lite` рендер обёрнут в `untrack` (иначе insert-эффект зацикливался).

### `packages/ui`

- **DataTable**: drag за весь заголовок (сам `th`, без клона), resize без скачка (порог/commit/показ ширины), FLIP, настройки (видимость/порядок/locked/плотность/sticky/layout), cards, tree, bulk, квадратные углы, density override, пагинация в футере, bulk-панель поверх футера, sticky footer.
- **Pagination**: реактивная активная страница (accessor + тест).
- **Даты**: круглые дни, диапазон без квадратов, видимый текст выбранных.
- **ColorPicker**: регистронезависимый hex 3/4/6/8, swatch поверх checkerboard.
- **Dialog**: `close()` выводит из top layer даже если атрибут `open` уже снят (иначе страница оставалась inert).
- **Контролы**: единые высоты 32/40/48, `TagInput`/`NumberField`/`Select`/`TreeSelect`.
- **Навигация**: `selected` реактивен (rail/bar), `aria-current` обновляется.

### Storybook/доки

- 36 тестов Storybook, build проходит; новые stories для DataTable/даты/цвета.
- `docs/api/ui.md`, `docs/guides/ui.md` обновлены; `api:check` — 0 недокументированных.
- Не дописаны сценарии DataTable (виртуализация/scroll/drop-only), агент остановлен.

## silent-protocol

- HTTP-контракт: все эндпоинты и ошибки — `application/x-silent-protocol`; лимиты 2 MiB → 413, битый payload → 400.
- redb: значения в протоколе, маркер формата, миграция старых БД в `.legacy`.
- 12 кросс-языковых векторов Rust↔TS, 8 Rust + 19 TS тестов.
- 71 тест сервера, clippy чистый.
- `GET /api/projects/{id}` не реализован (не нужен клиенту).

## Rust UI (`ui-rust`)

- Damage-регионы, объединение, частичная перерисовка; idle-skip (0 кадров в простое).
- Кэш текста/layout; исправлена паника кэша при ресайзе.
- Resize: коалесценция, `Mailbox/Immediate`, event→present ~2–3 ms (Wayland, 4K).
- Hover: hit-test, damage только региона, курсоры pointer/text/grab/col-resize.
- Скролл: направление исправлено, плавность, sticky; показ scrollbar.
- Таблица: строки 56/48, header 48, белый фон, sticky, bulk, пагинация, drag/drop-only, виртуализация (по агентскому отчёту — требует визуальной проверки).
- Отдельная страница `Проекты` + данные с backend по silent-protocol (`SILENT_API_URL`).
- Тема soft black, hairline/скругления, switch.
- Тесты: `cargo test --workspace` зелёный (snapshot-ожидания обновлены под 56/48 и ширину 1660).
- Запуск: Wayland, `env -u DISPLAY WINIT_UNIX_BACKEND=wayland ./target/release/ui-demo`.
- **Не проверено вживую после последних правок**: страница Projects с сервером, галерея в release-CLI, финальные скриншоты.

## Kotlin UI (`kotlin-ui`)

- Hover через `MouseMotionListener`, hover-path, damage старого/нового региона; idle 0% CPU.
- DataTable: 56/48, пагинация, bulk, sticky, drag/resize, density, углы.
- Dashboard 1:1 с web (6 метрик, статусы, команда/теги, последние проекты), иконки, rail 260, данные совпадают.
- Галерея компонентов; Android-скриншоты.
- protocol + API: `HttpURLConnection`, декод Kotlin-кодеком, fallback; страница Projects.
- `PopupController` для Select/TreeSelect/Combobox.
- `gradle :core:test :desktop:test :android:assembleDebug` — BUILD SUCCESSFUL.
- **Не проверено вживую**: открытие Select/TreeSelect после последних правок, полный прогон тестов после них.

## Известные проблемы

1. DataTable: не завершены всегда-включённая виртуализация (один код-путь для 0/1/10/10k строк), внутренний скролл с передачей наружу, drop-only reorder, tree-DnD, inline-edit — часть в работе была остановлена.
2. CSS-сплит: 61 файл получил импорты `#sui-css/...` без конфигурации; импорты удалены, архитектура осталась прежней (агрегат `styles.css`).
3. Storybook: сценарии DataTable не дописаны до конца.
4. Rust: Projects/галерея требуют ручной проверки в Wayland.
5. Kotlin: Select/TreeSelect требуют проверки и, возможно, доводки позиционирования.
6. `examples/ui` использует `packages/ui/dist` — после правок пакета нужен rebuild (dev-алиасы на src убраны из-за реактивности).

## Как продолжить

```bash
# web
pnpm --filter @ivlev-dev/silent-ui build
pnpm --filter @ivlev-dev/silent-example-ui dev
cargo run -p silent-example-ui-server

# проверки
pnpm typecheck && pnpm test
pnpm --filter @ivlev-dev/silent-ui test
pnpm --filter @ivlev-dev/silent-example-ui test
cargo test -p silent-example-ui-server
cd ui-rust && cargo test --workspace
cd kotlin-ui && gradle :core:test :desktop:test :android:assembleDebug
```
