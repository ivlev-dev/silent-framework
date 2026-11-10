# @ivlev-dev/silent-swc

Нативный SWC-аддон фреймворка Silent Framework: компиляция TS/TSX, JSX-преобразование и сканирование DI-индекса.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-swc)](https://www.npmjs.com/package/@ivlev-dev/silent-swc)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-swc)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
![platforms](https://img.shields.io/badge/platforms-linux--x64%20%7C%20win32--x64-informational)

## Возможности

- Компиляция TS/TSX и JSX-преобразование Silent Framework через `swc_core`.
- DI-сканирование каталога: `scan` возвращает JSON-индекс интерфейсов и значений.
- Синхронный API из трёх функций: `transform`, `scan`, `version`.
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
| `scan` | `root: string` | `string` — JSON `SilentIndex` (`{ interfaces, values }`) |
| `version` | нет | `string` — версия нативного аддона |

## Платформы

- `linux-x64-gnu`
- `win32-x64-msvc`

В версии 0.1.x нативного бинаря для macOS нет.

## Сборка из исходников

Требуется Rust-тулчейн.

```bash
pnpm --filter @ivlev-dev/silent-swc build
```

Команда эквивалентна `napi build --release --platform`. Release-профиль задаёт `lto = "thin"`.

## Ограничения и совместимость

- Требуется собранный нативный бинарник для текущей платформы; чистой JS-реализации нет.
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
