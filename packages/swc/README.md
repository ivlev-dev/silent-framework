# @ivlev-dev/silent-swc

Нативный SWC-аддон фреймворка Silent Framework: компиляция TS/TSX, JSX-преобразование и сканирование DI-индекса.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-swc)](https://www.npmjs.com/package/@ivlev-dev/silent-swc)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-swc)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
![platforms](https://img.shields.io/badge/platforms-linux--x64%20%7C%20win32--x64-informational)

## Возможности

- Компиляция TS/TSX и JSX-преобразование Silent Framework через `swc_core`.
- DI-сканирование каталога: `scan` возвращает JSON-индекс интерфейсов и значений.
- Инкрементальное сканирование набора файлов: `scanFiles` возвращает индекс только для переданных путей.
- Синхронный API из четырёх функций: `transform`, `scan`, `scanFiles`, `version`.
- Возврат source map и диагностик SWC в результате `transform`.
- Загрузка подходящего нативного бинарника по `process.platform`/`process.arch`.

## Установка

```bash
pnpm add @ivlev-dev/silent-swc
# или
npm install @ivlev-dev/silent-swc
# или
yarn add @ivlev-dev/silent-swc
```

Требования: Node.js `>=22`.

## Быстрый старт

```ts
import { transform } from "@ivlev-dev/silent-swc";

const raw = transform(
  "export const value = 1;",
  "/project/src/main.ts",
  JSON.stringify({ swc: { jsc: { target: "es2022" } }, hmr: true }),
  JSON.stringify({ interfaces: {}, values: {} }),
);

const result = JSON.parse(raw) as {
  code: string;
  map: string | null;
  diagnostics: string[];
};

console.log(result.code);
```

`transform` возвращает JSON-строку; результат нужно распарсить через `JSON.parse`. `map` равен `null`, если source maps отключены.

## API

| Функция | Аргументы | Результат |
| --- | --- | --- |
| `transform` | `source: string`, `filename: string`, `optionsJson: string`, `indexJson: string` | `string` — JSON `NativeTransformResult` (`{ code, map, diagnostics }`) |
| `scan` | `root: string`, `optionsJson: string` | `string` — JSON `SilentIndex` (`{ interfaces, values }`) |
| `scanFiles` | `root: string`, `filesJson: string`, `optionsJson: string` | `string` — JSON `SilentIndex` только для файлов из `filesJson` |
| `version` | нет | `string` — версия нативного аддона |

## Платформы

- `linux-x64-gnu`
- `win32-x64-msvc`

Release-workflow собирает пребилды только для этих двух платформ; для остальных (включая macOS и arm64) бинарник собирается локально. На Linux учитывается libc: для musl нужен `linux-<arch>-musl`, gnu-бинарник не подхватывается без `SILENT_SWC_ALLOW_GNU_FALLBACK=1`. В версии 0.12.x платформенные npm-пакеты `@ivlev-dev/silent-swc-<triple>` не публикуются — `index.js` загружает `native/*.node` из самого пакета.

## Сборка из исходников

Требуется Rust-тулчейн.

```bash
pnpm --filter @ivlev-dev/silent-swc build
```

Команда эквивалентна `napi build --release --platform`. Release-профиль задаёт `lto = "thin"`.

## Ограничения и совместимость

- Требуется собранный нативный бинарник для текущей платформы; чистой JS-реализации нет.
- Addon работает только в Node (Node-API); в браузере и edge-runtime он недоступен.
- API полностью синхронный.
- Ввод и вывод передаются строками; большие файлы полностью держатся в памяти.
- `optionsJson` и `indexJson` должны быть валидным JSON или пустыми строками.

## Ссылки

- Репозиторий: https://github.com/ivlev-dev/silent-framework
- Документация: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/swc.md
- CHANGELOG: https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md
- Issues: https://github.com/ivlev-dev/silent-framework/issues

---

MIT © ivlev-dev
