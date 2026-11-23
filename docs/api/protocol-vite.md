# @ivlev-dev/silent-protocol-vite

Vite-плагин для `@ivlev-dev/silent-protocol`: читает TS-классы через TypeScript API и вставляет в них статическую схему `Symbol.for("silent.protocol.schema")` и статический кодек `Symbol.for("silent.protocol.codec")`. Кодек побайтово совпадает с generic-кодеком, но работает без рефлексии и компиляции схемы в рантайме.

```ts
import { defineConfig } from "vite";
import { protocol } from "@ivlev-dev/silent-protocol-vite";

export default defineConfig({
  plugins: [protocol()],
});
```

Спецификация формата — [`docs/protocol.md`](../../protocol.md), рантайм — [`docs/api/protocol.md`](./protocol.md).

### Установка

```bash
pnpm add -D @ivlev-dev/silent-protocol-vite
pnpm add @ivlev-dev/silent-protocol
```

- Node.js >= 22, Vite >= 8, ESM-only.
- Плагин ставится в `devDependencies`; `@ivlev-dev/silent-protocol` — обычная зависимость приложения.
- `typescript` и `magic-string` — зависимости плагина, рантайм от них не зависит.
- Поля — публичные `accessor` или обычные свойства класса. Декораторы требуют stage-3 accessor: `experimentalDecorators: false`, `useDefineForClassFields: true`.

### `protocol`

```ts
function protocol(options?: ProtocolPluginOptions): Plugin;
```

Создаёт Vite-плагин с именем `silent-protocol` и `enforce: "pre"`. Трансформация выполняется в `transform` с `order: "pre"` и подключает хуки `configResolved`, `configureServer`, `watchChange`.

```ts
protocol({
  include: /src[\\/].*\.ts$/,
  exclude: /node_modules/,
  tsconfig: "tsconfig.app.json",
  strict: true,
  diagnostics: (message) => console.warn(message),
});
```

### `ProtocolPluginOptions`

| Опция | Тип | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `include` | `RegExp` | `/\.(?:[cm]?ts\|tsx)$/` | Файлы, которые обрабатывает плагин |
| `exclude` | `RegExp` | `/node_modules/` | Пропускаемые файлы |
| `tsconfig` | `string` | ближайший `tsconfig.json` | Путь к конфигу относительно корня Vite |
| `strict` | `boolean` | `false` | Бросать ошибку вместо диагностики |
| `diagnostics` | `boolean \| ProtocolDiagnostics` | `true` | Куда сообщать о неподдерживаемых полях |

`ProtocolDiagnostics` — `(message: string) => void`. При `diagnostics: false` сообщения подавляются, но схема и кодек всё равно генерируются для поддержанных полей. Функция вызывается для каждого уникального сообщения; при значении по умолчанию используется `this.warn` Vite с дедупликацией в пределах TypeScript Program. В `strict` первая же проблема бросает исключение и прерывает сборку.

`include` полностью заменяет набор по умолчанию; поддержаны `.ts`, `.tsx`, `.mts`, `.cts` и произвольные регулярные выражения. `tsconfig` разрешается относительно `config.root`; без опции ищется ближайший конфиг от обрабатываемого файла.

### Что генерируется

Для каждого класса с полями плагин добавляет в конец класса `static { ... }`:

```ts
static {
  const __protoCtor = this;
  this[Symbol.for("silent.protocol.codec")] = {
    write(value, writer, context, path) { /* ... */ },
    read(reader, context, path) {
      const value = new __protoCtor();
      /* ... */
      return value;
    },
  };
  this[Symbol.for("silent.protocol.schema")] = {
    version: 1,
    fields: [
      /* { kind: "field", name, type, optional } */
    ],
    oneofs: [
      /* { kind: "oneof", name, enum, variants } */
    ],
  };
}
```

- Поля и oneof сортируются по имени UTF-8; порядок объявления не важен.
- В схему входят поля текущего класса и всех предков; одноимённое поле потомка переопределяет базовое.
- `version` — `SCHEMA_VERSION` (`1`).
- Если статический кодек для класса невозможен, генерируется только схема — рантайм использует generic-кодек. Это происходит для `Map` с optional-значениями, карт с неканоническим ключом и `Set` с элементом без канонического ключа сортировки (например, `Set<bigint>` или `Set<Class>`).
- Кодек вызывает `writeMessage`/`readMessage`, `writeArray`/`readArray`, `writeOptionalArray`/`readOptionalArray`, `writeMap`/`readMap`, `writeSet`/`readSet` и `ProtocolError` из `@ivlev-dev/silent-protocol`. Импорт помощников добавляется один раз на файл с алиасами `__silent_protocol_<name>`.
- Вложенные классы и enum-дискриминаторы подключаются namespace-импортом `import * as __silent_protocol_N from "..."`, если в исходнике был type-only импорт.

### Поддерживаемые типы

| TS-тип | Схема |
| --- | --- |
| `string` | `"string"` |
| `number` | `"float64"` (уточняется декоратором) |
| `boolean` | `"bool"` |
| `bigint` | `"bigint"` |
| `Date` | `"date"` |
| `Uint8Array`, `Buffer` | `"bytes"` (`bytesView: "uint8"`) |
| `ArrayBuffer` | `"bytes"` (`bytesView: "arraybuffer"`) |
| `Int8Array`…`BigUint64Array` | `"bytes"` (`bytesView: "view"`) |
| `Array<T>`, `ReadonlyArray<T>` | `["array", T]` |
| кортеж `[A, B]` | `["tuple", [A, B]]` |
| `Map<K, V>`, `ReadonlyMap<K, V>` | `["map", K, V]` |
| `Set<T>`, `ReadonlySet<T>` | `["set", T]` |
| `Record<string, T>` | `["map", "string", T]` с `record: true` |
| enum | `["enum", значения]` или литерал для одного значения |
| строковый/числовой литерал | `["literal", значение]` |
| `T \| null \| undefined` | `["optional", T]` и `optional: true` |
| `true \| false` | `"bool"` |
| вложенный класс | `["class", () => Ctor]` |
| `null` / `undefined` | `["literal", null]` |

Enum кодируется числом или индексом строкового значения. Строковые enum допустимы как обычные поля, но не как дискриминатор oneof.

### Декораторы

Плагин читает декораторы из AST, рантайм-поведение обеспечивают декораторы `@ivlev-dev/silent-protocol`.

| Декоратор | Результат |
| --- | --- |
| `Int32()` | `number` → `"int32"` |
| `Uint32()` | `number` → `"uint32"` |
| `Float32()` | `number` → `"float32"` |
| `Fixed32()` | `number` → `"fixed32"` |
| `Fixed64()` | `number` или `bigint` → `"fixed64"` |
| `Uint64()` | `number` или `bigint` → `"uint64"` |
| `Int64()` | только `bigint` → `"bigint"` |
| `EpochMillis()` | `number` или `Date` → `"date"` |
| `OneOf(value)` | optional-поле становится вариантом oneof |

`@Int64` на `number` — диагностика (в `strict` — ошибка). `@EpochMillis` на других типах, несовместимый wire-декоратор и повторный `@OneOf` также дают диагностику. Декоратор без соответствующего поля в схеме игнорируется.

### oneof-группы

Поддержаны два способа:

- явный: поле-дискриминатор с числовым enum и optional-поля с `@OneOf(Enum.Member)`;
- неявный: дискриминатор и optional-поля, имена которых совпадают с `lowerCamel`-именами членов enum.

```ts
enum Kind {
  Created = 1,
  Updated = 2,
}

class Event {
  public accessor kind: Kind = Kind.Created;
  public accessor created: string | undefined = undefined;
  public accessor updated: number | undefined = undefined;
}
```

Правила и ограничения:

- дискриминатор — непустое enum-поле, не optional;
- каждый вариант — optional-поле; unit-вариант — `null`, `undefined` или литерал;
- значения одного oneof уникальны, поле-вариант не может принадлежать нескольким дискриминаторам;
- `@OneOf` должен ссылаться ровно на один числовой enum-дискриминатор;
- строковые значения enum в oneof не поддерживаются;
- oneof занимает позицию дискриминатора, варианты не входят в bitmap.

### Ограничения

- Union без enum-дискриминатора, `any`, `unknown`, type parameters, intersection-типы.
- Функции, `Promise`, `WeakMap`, `WeakSet`, `RegExp`, `URL`, `URLSearchParams`, `Error`, `DataView` как самостоятельные типы.
- Rest- и variadic-кортежи; необязательные ключи `Map`; optional-элементы `Set`.
- Ключи `Map`: `string`, `bool`, целые числа, числовой enum. `float`, `bytes`, классы — диагностика.
- `Map` без параметров, `Set` без параметра, `Record` без значения, массивы без типа элемента.
- Объектные типы без класса (кроме `Record` со строковым индексом) не сериализуются: используйте класс.
- Рекурсивные типы и превышение глубины сериализации схемы.
- Ambient-классы без рантайма и объявления из `declare global`; поле, ссылающееся на такой класс, вырезается с диагностикой.
- Небезопасные имена экспортов (например, строковый alias) не попадают в сгенерированный код.
- Поля с неподдерживаемым типом вырезаются из схемы; в `strict` вместо диагностики бросается ошибка.

### Идемпотентность и type-only

- Повторный `transform` того же исходника даёт тот же результат; уже сгенерированный код при повторной передаче возвращает `null` и не дублирует блоки.
- Признак готовой схемы — `static {` вместе с маркером `Symbol.for("silent.protocol.schema")`; объявление, в тексте которого уже есть `silent.protocol.schema` или `silent.protocol.codec`, пропускается.
- Второй экземпляр плагина в цепочке не создаёт дубликаты.
- Type-only импорт класса или enum разрешается до исходного модуля; namespace-импорт добавляется только при наличии рантайм-файла. Класс из ambient-модуля без реализации пропускается с диагностикой.
- Класс из пакета с отдельными `@types` считается доступным, если существует рантайм-пакет; `node:*` и глобальные lib-классы доступны.
- Class expression, default-экспорт и классы в `namespace` получают квалифицированную ссылку.
- Type-only реэкспорт через barrel разрешается до исходного модуля.

### Модули и query

- Виртуальные модули (`\0`, `virtual:`) не трансформируются.
- Declaration-файлы (`*.d.ts`, `*.d.mts`, `*.d.cts`) пропускаются.
- `include`/`exclude` проверяются по очищенному от query пути.
- Разрешены только безопасные query-ключи `?import`, `?v`, `?t`, `?direct`; `?raw`, `?url`, `?vue` и остальные пропускаются. Поэтому `import text from "./model.ts?raw"` не меняет содержимое raw-модуля.
- Файлы без подстроки `class` пропускаются до создания TypeScript Program.
- Если сторонний плагин изменил код до `silent-protocol`, позиции сдвигаются; при несовпадении исходного текста трансформация безопасно пропускается с предупреждением.

### Кэш и инкрементальность

- TypeScript Program кешируется по пути `tsconfig`; изменение файла инвалидирует только затронутый Program, `oldProgram` используется для повторного создания.
- `tsconfig` и импортированные типы регистрируются через `addWatchFile`, поэтому их правка инвалидирует кэш.
- Добавление и удаление файлов перезагружает проект; изменение `*.json` очищает все Program.
- Предупреждения дедуплицируются в пределах Program.

### Отключение и fallback

- Убрать `protocol()` из `plugins` или исключить файлы через `exclude` — схема не генерируется, класс не кодируется, пока схема не задана вручную.
- Без плагина используйте `defineProtocol(Ctor, schema)`; рантайм пойдёт generic-путём.
- Если плагин сгенерировал только схему (static-кодек неподдерживаем), `encode`/`decode` автоматически используют generic-кодек.
- Поле, которое не удалось сериализовать, удаляется из схемы; если полей не осталось, блок не генерируется и файл не меняется.
- `strict: false` оставляет сборку рабочей, `strict: true` превращает диагностику в ошибку.
- `diagnostics: false` отключает сообщения, не отключая генерацию.

### `generateProtocolBlocks`

```ts
import ts from "typescript";
import { generateProtocolBlocks } from "@ivlev-dev/silent-protocol-vite";

const program = ts.createProgram(["src/model.ts"], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
});
const checker = program.getTypeChecker();
const sourceFile = program.getSourceFile("src/model.ts")!;

const blocks = generateProtocolBlocks({
  sourceFile,
  checker,
  runtimeRef: () => ({ kind: "ok", reference: "Model" }),
});
```

Программный API без Vite. Принимает `ProtocolCodegenOptions` и возвращает `ProtocolBlock[]`; пустой массив — генерировать нечего. Каждый блок содержит `position` (позиция закрывающей скобки класса), `code` (`static { ... }`), `className`, `fields`, `oneofs`, `helpers`.

- `runtimeRef(symbol)` возвращает `{ kind: "ok", reference }` или `{ kind: "error", reason }`; ссылка должна быть безопасным JS-идентификатором (допускается dotted-путь).
- `diagnostics` — тот же колбэк, что и в плагине; `strict` бросает вместо сообщения.
- `shouldGenerate(declaration)` позволяет отфильтровать классы и class expression.
- `helpers` содержит имена импортов `@ivlev-dev/silent-protocol`, которые нужно добавить в файл.

### `protocolHelperAlias` и `PROTOCOL_MODULE`

- `PROTOCOL_MODULE` — `"@ivlev-dev/silent-protocol"`, модуль, откуда берутся помощники.
- `protocolHelperAlias(name)` — `"__silent_protocol_" + name`, например `protocolHelperAlias("writeMessage")` → `"__silent_protocol_writeMessage"`.

Плагин импортирует помощники с этими алиасами один раз на файл:

```ts
import {
  writeMessage as __silent_protocol_writeMessage,
  readMessage as __silent_protocol_readMessage,
} from "@ivlev-dev/silent-protocol";
```

### Справочник типов

| Тип | Описание |
| --- | --- |
| `ProtocolDiagnostics` | `(message: string) => void` |
| `ProtocolPluginOptions` | Опции `protocol()` |
| `ProtocolCodegenOptions` | Вход `generateProtocolBlocks` |
| `ProtocolBlock` | Сгенерированный блок: позиция, код, класс, поля, oneof, помощники |
| `ProtocolFieldSchema` | `{ name, type: SchemaNode, optional }` |
| `ProtocolVariantSchema` | `{ value, field, type: SchemaNode }` |
| `ProtocolOneofSchema` | `{ name, enumReference, variants }` |
| `ProtocolHelperName` | Имена помощников рантайма |
| `SchemaNode` | Внутреннее узловое представление типа |
| `ProtocolTypeSchema` | Кортежное представление типа (`["array", ...]` и т. п.) |
| `ProtocolPrimitive` | Примитивы схемы, включая `date` и `bigint` |
| `ProtocolLiteral` | `string \| number \| boolean \| null` |
| `BytesView` | `"uint8" \| "arraybuffer" \| "view"` |

### `SchemaNode`

```ts
type SchemaNode =
  | { kind: "primitive"; name: ProtocolPrimitive; bytesView?: BytesView }
  | { kind: "literal"; value: ProtocolLiteral }
  | { kind: "enum"; values: readonly (string | number)[] }
  | { kind: "class"; reference: string }
  | { kind: "array"; element: SchemaNode }
  | { kind: "tuple"; elements: readonly SchemaNode[] }
  | { kind: "map"; key: SchemaNode; value: SchemaNode; record?: true }
  | { kind: "set"; element: SchemaNode }
  | { kind: "optional"; inner: SchemaNode };
```

`ProtocolTypeSchema` — та же информация в кортежной форме, которую принимает `TypeSchema` рантайма: `["array", T]`, `["map", K, V]`, `["optional", T]` и т. д. `ProtocolPrimitive` включает `bool`, `int32`, `uint32`, `int64`, `uint64`, `float32`, `float64`, `fixed32`, `fixed64`, `string`, `bytes`, `date`, `bigint`.
