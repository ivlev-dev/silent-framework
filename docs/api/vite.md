# @ivlev-dev/silent-vite

Vite-плагин компиляции Silent Framework: преобразует TS/TSX/JS/JSX в JavaScript через нативный addon `@ivlev-dev/silent-swc`, внедряет HMR и генерирует индекс DI для автоматического разрешения интерфейсов.

#### `silent`

Сигнатура:

```ts
import type { Plugin } from "vite";
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
  buildStart(): Promise<void>;
  transform(code: string, id: string): Promise<{
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

Типы `ResolvedOptions` и функция `resolveOptions` описаны в `packages/vite/dist/options.d.ts`, но в основной точке входа пакета не реэкспортируются. Их можно использовать только через внутренние пути; `DEFAULT_INCLUDE`, `DEFAULT_EXCLUDE`, `DEFAULT_RUNTIME`, `matchesPattern`, `cleanModuleId`, `isVirtualModule`, `isInsideRoot`, `isSourceModule` ведут себя так же, как определено в `options.ts`.

Нормализация опций (`resolveOptions`)

Сигнатура:

```ts
function resolveOptions(options?: SilentOptions): ResolvedOptions;
```

Нормализует пользовательские опции: подставляет значения по умолчанию, разрешает `root` относительно `process.cwd()`. Возвращает объект с обязательными полями `include`, `exclude`, `root`, `swc`, `requirePreloader`, `runtime`, `hmr`, `index`.

Нормализованные опции (`ResolvedOptions`)

Сигнатура:

```ts
interface ResolvedOptions {
  include: RegExp;
  exclude: RegExp;
  root: string;
  swc: Record<string, unknown>;
  requirePreloader: boolean;
  runtime: string;
  hmr: boolean;
  index: boolean;
}
```

Нормализованное представление опций плагина. Плагин создаёт его один раз при вызове `silent()` и использует во всех хуках.

## Как работает

### Порядок хуков плагина

1. `buildStart` — вызывается один раз (или лениво при первом `transform`): при `index: true` нативный addon сканирует `root` и строит индекс DI.
2. `transform(code, id)` — для каждого модуля:
   - очищает `id` от query и hash;
   - пропускает виртуальные модули (`\0…`, `virtual:…`);
   - проверяет `include`, `exclude` и попадание в `root`;
   - загружает addon через `loadSwc()`;
   - получает индекс через `ensureIndex()`;
   - вызывает `nativeTransform(swc, code, moduleId, optionsJson, indexJson)`;
   - возвращает `{ code, map, warnings: diagnostics }`.
3. `watchChange(id)` — при изменении исходного модуля (но не виртуального) сбрасывает кеш индекса.
4. `handleHotUpdate({ file })` — то же для HMR-обновлений.

Индекс кешируется в памяти плагина: несколько `transform` не вызывают повторный scan.

### Компиляция TS/TSX

Компиляцию выполняет нативный addon `@ivlev-dev/silent-swc`:

- `loadSwc()` динамически импортирует `@ivlev-dev/silent-swc` и кеширует модуль.
- `nativeTransform()` вызывает `swc.transform(source, filename, optionsJson, indexJson)` и проверяет, что ответ — валидный JSON структуры `{ code, map, diagnostics }`.
- `nativeScan()` вызывает `swc.scan(root)` и проверяет структуру индекса `{ interfaces, values }`.

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

- Диагностики компилятора возвращаются в поле `warnings` результата `transform` и передаются Vite как warnings.

- Подробные ошибки SWC видны в `diagnostics`/`warnings` и в stderr при падении addon. Для повторной сборки addon используйте `pnpm --filter @ivlev-dev/silent-swc build`; при несовпадении ABI версии addon также пересоберите его и синхронизируйте версию Node.js.

## Ограничения

- Обрабатываются только файлы, попадающие под `include` и находящиеся внутри `root`; по умолчанию исключены `node_modules`.
- Vite версии не ниже 8 (peer dependency), Node.js не ниже 22.
- Addon `@ivlev-dev/silent-swc` должен быть собран (`dist` нативного модуля), иначе плагин выбрасывает ошибку.
- Виртуальные модули (`\0…`, `virtual:…`) пропускаются.
- `map` может быть `null`, если addon не вернул source map.
- Индекс DI строится один раз за запуск и инвалидируется только при изменении исходных модулей; правки конфигурации требуют перезапуска dev-сервера.
- `swc` передаётся в addon как есть; валидация опций SWC выполняется самим addon'ом.
- HMR не выполняет горячую замену самого рантайма фреймворка — в этом случае происходит полная перезагрузка.
