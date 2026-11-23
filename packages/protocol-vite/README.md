# @ivlev-dev/silent-protocol-vite

Vite-плагин для `@ivlev-dev/silent-protocol`: читает TS-классы и вставляет статическую схему `Symbol.for("silent.protocol.schema")` и статический кодек `Symbol.for("silent.protocol.codec")`.

## Установка

```bash
pnpm add -D @ivlev-dev/silent-protocol-vite
pnpm add @ivlev-dev/silent-protocol
```

## Использование

```ts
import { defineConfig } from "vite";
import { protocol } from "@ivlev-dev/silent-protocol-vite";

export default defineConfig({
  plugins: [protocol()],
});
```

Поля сортируются по имени UTF-8, порядок объявления не важен. Плагин генерирует не только схему, но и статические `write`/`read`-кодеки; при отсутствии кодека runtime использует generic-путь. Декораторы не обязательны; `@Int32`, `@Uint32`, `@Float32`, `@Fixed32`, `@Fixed64`, `@Uint64`, `@Int64`, `@EpochMillis` уточняют wire-тип, `@OneOf(Enum.Member)` задаёт варианты oneof.

Для каждого класса со схемой генерируется статический кодек. Он использует `writeMessage`/`readMessage`, `writeArray`/`readArray`, `writeMap`/`readMap`, `writeSet`/`readSet` из `@ivlev-dev/silent-protocol`, которые плагин импортирует один раз на файл. Кодек побайтово совпадает с generic-кодеком, но работает без рефлексии и компиляции схемы в рантайме.

## Опции

| Опция | Тип | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `include` | `RegExp` | `/\.(?:[cm]?ts\|tsx)$/` | Файлы, которые обрабатывает плагин |
| `exclude` | `RegExp` | `/node_modules/` | Пропускаемые файлы |
| `tsconfig` | `string` | ближайший `tsconfig.json` | Путь к конфигу |
| `strict` | `boolean` | `false` | Бросать ошибку на неподдерживаемый тип |
| `diagnostics` | `boolean \| (message) => void` | `true` | Диагностика |

## Поддерживаемые типы

Примитивы, `Date`, `bigint`, `Uint8Array`/`ArrayBuffer`, typed arrays, `Map`, `Set`, `Record`, массивы, кортежи, enum, литералы, `T | null | undefined`, вложенные классы, наследование, oneof.

Ограничения: union без enum-дискриминатора, `any`/`unknown`, функции, `Promise`, `WeakMap`/`WeakSet`, rest-кортежи, строковые значения enum в oneof.

Статический кодек не генерируется (класс остаётся на generic-кодеке со схемой), если в нём есть `Map` с optional-значениями или `Set<bigint>`: для этих случаев нужна каноническая сортировка generic-кодека.

Спецификация: [`docs/protocol.md`](../../docs/protocol.md).
