# @ivlev-dev/silent-validation-vite

Vite-плагин для [`@ivlev-dev/silent-validation`](https://www.npmjs.com/package/@ivlev-dev/silent-validation): читает TS-аннотации `accessor`-полей через TypeScript API и вставляет классам статическую схему, по которой `validate` проверяет типы в рантайме.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-validation-vite)](https://www.npmjs.com/package/@ivlev-dev/silent-validation-vite)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-validation-vite)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-validation-vite)](https://www.npmjs.com/package/@ivlev-dev/silent-validation-vite)

## Установка

```bash
pnpm add -D @ivlev-dev/silent-validation-vite
```

Пакет `@ivlev-dev/silent-validation` устанавливается отдельно и содержит рантайм валидации.

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
| `include` | `RegExp` | `/\.(ts\|tsx)$/` | Файлы, которые обрабатывает плагин |
| `exclude` | `RegExp` | `/node_modules/` | Файлы, которые плагин пропускает |
| `tsconfig` | `string` | ближайший `tsconfig.json` | Путь к конфигу относительно корня проекта |
| `base` | `string` | `"ValidationModel"` | Имя базового класса для fallback-определения, потомки которого получают схему |
| `strict` | `boolean` | `false` | Бросать ошибку вместо предупреждения при неподдерживаемом типе |

Базовый класс определяется по символу `ValidationModel` из `@ivlev-dev/silent-validation`; fallback по имени используется, только если символ пакета не найден. `typescript` и `magic-string` — зависимости плагина, рантайм-пакет от них не зависит.

## Поведение

- `?raw`/`?url`-модули пропускаются; плагин работает с исходным TS/TSX.
- `include` заменяет набор расширений по умолчанию (`.ts`, `.tsx`, `.mts`, `.cts`).
- Type-only импорт класса получает namespace-импорт, только если у модуля есть рантайм-файл; иначе поле пропускается с диагностикой.
- Повторный transform и второй экземпляр плагина не дублируют схему.
- Program обновляется инкрементально при изменении файлов.

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
