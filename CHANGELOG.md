# Changelog

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
