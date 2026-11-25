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
| `@ivlev-dev/silent-router` | [router.md](./router.md) | router: route-классы, `Link`, `RouterView`, guards/loaders, SSR |
| `@ivlev-dev/silent-server` | [core.md](./core.md#ssr) | `renderToString` и серверный мини-DOM |
| `@ivlev-dev/silent-server/pool` | [server-pool.md](./server-pool.md) | worker pool: параллельный unary- и streaming-рендер |
| `@ivlev-dev/silent-swc` | [swc.md](./swc.md) | нативный Node-API addon |
| `@ivlev-dev/silent-vite` | [vite.md](./vite.md) | Vite-плагин и его опции |
| `@ivlev-dev/silent-validation` | [validation.md](./validation.md) | классовая валидация: декораторы, схемы из TS-типов, i18n |
| `@ivlev-dev/silent-validation-vite` | [validation-vite.md](./validation-vite.md) | Vite-плагин генерации схем валидации |
| `@ivlev-dev/silent-form` | [form.md](./form.md) | реактивные формы: `@Field`, метаданные полей, вложенные формы, серверные ошибки |
| `@ivlev-dev/silent-virtual` | [virtual.md](./virtual.md) | headless-виртуализация: диапазоны, раскладка по линиям, SSR-срезы |
| `@ivlev-dev/silent-dnd` | [dnd.md](./dnd.md) | headless drag-and-drop: контекст, сенсоры, коллизии, модификаторы, сортировка |
| `@ivlev-dev/silent-ui` | [ui.md](./ui.md) | дизайн-система: токены, темы, layout, типографика, компоненты, формы, иконки |
| `@ivlev-dev/silent-protocol` | [protocol.md](./protocol.md) | бинарный протокол: схема из класса, encode/decode, oneof |
| `@ivlev-dev/silent-protocol-vite` | [protocol-vite.md](./protocol-vite.md) | Vite-плагин схем и статических кодеков |
| `@ivlev-dev/silent` | [getting-started.md](../getting-started.md) | метапакет: рантайм и плагин одной установкой |

## Гайды

- [С чего начать](../getting-started.md)
- [SSR и деплой](../guides/ssr.md)
- [Worker pool для SSR](../guides/ssr-pool.md)
- [Гидрация](../guides/hydration.md)
- [Dependency Injection](../guides/di.md)
- [Роутер](../guides/router.md)
- [Формы (валидация и поля)](../guides/forms.md)
- [UI и дизайн-система](../guides/ui.md)
- [Миграция с SolidJS](../guides/migration-from-solid.md)

## Соглашения

- Каждый экспортируемый символ пакета упоминается в файле пакета в обратных кавычках: `` `createSignal` ``.
- Символ описывается заголовком `### `name`` или `#### `name``; заголовок должен соответствовать реальному экспорту.
- Примеры кода из `form.md` компилируются и проверяются типами файлом `packages/form/tests/docs-types.ts`: он попадает в `tsconfig.typecheck.json` пакета, поэтому расхождение с публичным API ломает `pnpm typecheck` (как тест файл не запускается).
- Для остальных файлов автоматической проверки примеров нет: `core.md`, `reactivity.md`, `di.md`, `router.md`, `server-pool.md`, `validation.md`, `validation-vite.md`, `vite.md`, `swc.md`. Их примеры сверяются с кодом вручную при изменении API; в примерах используются только публичные экспорты (внутренний сабпуть `runtime-context-provider` упоминается лишь в описании контракта).
- Полнота документации проверяется командой `pnpm api:check`: скрипт читает `dist/*.d.ts` пакетов и падает, если экспорт не упомянут или заголовок ссылается на несуществующий символ.
- Устаревшие символы помечаются `Устарело:` и версией, в которой появилась замена.

## Снимок сигнатур API

Полные сигнатуры публичных экспортов снимаются через TypeScript checker и хранятся в `scripts/api-signatures.json`. Обычный `pnpm api:check` сверяет и имена (`scripts/api-snapshot.json`), и сигнатуры.

- `pnpm api:signatures` (или `pnpm api:check -- --snapshot-signatures`) — пересобрать снимок сигнатур после осознанного изменения API.
- `pnpm api:snapshot` (или `pnpm api:check -- --snapshot`) — пересобрать снимок имён.
- `pnpm api:check:self` — self-check детерминизма: два независимых прогона должны дать побайтово одинаковый JSON.

Формат записи: `kind` (`function`, `class`, `interface`, `type`, `variable`, `enum`, ...), для функций и переменных — вычисленный `type` (`checker.typeToString`), и `signature` — нормализованный текст объявления из `.d.ts`. Порядок пакетов и экспортов детерминирован, абсолютные пути и спецификаторы `import("...")` в типах нормализуются, `private`/`protected`-члены классов и `#private` исключаются.

Что не попадает в снимок: JSDoc-комментарии и markdown-документация, тела функций, приватные члены классов, неэкспортируемые объявления, `default`-экспорт (проверка имён исторически его пропускает), а также реэкспорты из других пакетов, объявленные вне корня пакета: они отфильтровываются так же, как в проверке имён.
