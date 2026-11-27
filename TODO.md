# TODO

Статус на 27.11.2026. Работа приостановлена, ниже — очередь с приоритетами.
Контекст и проверки: [`docs/STATUS.md`](./STATUS.md).

## P0 — завершить начатое (сломано/недоделано)

### DataTable (`packages/ui`)

- [ ] Виртуализация строк (10k+): окно + overscan, sticky header/footer, selection/keyboard/tree.
- [ ] Скролл: по умолчанию внутренний; при достижении конца передаётся странице (chaining); внешний режим — опция; настройка сохраняется.
- [ ] DnD: перестановка колонок **только на drop**; drop-индикатор; один FLIP после drop; убрать остаточный дребезг в настройках; клавиатура.
- [ ] Смена страниц без скачков: стабильная высота тела/skeleton, сохранение позиции, без CLS.
- [ ] Пагинация: компактная, без переносов на 1440; проверить 360/840.
- [ ] Строки 56 / compact 48, header 48 — проверить на всех страницах; убрать hover-рамку, белый фон.
- [ ] Полный перенос из `shop-react-admin`: tree-DnD (before/inside/after, авто-раскрытие), inline-edit, экспорт, фильтры в тулбаре.
- [ ] Storybook: сценарии виртуализации, scroll chaining, drop-only, vendor view; обновить play-тесты.

### Kotlin UI

- [ ] Проверить и довести Select/TreeSelect/Combobox: открытие, позиционирование, поиск, клавиатура, multiple, каскад, фокус, клик вне.
- [ ] Пагинация 1:1 с web: компактность, активная страница, pageSize, статус.
- [ ] DataTable: виртуализация, внутренний скролл с chaining, drop-only reorder, настройки (locked/порядок/видимость), bulk overlay.
- [ ] Финальный прогон `core/desktop/android` тестов после последних правок и desktop-скриншоты Select/TreeSelect.

### Rust UI

- [ ] Проверить вживую на Wayland: страница `Проекты` (данные с `/api/projects`, `/api/meta`), пагинация, bulk, виртуализация, скролл chaining.
- [ ] Проверить `--screen gallery` в release-CLI, полноту компонентов.
- [ ] DnD drop-only + drop-индикатор; плавность; resize/hover без регрессий.
- [ ] Обновить README/скриншоты после финальной сборки.

### CSS-архитектура

- [ ] Спроектировать подключение CSS вместе с компонентами без `import "./x.css"` из JS (ограничение SSR): варианты — `imports` в `package.json` (`#sui-css/*`) + сборщик/резолвер, либо отдельные entrypoints.
- [ ] Реализовать в сборщике (`scripts/build.mjs`) и `package.json`; проверить SSR/Node, Vite, Storybook, размер и порядок слоёв.
- [ ] `styles.css` оставить агрегатом; не дублировать правила; тест синхронизации.
- [ ] Обновить `packages/ui/README.md` и `docs/guides/ui.md`.

## P1 — качество и паритет

- [ ] Web: аудит 9 брейкпоинтов (360…3840) light/dark, axe, скриншоты; устранить найденное.
- [ ] Пример: закрепить бюджеты (initial ≤ 60 kB gzip, LCP ≤ 120 ms, INP ≤ 100 ms, TBT ≤ 50 ms, CLS 0) в CI.
- [ ] Web: убрать оставшиеся workaround'ы, проверить `typecheck`/`test` на корне.
- [ ] Storybook: полный аудит компонентов после изменений (sticky/bulk/дата/цвет/карточки), `ui-check` на 9 viewport.
- [ ] Документация: `docs/api/ui.md` — новые props DataTable, Pagination, Card; `CHANGELOG` — Unreleased.
- [ ] Rust/Kotlin `PARITY.md`: актуализировать таблицы (компонент/виртуализация/DnD/анимации/отличия).
- [ ] Rust: perf-отчёт (idle/ввод/hover/скролл 10k, 1440/3840) + debug-overlay damage.
- [ ] Kotlin: Android ANR на холодном эмуляторе (software GPU) — проверить на устройстве; touch-скролл.

## P2 — развитие

- [ ] Rust: анимации (120–200 ms, reduced-motion), tree-DnD, inline-edit, тултипы/меню/поповеры вне clip.
- [ ] Kotlin: tree-DnD, анимации перестроения, фокус-трап и portal/floating для оверлеев.
- [ ] Rust/Kotlin: полный паритет RichTextEditor, NumberField, OTP, TagInput, DatePicker.
- [ ] Мобильные демо Rust (Android/iOS): GameActivity/NativeActivity, IME, touch/safe-area.
- [ ] Kotlin Android: сеть по silent-protocol на устройстве, кэш/offline.
- [ ] Единый e2e-пайплайн web + скриншот-диффы Rust/Kotlin.
- [ ] `GET /api/projects/{id}` (если понадобится контракту).

## Сделано (для контекста)

- [x] History API + deep links + фильтры в URL, SPA fallback (nginx/Caddy).
- [x] silent-protocol: сервер/клиент/redb/векторы/негативные тесты.
- [x] Бандл: route splitting, initial 56.29 kB gzip, бюджет.
- [x] Тёмная тема soft charcoal, контраст AA.
- [x] Настройки: панель готовности по React-эталону + скролл к полю.
- [x] Поповеры не обрезаются; карточки с рамкой/тенью; мигание кнопок исправлено.
- [x] Пагинация: активная страница; bulk поверх футера; sticky footer.
- [x] Rust: damage/idle, кэш текста (паника при resize исправлена), hover, resize 2–3 ms, таблица 56/48.
- [x] Kotlin: hover-path/damage, 0% idle, dashboard 1:1, DataTable, галерея, protocol/API.

## Блокеры/риски

- Параллельные агенты правили одни файлы; перед возобновлением — `git status`, прогнать тесты.
- `examples/ui` резолвит `@ivlev-dev/silent-ui` из `dist`: после правок пакета нужен `pnpm --filter @ivlev-dev/silent-ui build`.
- CSS-сплит нельзя делать импортом CSS из JS (Node-SSR ломается) — нужен отдельный механизм.
- На холодном Android-эмуляторе возможен ANR из-за software GPU (не воспроизводится на desktop/устройстве).
