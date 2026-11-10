# API Silent Framework

Справочник публичного API по пакетам. Документ описывает сигнатуры, опции, семантику и ограничения каждого экспорта.

## Уровни стабильности

- `public` — часть публичного контракта, изменения только с предупреждением и по semver.
- `internal` — экспорт доступен технически, но может меняться без предупреждения.

## Пакеты

| Пакет | Файл | Что описывает |
| --- | --- | --- |
| `@ivlev-dev/silent-reactivity` | [reactivity.md](./reactivity.md) | сигналы, мемо, эффекты, глубокие прокси, store |
| `@ivlev-dev/silent-di` | [di.md](./di.md) | асинхронный контейнер зависимостей |
| `@ivlev-dev/silent-core` | [core.md](./core.md) | декораторы, ViewModel, компоненты, JSX runtime, HMR, Suspense, hydration |
| `@ivlev-dev/silent-server` | [core.md](./core.md#ssr) | `renderToString` и серверный мини-DOM |
| `@ivlev-dev/silent-swc` | [swc.md](./swc.md) | нативный Node-API addon |
| `@ivlev-dev/silent-vite` | [vite.md](./vite.md) | Vite-плагин и его опции |
| `@ivlev-dev/silent` | [getting-started.md](../getting-started.md) | метапакет: рантайм и плагин одной установкой |

## Гайды

- [С чего начать](../getting-started.md)
- [SSR и деплой](../guides/ssr.md)
- [Гидрация](../guides/hydration.md)
- [Dependency Injection](../guides/di.md)
- [Миграция с SolidJS](../guides/migration-from-solid.md)

## Соглашения

- Каждый экспортируемый символ пакета упоминается в файле пакета в обратных кавычках: `` `createSignal` ``.
- Символ описывается заголовком `### `name`` или `#### `name``; заголовок должен соответствовать реальному экспорту.
- Примеры кода компилируются и проверяются типами в тестах пакета; в примерах не используются внутренние API.
- Полнота документации проверяется командой `pnpm api:check`: скрипт читает `dist/*.d.ts` пакетов и падает, если экспорт не упомянут или заголовок ссылается на несуществующий символ.
- Устаревшие символы помечаются `Устарело:` и версией, в которой появилась замена.
