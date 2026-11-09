# Changelog

## 0.1.0

Первый публичный релиз Silent Framework.

### Реактивность (`@ivlev98/silent-reactivity`)

- Сигналы, мемо, эффекты, `createRoot`, `onCleanup`, `batch`, `flushSync`.
- Глубокие прокси для объектов и массивов: отдельный сигнал на каждое свойство/индекс, мутирующие методы массивов.
- Store-примитивы для `@reactive`-полей: `readField`, `writeField`, `getComputed`, `copyReactiveState`.

### Dependency Injection (`@ivlev98/silent-di`)

- Асинхронный контейнер без декораторов: `bind`, `createScope`, `resolve`, `peek`, `has`, `dispose`.
- Интерфейсы и автопоиск реализаций через индекс, кеш промисов, обнаружение циклов, `CircularDependencyError`.

### Ядро (`@ivlev98/silent-core`)

- MVVM: view получает ViewModel через `this`, `import type` для VM и прелоадера.
- Stage-3 декораторы `@reactive`, `@computed`, `@watch`, класс `ViewModel` с доступом к `props`/`view` и lifecycle-хуками.
- `mount`, прелоадеры, обработка ошибок, наследование DI-скоупа.
- `For`, `Show`, `Suspense`, `lazy`, `fragment`.
- Гидрация серверной разметки с сохранением узлов (`hydrate`), `HydrationMismatchError`, `onMismatch`.
- Вынос `<title>` в `<head>` из любого компонента (как в React 19), исключения `<svg>`/`itemProp`.
- HMR с сохранением состояния ViewModel.

### SSR (`@ivlev98/silent-server`)

- `renderToString` с собственным мини-DOM: парсер шаблонов компилятора, `Document`, `TreeWalker`, сериализатор, отражение `style`/`value`, no-op события.
- Асинхронные ViewModel, `Suspense` и `lazy` дожидаются до сериализации.
- `RenderResult.head` с метаданными (`<title>`), серверные маркеры для гидрации.

### Компилятор (`@ivlev98/silent-swc`)

- Нативный addon на `swc_core` с `lto = "thin"`.
- Компиляция JSX в шаблоны, метаданные view, DI-фабрики из конструкторов, RCDATA-элементы (`textarea`/`title`) без комментариев-хуков.
- `transform`, `scan`, `version`.

### Vite (`@ivlev98/silent-vite`)

- Полная компиляция TS/TSX через SWC, source maps, HMR, индекс DI.
- Дефолтные настройки: `target: es2024`, полный HMR.

### Неймспейс

- Пакеты публикуются под scope `@ivlev98`: `@ivlev98/silent-reactivity`, `@ivlev98/silent-di`, `@ivlev98/silent-core`, `@ivlev98/silent-swc`, `@ivlev98/silent-vite`, `@ivlev98/silent-server`.

### Документация и качество

- Справочник API по пакетам (`docs/api/`) с автопроверкой полноты (`pnpm api:check`).
- Архитектурные контракты, гайд по SSR и гидрации.
- Бенчмарк против SolidJS (`pnpm bench`) и сквозные проверки SSR/гидрации.
- Пакеты публикуются как ESM с явными `.js`-расширениями и загружаются в чистом Node.
