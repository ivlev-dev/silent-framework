# @ivlev-dev/silent-vite

Vite-плагин Silent Framework: компиляция TS/TSX/JS/JSX через нативный addon `@ivlev-dev/silent-swc`, автоматический индекс DI и HMR с сохранением состояния.

![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-vite)
![license](https://img.shields.io/npm/l/@ivlev-dev/silent-vite)
![vite](https://img.shields.io/badge/vite-%3E%3D8-blue)

## Возможности

- Компиляция TypeScript, TSX, JS и JSX нативным addon'ом на Rust + `swc_core` — быстрее, чем чисто JavaScript-транспиляторы.
- Compile-time DI: плагин сканирует проект и передаёт компилятору индекс интерфейсов и реализаций, конструкторы разрешаются без ручных `bind`.
- HMR из коробки: `import.meta.hot.accept` внедряется на этапе компиляции, состояние ViewModel и сигналов переживает правки.
- Source maps передаются в Vite как есть из addon'а.
- Тонкая настройка: опции SWC, шаблоны `include`/`exclude`, корень проекта, имя рантайм-модуля.
- Работает с `enforce: "pre"` — хуки выполняются раньше стандартных плагинов Vite.

## Установка

Плагин **не содержит рантайма**. Для работы приложения обязательно нужен пакет `@ivlev-dev/silent-core` — он устанавливается в `dependencies` и тянет за собой `@ivlev-dev/silent-di` и `@ivlev-dev/silent-reactivity`. Сам плагин и `vite` идут в `devDependencies`.

Установки только `@ivlev-dev/silent-vite` недостаточно: без `@ivlev-dev/silent-core` приложение не соберётся и не запустится.

```bash
pnpm add @ivlev-dev/silent-core
pnpm add -D @ivlev-dev/silent-vite vite
```

## Быстрый старт

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
});
```

`tsconfig.json` — JSX компилируется рантаймом Silent Framework:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@ivlev-dev/silent-core"
  }
}
```

`index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Silent Framework</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx
import { mount } from "@ivlev-dev/silent-core";
import { App } from "./app";

void mount("#app", App, { props: { title: "Silent Framework" } });
```

`mount` возвращает `Promise<MountHandle>` с `ready` и `dispose()`. Для SSR используйте `hydrate` из `@ivlev-dev/silent-core` вместо `mount`.

## Опции

Все опции `silent(options?)` необязательны.

| Опция | Тип | По умолчанию | Описание |
| --- | --- | --- | --- |
| `include` | `RegExp` | `/\.(ts\|tsx\|mts\|cts\|js\|jsx\|mjs\|cjs)$/` | Файлы, подлежащие компиляции. |
| `exclude` | `RegExp` | `/node_modules/` | Файлы, исключаемые из компиляции. |
| `root` | `string` | `process.cwd()` | Корень проекта; файлы вне его не трансформируются. |
| `swc` | `Record<string, unknown>` | `{}` | Опции компилятора SWC, передаются в addon как есть. По умолчанию компиляция идёт с `target: "es2024"`; JSX всегда компилируется рантаймом Silent Framework. |
| `requirePreloader` | `boolean` | `false` | Требовать прелоадер на уровне view. |
| `runtime` | `string` | `"@ivlev-dev/silent-core"` | Имя рантайм-модуля для сгенерированного кода. |
| `hmr` | `boolean` | `true` | Внедрять HMR-код в компилируемые модули. |
| `index` | `boolean` | `true` | Строить индекс DI по файлам проекта. При `false` передаётся пустой индекс и scan не вызывается. |

Пример с нестандартными опциями:

```ts
silent({
  include: /\.(ts|tsx|js|jsx)$/,
  exclude: /node_modules/,
  swc: {
    jsc: { target: "es2020" },
  },
  hmr: true,
  index: true,
});
```

## Как это работает

Плагин работает с `enforce: "pre"`, поэтому его хуки выполняются раньше остальных.

1. **`buildStart`** — при `index: true` нативный addon сканирует `root` и строит индекс DI: `SilentIndex = { interfaces: Record<string, string[]>; values: Record<string, string[]> }`. Индекс сериализуется в JSON и кешируется в памяти.
2. **`transform`** — для каждого модуля id очищается от query и hash, пропускаются виртуальные модули (`\0…`, `virtual:…`), проверяются `include`, `exclude` и попадание в `root`. Затем вызывается `swc.transform(source, filename, optionsJson, indexJson)` addon'а `@ivlev-dev/silent-swc`, который компилирует TS/TSX в JavaScript, внедряет HMR (`import.meta.hot.accept`) и подставляет реализации интерфейсов из индекса при компиляции конструкторов.
3. **`watchChange` / `handleHotUpdate`** — при изменении исходного (не виртуального) модуля кеш индекса DI сбрасывается и перестраивается при следующем запросе.

- **Source maps**: addon возвращает `map: string | null`, плагин передаёт его в Vite без изменений.
- **Диагностики**: поле `diagnostics` addon'а возвращается Vite как warnings результата `transform`.
- **Режимы dev/prod**: плагин не ветвится по режиму — трансформация применяется всегда; HMR-код активен только в dev, где существует `import.meta.hot`.

## HMR

В dev-режиме компилятор по флагу `hmr` внедряет `import.meta.hot.accept` в компилируемые модули. Состояние переживает правки:

- **Изменение view (компонента)** — ViewModel и значения сигналов сохраняются; для каждого инстанса вызывается `rerender`.
- **Изменение модуля ViewModel** — создаётся новый экземпляр со переносом значений `@reactive`-полей; при наличии новой функции прелоадера обновляется и он.
- **Несовместимые изменения** — выполняется `import.meta.hot.invalidate()` и полная перезагрузка затронутого модуля.
- **Обновление рантайма фреймворка** — всегда полная перезагрузка.

Отладка:

- Реестр инстансов хранится на `globalThis` — инстансы VM можно осмотреть из консоли браузера.
- Ошибки addon'а приходят с префиксом `@ivlev-dev/silent-vite:` и именем файла; подробности SWC видны в `diagnostics`/`warnings` и stderr.
- Если при правке state сбрасывается — проверьте, менялись ли сигнатуры: migrations для VM не поддерживаются, логика `hmrUpdate`/`hmrInvalidate` переносит только совместимые структуры.

## Ограничения и совместимость

- Vite версии не ниже 8 (peer dependency), Node.js не ниже 22 (`engines`).
- Обрабатываются только файлы по шаблону `include` внутри `root`; `node_modules` исключены по умолчанию.
- Нативный addon `@ivlev-dev/silent-swc` — зависимость плагина; без собранного бинарника `loadSwc()` выбрасывает ошибку с подсказкой пересобрать его. При несовпадении ABI пересоберите addon.
- Виртуальные модули (`\0…`, `virtual:…`) пропускаются.
- Индекс DI строится один раз за запуск и инвалидируется при изменении исходных модулей; правки `vite.config.ts` требуют перезапуска dev-сервера.
- В SSR-сборке держите рантайм внешним (`ssr.external`), иначе приложение получит вторую копию рантайма и гидрация не дождётся компонентов:

```ts
export default defineConfig({
  plugins: [silent()],
  ssr: {
    external: ["@ivlev-dev/silent-core", "@ivlev-dev/silent-di", "@ivlev-dev/silent-reactivity", "@ivlev-dev/silent-server"],
  },
});
```

## Ссылки

- [Репозиторий silent-framework](https://github.com/ivlev-dev/silent-framework)
- [Документация API плагина](https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/vite.md)
- [CHANGELOG](https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md)
- [Issues](https://github.com/ivlev-dev/silent-framework/issues)

---

MIT © ivlev-dev
