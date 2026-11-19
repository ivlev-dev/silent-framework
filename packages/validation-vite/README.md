# @ivlev-dev/silent-validation-vite

Vite-плагин для [`@ivlev-dev/silent-validation`](https://www.npmjs.com/package/@ivlev-dev/silent-validation): читает TS-аннотации `accessor`-полей через TypeScript API и вставляет классам статическую схему, по которой `validate` проверяет типы в рантайме.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-validation-vite)](https://www.npmjs.com/package/@ivlev-dev/silent-validation-vite)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-validation-vite)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-validation-vite)](https://www.npmjs.com/package/@ivlev-dev/silent-validation-vite)

## Установка

```bash
pnpm add -D @ivlev-dev/silent-validation-vite
pnpm add @ivlev-dev/silent-validation
```

Плагин ставится в `devDependencies`, пакет `@ivlev-dev/silent-validation` — отдельной зависимостью приложения и содержит рантайм валидации.

## Использование

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";
import { validation } from "@ivlev-dev/silent-validation-vite";

export default defineConfig({
  plugins: [silent(), validation()],
});
```

Схема генерируется только для классов-потомков `ValidationModel`:

```ts
import { ValidationModel } from "@ivlev-dev/silent-validation";

class Address extends ValidationModel {
  public accessor city: string = "";
}
```

## Опции

| Опция | Тип | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `include` | `RegExp` | `/\.(?:[cm]?ts\|tsx)$/` | Файлы, которые обрабатывает плагин; заменяет набор по умолчанию |
| `exclude` | `RegExp` | `/node_modules/` | Файлы, которые плагин пропускает |
| `tsconfig` | `string` | ближайший `tsconfig.json` | Путь к конфигу относительно корня проекта |
| `base` | `string` | `"ValidationModel"` | Имя базового класса для fallback-определения, потомки которого получают схему |
| `strict` | `boolean` | `false` | Бросать ошибку вместо предупреждения при неподдерживаемом типе |

Базовый класс определяется по символу `ValidationModel` из `@ivlev-dev/silent-validation`; fallback по имени используется, только если символ пакета не найден. `typescript` и `magic-string` — зависимости плагина, рантайм-пакет от них не зависит.

## Поведение

- Модули с query (`?raw`, `?url`, `?vue` и другие) пропускаются; трансформируются только безопасные `?import`, `?v`, `?t`, `?direct` и файлы без query.
- `include` заменяет набор расширений по умолчанию (`.ts`, `.tsx`, `.mts`, `.cts`).
- Type-only импорт класса получает namespace-импорт, только если у модуля есть рантайм-файл; иначе поле пропускается с диагностикой.
- Type-only реэкспорт через barrel разрешается до исходного модуля; default-экспорт и class expression получают квалифицированную ссылку.
- Схема генерируется для `InstanceType<typeof X>`; `Buffer` сериализуется как `uint8array`, `__proto__` эмитится вычисляемым ключом.
- Повторный transform и второй экземпляр плагина не дублируют схему.
- Program обновляется инкрементально при изменении файлов; `tsconfig` и импортированные типы регистрируются через `addWatchFile`.
- CRLF сохраняется, `tsconfig` без входных файлов не прерывает трансформацию.

## Ограничения

- Числовая index-signature (`{ length: number; [n: number]: T }`) учитывается только без именованных свойств: при наличии `length` или других полей элементы по числовому индексу не проверяются.
- Поддерживаются только identifier-имена `accessor`-полей; строковые, числовые и вычисляемые имена пропускаются с диагностикой (в `strict` — ошибка). Приватные `#field` пропускаются без сообщения.
- Символьные свойства структурных типов пропускаются с диагностикой (в `strict` — ошибка); well-known `Symbol.*` игнорируются без сообщения.
- Ambient-классы без рантайма и `declare global` пропускаются: поле, ссылающееся на такой класс, вырезается с диагностикой (в `strict` — ошибка).
- `ArrayLike<T>` принимает массивы и array-like объекты, но элементы array-like объекта по индексу не проверяются — только `length`; массивы проверяются поэлементно.
- Generic-, conditional-, template- и indexed-типы без конкретизации не сериализуются: поле пропускается с диагностикой (в `strict` — ошибка).

## Требования

- Node.js >= 22.
- Vite >= 8.
- ESM-only.
- Stage 3 декораторы: `experimentalDecorators: false`.

## Ссылки

- API: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/validation-vite.md
- Валидация: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/validation.md
- CHANGELOG: https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md

---

MIT © ivlev-dev
