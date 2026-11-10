# @ivlev-dev/silent-swc

Нативный Node-API addon на `swc_core`: компиляция TS/TSX, JSX-преобразование Silent Framework и сканирование DI-индекса.

Addon синхронно экспортирует три функции — `transform`, `scan`, `version`. Загрузка бинарника выполняется модулем-обёрткой `packages/swc/index.js`: сначала ищется платформенный пакет `@ivlev-dev/silent-swc-<triple>`, затем локальный `*.node` в каталоге `native`.

#### `NativeTransformResult`

Результат `transform` после `JSON.parse`:

```ts
interface NativeTransformResult {
  code: string;
  map: string | null;
  diagnostics: string[];
}
```

- `code` — скомпилированный модуль.
- `map` — source map в виде строки или `null`, если source maps отключены.
- `diagnostics` — сообщения, возвращённые SWC при компиляции.

## `transform`

```ts
function transform(
  source: string,
  filename: string,
  optionsJson: string,
  indexJson: string,
): string;
```

Компилирует исходный код и возвращает JSON-строку с объектом `NativeTransformResult`.

Аргументы:

- `source` — исходный код модуля.
- `filename` — путь/имя файла; определяет синтаксис (TSX для `.tsx`/`.jsx`) и `module_id`.
- `optionsJson` — JSON опций Silent/SWC. Пустая строка означает опции по умолчанию.
- `indexJson` — JSON DI-индекса (`{ interfaces, values }`). Пустая строка означает пустой индекс.

Формат `optionsJson`:

```ts
interface SwcAddonOptions {
  swc?: Record<string, unknown>;
  requirePreloader?: boolean;
  runtime?: string;
  hmr?: boolean;
}
```

- `swc` — опции SWC (`Options`), например `{ jsc: { target: "es2022" }, minify: false }`.
- `requirePreloader` — требовать `preloader` у view-компонентов.
- `runtime` — путь/модуль runtime-импортов Silent (по умолчанию задаётся компилятором).
- `hmr` — включить генерацию HMR-кода.

При отсутствии значений применяются умолчания: синтаксис TypeScript с `decorators: true`, цель `es2024` (если не задана ни цель, ни `env`), версия декораторов `2023-11`, source maps включены, если `sourceMaps` не указан. Если `options.swc` равно `null` или отсутствует, берётся `Options` по умолчанию.

Пример:

```ts
import { transform } from "@ivlev-dev/silent-swc";

const raw = transform(
  "export const value = 1;",
  "/project/src/main.ts",
  JSON.stringify({ swc: { jsc: { target: "es2022" } }, hmr: true }),
  JSON.stringify({ interfaces: {}, values: {} }),
);

const result = JSON.parse(raw) as NativeTransformResult;
```

## `scan`

```ts
function scan(root: string): string;
```

Рекурсивно обходит `root` и возвращает JSON-строку с DI-индексом:

```ts
interface SilentIndex {
  interfaces: Record<string, string[]>;
  values: Record<string, string[]>;
}
```

- `interfaces` — отображение токена интерфейса на массив токенов его реализаций (`/abs/path/types.ts#Store` → `["/abs/path/memory-store.ts#MemoryStore"]`).
- `values` — отображение пути модуля без расширения на массив экспортируемых значений (`/abs/path/memory-store.ts` → `["MemoryStore"]`).

Сканер обходит файлы расширений `ts`, `tsx`, `mts`, `cts`, `js`, `jsx`, `mjs`, `cjs`, пропуская `.d.ts` и каталоги `node_modules`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.vite`, `.turbo`, `target`, а также скрытые и символические ссылки. Токены формируются как `<путь-модуля-без-расширения>#<Имя>`.

Пример:

```ts
import { scan } from "@ivlev-dev/silent-swc";

const index = JSON.parse(scan("/project")) as {
  interfaces: Record<string, string[]>;
  values: Record<string, string[]>;
};
```

Индекс используется Vite-плагином для разрешения реализаций интерфейсов в конструкторах и для различения value-токенов и `import type`.

## `version`

```ts
function version(): string;
```

Возвращает версию нативного addon (версия workspace/Cargo-пакета `silent-node`).

Пример:

```ts
import { version } from "@ivlev-dev/silent-swc";
console.log(version());
```

## Сборка

Сборка addon:

```bash
pnpm --filter @ivlev-dev/silent-swc build
```

Команда эквивалентна:

```bash
napi build --release --platform --manifest-path ../../crates/silent-node/Cargo.toml --output-dir native
```

Особенности сборки:

- release-профиль workspace задаёт `lto = "thin"`, `codegen-units = 1`, `strip = "symbols"`.
- В зависимостях `swc_core` включён feature `ecma_helpers_inline`: хелперы ECMAScript встраиваются в генерируемый код, а не импортируются из внешнего runtime.
- `transform` вызывает `swc_core::common::GLOBALS.set(...)` вокруг обработки, чтобы инициализировать thread-local состояние SWC для текущего вызова из Node.
- Артефакты: `packages/swc/native/*.node` и платформенные пакеты `@ivlev-dev/silent-swc-<triple>`; `packages/swc/index.js` выбирает подходящий бинарник по `process.platform`/`process.arch`.

Поддерживаемые платформы по умолчанию: `linux-x64` (`linux-x64-gnu`), `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64` (`win32-x64-msvc`), `win32-arm64`.

## Ошибки

- Синтаксическая ошибка или ошибка преобразования: `transform` бросает исключение (napi-ошибка с текстом причины), JSON-результат не возвращается.
- Ошибки Silent-компилятора (например, интерфейс без реализации или отсутствие preloader при `requirePreloader: true`) накапливаются и выбрасываются одной строкой через `\n`.
- Отсутствие нативного бинарника: `packages/swc/index.js` бросает `Error` с сообщением `@ivlev-dev/silent-swc: native addon is not built...`; `@ivlev-dev/silent-vite` оборачивает её и предлагает `pnpm --filter @ivlev-dev/silent-swc build`.
- `diagnostics` в успешном результате содержат сообщения SWC и читаются как обычные строки; они не прерывают возврат `code`/`map`.
- `scan` не возвращает диагностики; при недоступном каталоге возвращает пустой или частичный индекс.

## Версии

- Версия addon: `0.0.1` ( workspace и Cargo-пакет `silent-node`), `version()` возвращает ту же строку.
- `swc_core`: `84.0.2` с набором features из корневого `Cargo.toml`.
- `@ivlev-dev/silent-vite`: `0.0.1`, зависит от `@ivlev-dev/silent-swc` через `workspace:*` и вызывает `transform`/`scan` через `loadSwc`.
- Требования: Node.js `>=22`.

## Ограничения

- Нет чисто JavaScript-реализации: требуется собранный нативный бинарник для текущей платформы.
- API полностью синхронное.
- Ввод и вывод передаются строками; большие файлы полностью держатся в памяти.
- `optionsJson` и `indexJson` должны быть валидным JSON или пустыми строками.
- По умолчанию цель компиляции — `es2024`.
- Source maps по умолчанию включены; `map` может быть `null`, если опциями SWC они отключены.
- Декораторы по умолчанию принудительно переводятся в версию `2023-11`, если `transformConfig.decoratorVersion` не задана явно.
- `scan` учитывает только поддерживаемые расширения и пропускает указанные служебные каталоги и ссылки.