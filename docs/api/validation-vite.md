# @ivlev-dev/silent-validation-vite

Vite-плагин для `@ivlev-dev/silent-validation`: читает TS-аннотации `accessor`-полей через TypeScript API и вставляет классам статическую схему для проверки типов в рантайме.

```ts
import { defineConfig } from "vite";
import { validation } from "@ivlev-dev/silent-validation-vite";

export default defineConfig({
  plugins: [validation()],
});
```

### `validation`

```ts
function validation(options?: ValidationPluginOptions): Plugin;
```

Создаёт Vite-плагин с именем `silent-validation`, который на этапе `pre`-трансформации генерирует схемы для классов-потомков `ValidationModel`. Файлы без `accessor`-полей и `extends` пропускаются до создания TypeScript Program. Схема генерируется только для классов, унаследованных от базового класса `base` напрямую или через промежуточные классы.

```ts
validation({ include: /src[\\/].*\.ts$/, strict: true });
```

### `ValidationPluginOptions`

```ts
interface ValidationPluginOptions {
  readonly include?: RegExp;
  readonly exclude?: RegExp;
  readonly tsconfig?: string;
  readonly base?: string;
  readonly strict?: boolean;
}
```

Опции плагина:

- `include` — регулярное выражение файлов, которые обрабатываются; по умолчанию `/\.(?:ts|tsx)$/`.
- `exclude` — регулярное выражение пропускаемых файлов; по умолчанию `/node_modules/`.
- `tsconfig` — путь к `tsconfig.json` относительно корня проекта; по умолчанию ищется ближайший конфиг.
- `base` — имя базового класса для fallback-определения; по умолчанию `"ValidationModel"`. Основной путь — сравнение символа `ValidationModel` из `@ivlev-dev/silent-validation`, имя используется, только если символ пакета не найден.
- `strict` — бросать ошибку вместо предупреждения при неподдерживаемом типе; по умолчанию `false`.

### Поведение

- Модули с query (`?raw`, `?url` и другие) не трансформируются: плагин работает только с исходным TS/TSX-кодом.
- `include` полностью заменяет набор по умолчанию; поддержаны `.ts`, `.tsx`, `.mts`, `.cts` и пользовательские регулярные выражения.
- Declaration-файлы (`*.d.ts`) из `tsconfig` остаются в Program, чтобы ambient-классы и типы резолвились.
- Для type-only импорта класса плагин добавляет namespace-импорт, только если у модуля есть рантайм-файл; иначе поле пропускается с диагностикой (в `strict` — ошибка).
- Если код, пришедший в `transform`, изменён сторонним плагином, позиции сдвигаются; при несовпадении содержимого трансформация безопасно пропускается с предупреждением.
- Повторная трансформация того же файла и второй экземпляр плагина не дублируют схему.
- База ищется по всем найденным копиям `@ivlev-dev/silent-validation`; классы в `namespace` получают квалифицированную ссылку.
- Program обновляется инкрементально: изменение одного файла не пересоздаёт весь проект.
