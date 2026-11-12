# Changelog

## Не выпущено

Гидрация без материализации дерева, возврат стартового JS к 25.6 KB, честные бенчмарки и надёжность.

### Производительность

- Гидрация: дескриптор адоптации, текстовые дыры без регионов, кэш состояний регионов, ленивые owner/эффекты, массивы зависимостей вместо `Set`/`Map`, пробные проходы зависимостей (статические выражения не создают подписок), ленивые узлы `For`. Chromium 8 746 → 15 300–22 100 ops/s, p50 0.205 → 0.035–0.060 мс; jsdom 1 368 → 1 990 ops/s на ручном приложении и 715 на скомпилированном.
- Размер: probe-код вынесен в гидрационный чанк, `__SILENT_SERVER__: false` в production-клиенте вырезает `insertServer`/`serializeServerValue`, при `view: false` отключается полифилл `modulepreload`. Стартовый JS 28.1 → **25.4–25.6 KB** (9.5 → 8.6 KB gzip).
- Нативный компилятор: проверен `lto = "fat"`; оставлен `thin` (fat: +64% времени сборки, −3.9% размера).
- SSR: серверный `For` собирает список синхронно, без owner/эффектов на элемент; `insertServer` не создаёт эффект для статических значений; `For` рендерит в строковый `RawNode` через `ServerBackend.createFragment`. `renderToString` 21 400 → 71 000–78 000 ops/s, соотношение к Solid 0.17 → 0.60.
- SSR: динамические атрибуты (`attr`/`prop`/`style`/`spread`) рендерятся строкой через `RawAttr` без мини-DOM; значения дописываются после статических атрибутов с сохранением маркеров `data-silent-a-*`, `textarea`/`title` получают `value`/`textContent` как экранированный текст.
- SSR: компилятор в режиме `ssr: true` (включается Vite-плагином для SSR-сборок и `vite.ssrLoadModule`) генерирует строковую сборку без `templateHoles`/`insert` и мини-DOM: статические части шаблона выносятся в модульную константу, значения — в массив, `_$ssr` экранирует и оборачивает нестроковые значения регионами вставки. Маркеры `silent-hole-*`/`data-silent-a-*` и разметка совпадают с шаблонным путём байт-в-байт, гидрация не меняется; для динамических атрибутов, `style`/spread, `dangerouslySetInnerHTML`, RCDATA-значений и metadata-тегов — откат на `templateHoles`. `renderToString` 45 000–110 000 ops/s, отношение к Solid 0.71–0.88.
- SSR: статические шаблоны, `Show`/`Switch`/`Index`/`ErrorBoundary` и серверный `For` больше не создают мини-DOM узлы и эффекты; `For`/`Index` не заводят замыкание индекса на элемент и переиспользуют строки маркеров, списки детей мини-DOM-узлов и восстановление глобалов стали дешевле. Разметка собирается конкатенацией строк в `RawNode.render`, вложенные узлы вставляются одной строкой. Отношение к Solid в A/B: 0.60 → 0.70–0.76, `renderToString` 100 000–104 000 ops/s.

### Бенчмарки

- SSR и гидрация измеряют скомпилированные приложения (`bench/fixtures/silent-app.tsx`), а не ручные вызовы `templateHoles`/`insert`.
- Добавлены размер SSR-разметки (байты/gzip) и расход памяти (heap на гидрацию в jsdom и Chromium).
- Все наборы ограничены четырьмя CPU (`scripts/bench-cpus.mjs`).
- `pnpm bench:guard` сравнивает результаты с `scripts/bench-baseline.json` и падает при регрессе размера/сборки/соотношения; шаги добавлены в CI.

### Надёжность

- Golden-тесты SSR-разметки (9 сценариев), обновление через `SILENT_UPDATE_GOLDEN=1`.
- Fuzz-тесты гидрации: 150 повреждений разметки с проверкой отката и чистоты DOM.
- Снимок публичного API (`scripts/api-snapshot.json`).
- `pack-check` проверяет отсутствие `bench/`/`crates/`/тестов в npm-пакетах.

## 0.6.2

Оптимизация SSR, гидрации и скорости сборки без изменения публичного API.

### Производительность

- `renderToString`: общий буфер сериализации, `RawNode.renderInto`, ленивая запись значений в слоты без промежуточных строк и массивов, быстрый путь `createComponent` для metadata-free узлов, флаг metadata-free вместо `WeakSet`, отказ от пересоздания DOM-глобалов на каждый рендер (`keepShape`). 35 497 → 99 900 ops/s (+181%), разрыв с Solid сокращён с ~5× до ~2×.
- Гидрация: plan-based adoption для шаблонов без метаданных, курсорный `shapeMatches`, отказ от `cloneNode(true)`, кэш планов. 677 → 1 368 ops/s (+102%); в сравнении с Solid — 0.61×.
- `For`/`Index` и реактивность: сохранены ускорения предыдущего релиза.

### Сборка

- Warm `pnpm build`: 2.2 s → 0.46 s. `scripts/build-native.mjs` пропускает `napi build`, если Rust-артефакты свежие; `--force` — для принудительной сборки.
- Vite-плагин кэширует JSON опций и загрузку SWC.
- Инкрементальная компиляция TypeScript в пакетах.

### Компилятор

- Статические JSX-шаблоны выносятся в модульные `const _tmpl$N = _$templateHoles(...)` и дедуплицируются в пределах модуля.
- `template`/`templateHoles` стали ленивыми: backend выбирается при вызове фабрики, поэтому хойстинг безопасен для SSR.
- Исправлена гидрация текста, переданного геттером сигнала (`{count}`): начальный эффект теперь разрешает функцию и подписывается на сигнал.

### Бандл

- Стартовый JS mount-only приложения: 35.7 → 26.4 KB min (12.25 → 9.5 KB gzip). View/VM/DI-рантайм вынесен в lazy-чанк `component-view` (8.98 KB / 3.66 KB gzip) и загружается только при наличии ViewModel.
- Новая опция Vite-плагина `view: false` для приложений без ViewModel: стартовый JS 23.2 KB / 8.3 KB gzip, без lazy-чанка и `vite/preload-helper`.
- `hydrate` вынесен из `mount`; структурная гидрация, DOM-гидрация (`settleNodes`/`writeRegion`/`insertHydrated`) и server-only код вынесены из стартового графа за реестры, `component-lite` не тянет DI, registry, boundary. Тяжёлый гидрационный рантайм грузится из `hydrate()` динамическим `import()`.
- `pnpm bench:build` теперь отдельно показывает `start JS`, `start gzip` и `all JS` для обоих режимов.

### Бенчмарки

- `pnpm bench:build`: одинаковые приложения Silent и Solid. Silent `view: false` — 56/27 ms и 23.2 KB стартового JS; Silent с VM — 32/26 ms, 26.4 KB стартового JS и 38.8 KB с lazy-чанком; Solid — 147/40 ms и 12.6 KB.
- `pnpm bench:hydrate`: Silent 1 368 ops/s против Solid 2 249 ops/s в jsdom.
- `pnpm bench:browser`: в Chromium Silent 8 746 ops/s против Solid 27 372; узлы переиспользуются, обработчики подключаются. Числа плавают ±10%.
- `pnpm bench:ssr`: Silent 99 900 против Solid 206 300 ops/s.

### Прочее

- AVX2, LTO и аллокатор не менялись: LTO уже `thin`, mimalloc отсутствует (`allocator_node` удалён ранее).
- Dev-зависимости для Solid-бенчмарков добавлены только в приватный `bench`, в публикуемые пакеты не попадают.
- Версия `0.6.2` — патч: перф и внутренний рефакторинг без изменения публичного API.

## 0.6.1

Рефакторинг и оптимизация без изменения публичного API.

### Производительность

- Реактивность: прямой обход наблюдателей без `Array.from`, меньше промежуточных объектов на запуск эффекта. `signal: 10k writes` 294 → 368 ops/s, batched writes 3 735 → 7 646, memo chain 151 → 196, `effect → textContent` 164 → 183, deep reactive 119 → 132.
- `For`/`Index`: быстрые пути реконсиляции, один `DocumentFragment` на пачку, переиспользуемые typed-array буферы, ленивые сигналы элемента. keyed list: create 43 → 65 ops/s, append 507 → 965, reorder 350 → 1 358.
- DOM: кэш разбора шаблонов, план частей для `templateHoles`, кэши `hyphen` и событий, меньше аллокаций в стилях и атрибутах.
- SSR: общий LRU-кэш разобранных шаблонов между рендерами, одно-проходное экранирование, `RawNode` без строковых цепочек, переиспользование документа и бэкенда. `renderToString` 30 720 → 35 497 ops/s, гидрация 497 → 677.

### Сборка

- Убраны неиспользуемые фичи `swc_core`, из графа зависимостей ушли `swc_malloc`/mimalloc, `swc_nodejs_common`, `swc_ecma_quote_macros`: чистая release-сборка 136.7 s → 104.4 s (−23.6%).
- Инкрементальная компиляция TypeScript в пакетах.
- Vite-плагин кэширует JSON опций и загрузку SWC.

### Версионирование

- `pnpm version:bump patch|minor|major`, `--set X.Y.Z` и `--dry-run`: синхронно обновляет 7 `package.json`, `Cargo.toml` и заголовок `CHANGELOG.md`.
- `pnpm version:check` и `scripts/verify-versions.mjs` в release CI проверяют совпадение версий и тега.
- `docs/releasing.md`: правила semver и процесс релиза. Патч-версия обязательна для исправлений, производительности и внутреннего рефакторинга.

## 0.6.0

### Производительность

- Строковый SSR-бэкенд: для шаблонов без динамических атрибутов (`data-silent-a-*`) и метаданных `templateHoles` создаёт `RawNode`, а `insert` записывает готовые строки в слоты; для остальных случаев остаётся мини-DOM.
- Кэш разбора серверных шаблонов на время `renderToString`.
- `renderToString` на 20 элементах: 13 500 → 34 000 ops/s (2.5x от начала оптимизаций).
- Гидрация и e2e на реальном приложении — без изменений.

## 0.5.0

### Производительность

- SSR: `installDomGlobals` кэширует дескрипторы глобалов, сериализатор не делает лишних `replace`/`join`, из `renderToString` убраны фиксированные микротаски (`hasPendingWork`). `renderToString` на 20 элементах: 13 500 → 21 500 ops/s.
- `ComponentContext.signal` создаётся лениво: VM без чтения `signal` не платит за `AbortController` (`createComponent` с VM: 20 → 10 µs).
- `For` вставляет новые строки одним `DocumentFragment`, `disposeOwnerChildren` не копирует `Set` в массив.
- Шаблоны без метаданных помечаются и пропускают обход в `extractMetadata`.
- SPA-бенчмарк: примитивы 1.04–1.37x от Solid, перестановки списка 0.82x.

## 0.4.0

### Качество

- `cargo clippy -D warnings` в CI; исправлены 7 замечаний в `silent-transform` (мёртвый параметр, лишние `Ok/?`, `clone` для `Copy`, `Box::new` при замене).
- Бенчмарк `pnpm bench:ssr`: SSR против Solid и гидрация Silent.
- Скрипт `pnpm deprecate:legacy` для пометки старых `@ivlev98/silent-*` (нужен `NPM_TOKEN`).

## 0.3.0

### Документация

- `docs/getting-started.md` — создание проекта, первый ViewModel и view, жизненный цикл, control flow, SSR.
- Гайды: `docs/guides/ssr.md`, `docs/guides/hydration.md`, `docs/guides/di.md`, `docs/guides/migration-from-solid.md`.

### Примеры

- `examples/ssr-counter` — SSR с реальным HTTP-сервером: dev-режим через middleware Vite и продакшен-режим со статикой.

### Пакеты

- Метапакет `@ivlev-dev/silent`: рантайм и Vite-плагин одной установкой.
- Проверка наличия README в tarball метапакета; `install:check` и `pack:check` покрывают новый пакет.

### Компилятор

- Исправлено: маркеры `data-silent-a-N` у RCDATA-элементов (`title`, `textarea`) больше не попадают в текст, а остаются в открывающем теге.

## 0.2.0

### Управляющие конструкции

- `Index` — неключевой список: узлы закреплены за позициями, меняется только содержимое.
- `Switch` / `Match` — выбор первой правдивой ветки с `fallback`.
- `ErrorBoundary` — перехват синхронных ошибок рендера и асинхронных ошибок дочерних view; `fallback(error, reset)`.
- Гидрация `Index`, `Switch` и `ErrorBoundary` с адоптацией серверных узлов.

### Метаданные

- `<meta>` и `<link>` из любого компонента выносятся в `<head>` вместе с `<title>`; элементы с `itemprop` и содержимое `<svg>` не трогаются.

### SSR

- `renderToStream` отдаёт тело чанками (`chunkSize`), `head` приходит в `onHead` до первого чанка.

## 0.1.2

- Подробные русскоязычные README в каждом пакете: возможности, установка, быстрый старт, API и ограничения.
- Проверка наличия `README.md` в tarball'ах (`pnpm pack:check`).

## 0.1.1

- Пакеты перенесены в scope `@ivlev-dev`: `@ivlev-dev/silent-reactivity`, `@ivlev-dev/silent-di`, `@ivlev-dev/silent-core`, `@ivlev-dev/silent-swc`, `@ivlev-dev/silent-vite`, `@ivlev-dev/silent-server`.
- Пакеты `@ivlev98/silent-*` объявлены устаревшими.

## 0.1.0

Первый публичный релиз Silent Framework.

### Реактивность (`@ivlev-dev/silent-reactivity`)

- Сигналы, мемо, эффекты, `createRoot`, `onCleanup`, `batch`, `flushSync`.
- Глубокие прокси для объектов и массивов: отдельный сигнал на каждое свойство/индекс, мутирующие методы массивов.
- Store-примитивы для `@reactive`-полей: `readField`, `writeField`, `getComputed`, `copyReactiveState`.

### Dependency Injection (`@ivlev-dev/silent-di`)

- Асинхронный контейнер без декораторов: `bind`, `createScope`, `resolve`, `peek`, `has`, `dispose`.
- Интерфейсы и автопоиск реализаций через индекс, кеш промисов, обнаружение циклов, `CircularDependencyError`.

### Ядро (`@ivlev-dev/silent-core`)

- MVVM: view получает ViewModel через `this`, `import type` для VM и прелоадера.
- Stage-3 декораторы `@reactive`, `@computed`, `@watch`, класс `ViewModel` с доступом к `props`/`view` и lifecycle-хуками.
- `mount`, прелоадеры, обработка ошибок, наследование DI-скоупа.
- `For`, `Show`, `Suspense`, `lazy`, `fragment`.
- Гидрация серверной разметки с сохранением узлов (`hydrate`), `HydrationMismatchError`, `onMismatch`.
- Вынос `<title>` в `<head>` из любого компонента (как в React 19), исключения `<svg>`/`itemProp`.
- HMR с сохранением состояния ViewModel.

### SSR (`@ivlev-dev/silent-server`)

- `renderToString` с собственным мини-DOM: парсер шаблонов компилятора, `Document`, `TreeWalker`, сериализатор, отражение `style`/`value`, no-op события.
- Асинхронные ViewModel, `Suspense` и `lazy` дожидаются до сериализации.
- `RenderResult.head` с метаданными (`<title>`), серверные маркеры для гидрации.

### Компилятор (`@ivlev-dev/silent-swc`)

- Нативный addon на `swc_core` с `lto = "thin"`.
- Компиляция JSX в шаблоны, метаданные view, DI-фабрики из конструкторов, RCDATA-элементы (`textarea`/`title`) без комментариев-хуков.
- `transform`, `scan`, `version`.

### Vite (`@ivlev-dev/silent-vite`)

- Полная компиляция TS/TSX через SWC, source maps, HMR, индекс DI.
- Дефолтные настройки: `target: es2024`, полный HMR.

### Неймспейс

- Пакеты публикуются под scope `@ivlev98`: `@ivlev98/silent-reactivity`, `@ivlev98/silent-di`, `@ivlev98/silent-core`, `@ivlev98/silent-swc`, `@ivlev98/silent-vite`, `@ivlev98/silent-server`.

### Документация и качество

- Справочник API по пакетам (`docs/api/`) с автопроверкой полноты (`pnpm api:check`).
- Архитектурные контракты, гайд по SSR и гидрации.
- Бенчмарк против SolidJS (`pnpm bench`) и сквозные проверки SSR/гидрации.
- Пакеты публикуются как ESM с явными `.js`-расширениями и загружаются в чистом Node.
