# @ivlev-dev/silent-validation-vite

Vite-плагин для `@ivlev-dev/silent-validation`: читает TS-аннотации `accessor`-полей через TypeScript API и вставляет классам статическую схему для проверки типов в рантайме.

```ts
import { defineConfig } from "vite";
import { validation } from "@ivlev-dev/silent-validation-vite";

export default defineConfig({
  plugins: [validation()],
});
```

### Установка и требования

```bash
pnpm add -D @ivlev-dev/silent-validation-vite
pnpm add @ivlev-dev/silent-validation
```

Плагин ставится в `devDependencies`, рантайм `@ivlev-dev/silent-validation` — отдельной зависимостью приложения.

- Node.js >= 22, Vite >= 8.
- ESM-only: плагин и рантайм поставляются как ES-модули.
- `typescript` и `magic-string` — зависимости только плагина; рантайм `@ivlev-dev/silent-validation` от них не зависит.
- Stage 3 декораторы: `experimentalDecorators: false`, `useDefineForClassFields: true`.

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

- `include` — регулярное выражение файлов, которые обрабатываются; по умолчанию `/\.(?:[cm]?ts|tsx)$/`.
- `exclude` — регулярное выражение пропускаемых файлов; по умолчанию `/node_modules/`.
- `tsconfig` — путь к `tsconfig.json` относительно корня проекта; по умолчанию ищется ближайший конфиг.
- `base` — имя базового класса для fallback-определения; по умолчанию `"ValidationModel"`. Основной путь — сравнение символа `ValidationModel` из `@ivlev-dev/silent-validation`, имя используется, только если символ пакета не найден.
- `strict` — бросать ошибку вместо предупреждения при неподдерживаемом типе; по умолчанию `false`.

### Поведение

- Модули с query (`?raw`, `?url`, `?vue` и другие) не трансформируются; исключение — безопасные `?import`, `?v`, `?t`, `?direct`.
- `include` полностью заменяет набор по умолчанию; поддержаны `.ts`, `.tsx`, `.mts`, `.cts` и пользовательские регулярные выражения.
- Declaration-файлы (`*.d.ts`) из `tsconfig` остаются в Program, чтобы ambient-классы и типы резолвились.
- Для type-only импорта класса плагин добавляет namespace-импорт, только если у модуля есть рантайм-файл; иначе поле пропускается с диагностикой (в `strict` — ошибка).
- Если код, пришедший в `transform`, изменён сторонним плагином, позиции сдвигаются; при несовпадении содержимого трансформация безопасно пропускается с предупреждением.
- Повторная трансформация того же файла и второй экземпляр плагина не дублируют схему.
- База ищется по всем найденным копиям `@ivlev-dev/silent-validation`; классы в `namespace` и class expression получают квалифицированную ссылку.
- Класс из ambient-модуля без рантайм-реализации пропускается с диагностикой (в `strict` — ошибка); `node:*` и глобальные lib-классы считаются доступными.
- Поля, тип которых ссылается на недоступный класс (`Money`, `Map<string, Money>`), вырезаются из схемы с предупреждением; `Promise<Money>`/`Iterable<Money>` остаются, так как ссылки на класс в схеме нет.
- Program обновляется инкрементально: изменение одного файла не пересоздаёт весь проект.
- `tsconfig` и импортированные типы регистрируются через `addWatchFile`, поэтому их правка инвалидирует кэш; повторная трансформация того же файла не дублирует watch-зависимости.
- Type-only реэкспорт через barrel разрешается до исходного модуля; default-экспорт и class expression получают квалифицированную ссылку.
- `InstanceType<typeof X>` разворачивается в схему класса `X`.
- `Buffer` сериализуется как `uint8array` без структурного обхода; `__proto__` эмитится вычисляемым ключом и не меняет прототип схемы.
- CRLF в исходнике сохраняется; `tsconfig` без входных файлов не прерывает трансформацию.

### Ограничения

- Числовая index-signature (`{ length: number; [n: number]: T }`) учитывается только без именованных свойств. Если у типа есть `length` или другие поля, схема содержит только именованные свойства, а элементы по числовому индексу не проверяются.
- Для `accessor`-полей поддерживаются только identifier-имена: строковые, числовые и вычисляемые имена пропускаются с диагностикой (в `strict` — ошибка). Приватные (`#field`) пропускаются без сообщения.
- Символьные свойства структурных типов пропускаются с диагностикой (в `strict` — ошибка); well-known `Symbol.*` игнорируются без сообщения.
- Ambient-классы без рантайма и объявления из `declare global` пропускаются. Поле, ссылающееся на такой класс, вырезается с диагностикой (в `strict` — ошибка).
- `ArrayLike<T>` принимает массивы и array-like объекты, но элементы array-like объекта по индексу не проверяются — проверяется только `length`. Массивы проверяются поэлементно.
- Generic-, conditional-, template- и indexed-типы без конкретизации не сериализуются: поле пропускается с диагностикой (в `strict` — ошибка).
