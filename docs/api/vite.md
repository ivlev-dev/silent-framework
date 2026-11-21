# @ivlev-dev/silent-vite

Vite-плагин компиляции Silent Framework: преобразует TS/TSX/JS/JSX в JavaScript через нативный addon `@ivlev-dev/silent-swc`, внедряет HMR и генерирует индекс DI для автоматического разрешения интерфейсов.

#### `silent`

Сигнатура:

```ts
import type { ConfigEnv, Plugin, ResolvedConfig, UserConfig } from "vite";
import type { SilentOptions } from "@ivlev-dev/silent-vite";

declare function silent(options?: SilentOptions): Plugin;
```

Пример подключения в `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
});
```

Возвращаемое значение — объект Vite-плагина:

```ts
{
  name: "silent",
  enforce: "pre",
  config(config: UserConfig, env?: ConfigEnv): UserConfig | undefined;
  configResolved(config: ResolvedConfig): void;
  buildStart(): Promise<void>;
  transform(code: string, id: string, options?: { ssr?: boolean }): Promise<{
    code: string;
    map: string | null;
    warnings: string[];
  } | null>;
  watchChange(id: string): void;
  handleHotUpdate(context: { file: string }): void;
}
```

Плагин работает с `enforce: "pre"`, поэтому его хуки выполняются раньше стандартных плагинов Vite.

#### `SilentOptions`

Все поля необязательны.

| Поле | Тип | По умолчанию | Описание |
| --- | --- | --- | --- |
| `include` | `RegExp` | `/\.(ts\|tsx\|mts\|cts\|js\|jsx\|mjs\|cjs)$/` | Шаблон путей, подлежащих компиляции. |
| `exclude` | `RegExp` | `/node_modules/` | Шаблон путей, исключаемых из компиляции. |
| `root` | `string` | `process.cwd()` (абсолютный путь) | Корень проекта: файлы вне него не трансформируются. |
| `swc` | `Record<string, unknown>` | `{}` | Опции компилятора SWC, передаваемые в addon. JSX всегда компилируется рантаймом Silent Framework. |
| `requirePreloader` | `boolean` | `false` | Требовать наличие прелоадера на уровне view. |
| `runtime` | `string` | `"@ivlev-dev/silent-core"` | Имя модуля рантайма для сгенерированного кода. |
| `hmr` | `boolean` | `true` | Включить внедрение HMR в компилируемый код. |
| `index` | `boolean` | `true` | Строить индекс DI по файлам проекта. При `false` передаётся пустой индекс `{ interfaces: {}, values: {} }`. |
| `view` | `boolean` | `true` | Включить view/VM-рантайм. При `false` вырезает `component-view` и генерирует lazy-чанк только при наличии VM. |
| `hydrate` | `boolean` | `true` | Включить клиентскую гидрацию. При `false` отключаются adoption-план и `staticRows` в компиляторе, из стартового чанка вырезаются hydration-ветки и прокси, а `config` ставит `define.__SILENT_HYDRATE__ = "false"`; вызов `hydrate()` в такой сборке бросает `Error`. Используйте только для mount-only приложений. |
| `di` | `"allow" \| "warn" \| "error"` | `"warn"` | Политика DI-диагностик компилятора: `allow` — игнорировать, `warn` — выводить через `this.warn`, `error` — бросать ошибку в `transform`. |
| `cacheLimit` | `number` | `4096` | Сколько записей персистентного кеша трансформаций хранить в `config.cacheDir/silent-transform`. Prune выполняется после `buildStart` отложенно (`setTimeout(0)`), чтобы не задерживать старт сборки; самые старые записи удаляются по `mtime`. |

`ResolvedOptions` и `resolveOptions` — внутренние детали пакета: в `package.json` экспортируется только `"."`, поэтому через публичные пути они недоступны. `DEFAULT_INCLUDE`, `DEFAULT_EXCLUDE`, `DEFAULT_RUNTIME`, `matchesPattern`, `cleanModuleId`, `isVirtualModule`, `isInsideRoot`, `isSourceModule` определены в `options.ts` и используются плагином.

Нормализация опций (`resolveOptions`)

Сигнатура:

```ts
function resolveOptions(options?: SilentOptions): ResolvedOptions;
```

Нормализует пользовательские опции: подставляет значения по умолчанию, разрешает `root` относительно `process.cwd()`. Возвращает объект с обязательными полями `include`, `exclude`, `root`, `swc`, `requirePreloader`, `runtime`, `hmr`, `index`, `view`, `hydrate`, `di`, `cacheLimit`.

#### `DiMode`

Сигнатура:

```ts
type DiMode = "allow" | "warn" | "error";
```

Описание: политика обработки диагностик DI-компилятора. `allow` игнорирует их, `warn` передаёт в `this.warn`, `error` прерывает transform с текстом диагностики, включающим имя зависимости. Значение по умолчанию — `warn`.

Нормализованные опции (`ResolvedOptions`)

Сигнатура:

```ts
type DiMode = "allow" | "warn" | "error";

interface ResolvedOptions {
  include: RegExp;
  exclude: RegExp;
  root: string;
  swc: Record<string, unknown>;
  requirePreloader: boolean;
  runtime: string;
  hmr: boolean;
  index: boolean;
  view: boolean;
  hydrate: boolean;
  di: DiMode;
  cacheLimit: number;
}
```

Нормализованное представление опций плагина. Плагин создаёт его один раз при вызове `silent()` и использует во всех хуках.

## Как работает

### Порядок хуков плагина

1. `config(config, env)` — возвращает `define`-константы: `__SILENT_DEV__` (`"false"` для `build`, включая SSR; `"true"` для `serve`; при отсутствии `env` не задаётся), `__SILENT_VIEW__ = "false"` при `view: false`, `__SILENT_HYDRATE__ = "false"` при `hydrate: false`, `__SILENT_SERVER__ = "false"` для клиентской production-сборки (`build` без `build.ssr`). При `view: false` также отключает полифилл `build.modulePreload`, если пользователь не задал его сам.
2. `configResolved(config)` — запоминает каталог кэша (`config.cacheDir/silent-transform`), сохраняет снимок строковых алиасов Vite (`resolve.alias`) и объединяет его с `compilerOptions.paths` из tsconfig, а затем сбрасывает индекс, чтобы scan учитывал актуальные правила.
3. `buildStart` — вызывается один раз (или лениво при первом `transform`): при `index: true` нативный addon сканирует `root` и строит индекс DI; персистентный кэш трансформаций очищается от старых записей.
4. `transform(code, id, options)` — для каждого модуля:
   - очищает `id` от query и hash;
   - пропускает виртуальные модули (`\0…`, `virtual:…`);
   - проверяет `include`, `exclude` и попадание в `root`;
   - загружает addon через `loadSwc()`;
   - получает индекс через `ensureIndex()`;
   - вызывает `nativeTransform(swc, code, moduleId, optionsJson, indexJson)`, добавляя в `optionsJson` флаг `ssr` из `options?.ssr`;
   - применяет политику `di` к `diagnostics` и возвращает `{ code, map, warnings }` (`warnings` всегда пуст: `warn`-режим выводит сообщения через `this.warn`, `error`-режим бросает ошибку).
5. `watchChange(id)` — при изменении исходного модуля (но не виртуального) сбрасывает кеш индекса; изменение любого `tsconfig*.json` в `root` (`tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, …) перечитывает `paths` и пересобирает правила алиасов, сохраняя снимок алиасов Vite. Уже запущенный scan, завершившийся после инвалидации, не попадает в кеш индекса (счётчик поколений).
6. `handleHotUpdate({ file })` — то же для HMR-обновлений исходных модулей.

Индекс кешируется в памяти плагина: несколько `transform` не вызывают повторный scan.

### Ограничение: входящая sourcemap

Плагин возвращает карту относительно входного кода и не читает `transformOptions.inMap`. Если перед `silent` отработал другой `pre`-плагин и передал свою карту, итоговая sourcemap будет неверной: композиция карт требует поддержки в нативном аддоне.

Правило: `silent` должен быть единственным `pre`-плагином, изменяющим TS/TSX/JS/JSX. Если Vite передал непустой `inMap`, плагин один раз на инстанс выводит предупреждение «silent должен быть единственным pre-плагином; входящая sourcemap не учитывается». Без `inMap` предупреждений нет — в том числе в dev-режиме.

### Компиляция TS/TSX

Компиляцию выполняет нативный addon `@ivlev-dev/silent-swc`:

- `loadSwc()` динамически импортирует `@ivlev-dev/silent-swc` и кеширует модуль.
- `nativeTransform()` вызывает `swc.transform(source, filename, optionsJson, indexJson)` и проверяет, что ответ — валидный JSON структуры `{ code, map, diagnostics }`.
- `nativeScan()` вызывает `swc.scan(root, optionsJson)` с JSON правил алиасов и проверяет структуру индекса `{ interfaces, values }`.

Ошибки addon оборачиваются в `Error` с указанием имени файла или корня.

### Виртуальные модули индекса DI

Если `index: true`, плагин сканирует проект и строит `SilentIndex`:

```ts
interface SilentIndex {
  interfaces: Record<string, string[]>;
  values: Record<string, string[]>;
}
```

Индекс сериализуется в `indexJson` и передаётся в компилятор, который подставляет найденные реализации интерфейсов при компиляции конструкторов. Если `index: false`, используется `EMPTY_INDEX_JSON` (`{ interfaces: {}, values: {} }`), scan не вызывается.

### Политика DI-диагностик

Компилятор возвращает `diagnostics`, когда, например, «для интерфейса … не найдено реализации» или «найдено несколько реализаций …». Опция `di` управляет их обработкой:

- `"allow"` — диагностики игнорируются;
- `"warn"` (по умолчанию) — каждая диагностика передаётся в `this.warn` Vite с префиксом `[silent-vite] DI: `; в `warnings` результата `transform` они не дублируются;
- `"error"` — `transform` выбрасывает `Error` с префиксом `[silent-vite] DI: ` и списком диагностик; Vite показывает это как ошибку сборки, текст содержит имя зависимости.

```ts
silent({ di: "error" });
```

Политика применяется одинаково при cache miss и cache hit: кешированный результат содержит те же `diagnostics`, поэтому `warn`/`error` воспроизводятся и при чтении из `cacheDir`.

Compile-time проверка видит интерфейсы и биндинги. Классы без `DI_CREATE` и без явного биндинга статически не проверяются — для них включите строгий режим контейнера в рантайме:

```ts
import { Container } from "@ivlev-dev/silent-di";

const container = new Container("root", undefined, { implicitBindings: "error" });
```

`implicitBindings: "error"` запрещает неявное создание классов и бросает ошибку при отсутствующей реализации вместо молчаливого `undefined`. Режим наследуется дочерними контейнерами и scope'ами. Рекомендуемая комбинация — `di: "error"` в плагине вместе со строгим контейнером.

### Внедрение HMR

Флаг `hmr` (по умолчанию `true`) передаётся в `optionsJson`. Компилятор внедряет `import.meta.hot.accept` в зависимости от этого флага и метаданных компонентов. В рантайме `@ivlev-dev/silent-core` использует реестр инстансов (`globalThis`) и функции `hmrUpdate`/`hmrInvalidate` для сохранения или пересоздания ViewModel.

### Source maps

Результат addon содержит `map: string | null`. Плагин передаёт его в Vite как есть. Если addon вернул `null`, source map отсутствует.

### Режим dev/prod

Сам плагин не ветвится по режиму Vite: он применяет трансформацию в любом режиме. HMR-код активен только в dev, где существует `import.meta.hot`. Флаги `hmr` и `index` управляют соответствующими возможностями независимо от режима.

## HMR

- Модуль принимает обновление через `import.meta.hot.accept`.
- Реестр инстансов хранится на `globalThis`.
- При изменении view (компонента) сохраняются ViewModel и состояние сигналов, вызывается `hmrUpdate(moduleId, namespace)`: для каждого инстанса нового компонента вызывается `rerender`.
- При изменении модуля ViewModel создаётся новый экземпляр VM с переносом значений `@reactive`-полей; при наличии новой функции прелоадера обновляется и он (`updatePreloader`).
- Несовместимые изменения (например, изменения сигнатур, затрагивающих VM) приводят к `import.meta.hot.invalidate()` и полной перезагрузке affected-модуля.
- HMR рантайма самого фреймворка выполняет полную перезагрузку.

## Ошибки и диагностика

- При отсутствии нативного бинарника `loadSwc()` выбрасывает ошибку:

```text
@ivlev-dev/silent-vite: не удалось загрузить нативный addon @ivlev-dev/silent-swc.
Соберите нативный addon перед использованием плагина:
  pnpm --filter @ivlev-dev/silent-swc build
Причина: ...
```

Действие: выполнить `pnpm --filter @ivlev-dev/silent-swc build`, убедиться, что версия Node.js не ниже 22.

- Ошибки `transform` и `scan` оборачиваются в `Error` с префиксом `@ivlev-dev/silent-vite:` и именем файла/корня. Текст причины сохраняется.

- Если addon вернул невалидный JSON, плагин выбрасывает `@ivlev-dev/silent-vite: @ivlev-dev/silent-swc transform вернул невалидный JSON для <file>`.

- Если структура ответа не соответствует `{ code, map, diagnostics }`, выбрасывается ошибка `неожиданную структуру`.

- Диагностики компилятора обрабатываются по политике `di` (см. «Политика DI-диагностик») и не попадают в `warnings` результата `transform`.

```text
[silent-vite] DI: для интерфейса Store не найдено реализации
[silent-vite] DI: найдено несколько реализаций для интерфейса Store: MemoryStore, ApiStore
```

При `di: "warn"` эти же строки уходят в `this.warn` Vite, при `di: "allow"` молча отбрасываются, при `di: "error"` первая строка становится текстом `Error`, и сборка падает.

- Подробные ошибки SWC видны в `diagnostics`/`warnings` и в stderr при падении addon. Для повторной сборки addon используйте `pnpm --filter @ivlev-dev/silent-swc build`; при несовпадении ABI версии addon также пересоберите его и синхронизируйте версию Node.js.

## Ограничения

- Обрабатываются только файлы, попадающие под `include` и находящиеся внутри `root`; по умолчанию исключены `node_modules`.
- Vite версии не ниже 8 (peer dependency), Node.js не ниже 22.
- Addon `@ivlev-dev/silent-swc` должен быть собран (`dist` нативного модуля), иначе плагин выбрасывает ошибку.
- Виртуальные модули (`\0…`, `virtual:…`) пропускаются.
- `map` может быть `null`, если addon не вернул source map.
- Индекс DI строится один раз за запуск и инвалидируется только при изменении исходных модулей; правки конфигурации требуют перезапуска dev-сервера.
- `swc` передаётся в addon как есть; валидация опций SWC выполняется самим addon'ом.
- `di` управляет только compile-time диагностиками: классы без `DI_CREATE`/биндинга требуют строгого режима контейнера (`implicitBindings: "error"`).
- HMR не выполняет горячую замену самого рантайма фреймворка — в этом случае происходит полная перезагрузка.
