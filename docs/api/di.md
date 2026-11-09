# @silent/di

Асинхронный контейнер зависимостей без декораторов: токены, явные и неявные привязки, скоупы, кеш промисов, обнаружение циклов, `peek`, `has`, `dispose`.

## Модель

### Токены

`Token<T>` — `symbol` с phantom-параметром `T` для типобезопасности. Токен создаётся функцией `createToken<T>(name)`, каждый вызов возвращает новый уникальный символ, `description` равен `name`. Класс также может выступать токеном, когда он передаётся в `bind` или `resolve`.

### Явные привязки (`bind`)

`bind(token, factory?)` регистрирует привязку в текущем контейнере. `factory` принимается в нескольких формах:

- функция-класс (`class`) — инстанциируется через `new` или через статический `[DI_CREATE]`;
- обычная функция — вызывается с контейнером как аргументом;
- константа — оборачивается в асинхронную фабрику, возвращающую это значение;
- `undefined` — фабрика возвращает `undefined`.

Повторный `bind` того же токена заменяет фабрику и очищает кеш токена в текущем контейнере и во всех потомках. Скоуп по умолчанию — `singleton`. Методы `BindingBuilder` меняют скоуп привязки; при смене скоупа кеш токена тоже очищается.

### Неявные привязки (класс как токен)

Если `resolve` вызван с функцией-классом, для которого нет явной привязки, контейнер автоматически создаёт привязку этого класса как синглтона в контейнере, с которого начался `resolve`, и резолвит её рекурсивно. Классы со статическим свойством `[DI_CREATE]` инстанциируются через него с передачей текущего контейнера. После такого разрешения `has(token)` возвращает `true`.

### Интерфейсы и автопоиск реализаций

Рантайм-контейнер работает только с токенами. Автопоиск конкретной реализации интерфейса выполняется компилятором: сканер индекса строит отображение `интерфейс → список реализаций`, и при компиляции конструктора, принимающего интерфейс, подставляется единственная найденная реализация (её класс становится токеном). Ограничения описаны в разделе «Интеграция с компилятором».

### Области видимости

- `singleton` — экземпляр кешируется в контейнере-владельце привязки и разделяется между всеми скоупами, которые обращаются к этой привязке.
- `scoped` — экземпляр кешируется в контейнере, с которого начался `resolve`, и не разделяется между разными скоупами.
- `transient` — после успешного разрешения значение не хранится в долговременном кеше; каждый последующий `resolve` создаёт новый экземпляр. При параллельных вызовах до завершения разрешения разделяется один промис.

Дочерние скоупы создаются через `createScope(name?)` и наследуют привязки родителя.

### Кеш промисов

Для каждого токена в подходящем контейнере хранится `Promise` разрешения. Параллельные `resolve` одного токена получают один и тот же промис. При ошибке factory кеш очищается, следующий `resolve` повторяет попытку. Транзиент очищает кеш после завершения. `clearCache(token?)` сбрасывает кеш и `resolved`-значения.

### Обнаружение циклов

При рекурсивном разрешении контейнер отслеживает множество токенов, которые сейчас разрешаются. Если токен встречается повторно, выбрасывается `CircularDependencyError` с полем `path` — массивом токенов в порядке обхода.

## API

### `Container`

Сигнатура:

```ts
class Container {
  readonly name: string;
  constructor(name?: string, parent?: Container);
  bind<T = unknown>(token: unknown, factory?: unknown): BindingBuilder;
  resolve<T = unknown>(token: unknown): Promise<T>;
  peek<T = unknown>(token: unknown): T | undefined;
  has(token: unknown): boolean;
  createScope(name?: string): Container;
  clearCache(token?: unknown): void;
  onDispose(fn: () => void): void;
  dispose(): void;
}
```

Описание: асинхронный контейнер зависимостей. Хранит привязки, кеш и дочерние скоупы. При передаче `parent` привязки разрешаются с учётом иерархии родителя, а сам контейнер регистрируется как ребёнок родителя.

Пример:

```ts
import { Container, createToken } from "@silent/di";

const root = new Container("root");
const token = createToken<string>("value");
root.bind(token, () => "hello");
const scope = root.createScope("request");
const value = await scope.resolve(token);
```

Ограничения: после `dispose()` любой вызов `resolve` выбрасывает ошибку. `resolve(undefined)` запрещён и выбрасывает ошибку. Контейнер не потокобезопасен в смысле реентерабельности — вызовы должны быть асинхронными через промисы.

### `container`

Сигнатура:

```ts
const container: Container;
```

Описание: глобальный корневой экземпляр `new Container("root")`, с которого начинается разрешение в приложении.

Пример:

```ts
import { container, createToken } from "@silent/di";

const token = createToken<number>("answer");
container.bind(token, () => 42);
const value = await container.resolve<number>(token);
```

Ограничения: один на весь процесс, разделяется всеми потребителями. Для изоляции используйте дочерние скоупы.

### `CircularDependencyError`

Сигнатура:

```ts
class CircularDependencyError extends Error {
  readonly path: unknown[];
}
```

Описание: ошибка, выбрасываемая при обнаружении циклической зависимости во время `resolve`. Поле `path` содержит массив токенов в порядке обхода.

Пример:

```ts
import { CircularDependencyError, Container, createToken } from "@silent/di";

const root = new Container("root");
const a = createToken<unknown>("a");
const b = createToken<unknown>("b");
root.bind(a, (c) => c.resolve(b));
root.bind(b, (c) => c.resolve(a));

try {
  await root.resolve(a);
} catch (error) {
  if (error instanceof CircularDependencyError) {
    console.log(error.path); // [a, b]
  }
}
```

Ограничения: `path` содержит токены (символы или классы), а не их строковые имена. Повторный `bind` после ошибки очищает состояние и позволяет успешно разрешить токен.

### `DI_CREATE`

Сигнатура:

```ts
const DI_CREATE: unique symbol; // Symbol.for("silent.di.create")
```

Описание: символ, через который класс может предоставить статическую фабрику создания экземпляра, принимающую контейнер. Используется и при явном `bind(Class, Class)`, и при неявном разрешении незабинженного класса.

Пример:

```ts
import { Container, DI_CREATE } from "@silent/di";

class Handler {
  readonly origin: string;
  constructor(origin: string) {
    this.origin = origin;
  }
  static [DI_CREATE](from: Container): Handler {
    return new Handler(from.name);
  }
}

const root = new Container("worker");
const instance = await root.resolve<Handler>(Handler);
```

Ограничения: статический метод должен возвращать экземпляр (или промис экземпляра). Если метод отсутствует, класс инстанциируется через `new` без аргументов.

### `createToken`

Сигнатура:

```ts
function createToken<T>(name: string): Token<T>;
```

Описание: создаёт уникальный именованный токен типа `Token<T>`.

Пример:

```ts
import { createToken } from "@silent/di";

const token = createToken<{ id: number }>("user");
```

Ограничения: каждый вызов возвращает новый символ; токены с одинаковым именем не равны.

### `Token`

Сигнатура:

```ts
type Token<T> = symbol & { readonly __type?: T };
```

Описание: тип токена — символ с необязательным phantom-полем для вывода типа. Используется как параметр типа при создании токенов.

Пример:

```ts
import type { Token } from "@silent/di";

const token: Token<number> = createToken<number>("num");
```

Ограничения: phantom-поле не существует в рантайме; тип служит только для типобезопасности.

### `ScopeName`

Сигнатура:

```ts
type ScopeName = "singleton" | "transient" | "scoped";
```

Описание: перечисление поддерживаемых областей видимости привязки.

Пример:

```ts
import type { ScopeName } from "@silent/di";

const scope: ScopeName = "scoped";
```

Ограничения: только три строковых значения.

### `Factory`

Сигнатура:

```ts
type Factory<T> = (container: Container) => T | Promise<T>;
```

Описание: тип фабрики привязки — функция, принимающая контейнер и возвращающая значение или промис значения.

Пример:

```ts
import type { Factory } from "@silent/di";
import { Container } from "@silent/di";

const factory: Factory<string> = (container: Container) => container.name;
```

Ограничения: синхронный результат автоматически оборачивается в промис при вызове; исключения внутри фабрики отклоняют промис разрешения.

### `Binding`

Сигнатура:

```ts
interface Binding<T = unknown> {
  readonly factory: Factory<T>;
  scope: ScopeName;
}
```

Описание: структура внутренней привязки токена. Доступна как тип для аннотаций; поля `factory` и `scope` соответствуют зарегистрированной привязке.

Пример:

```ts
import type { Binding } from "@silent/di";

const binding: Binding<number> = {
  factory: () => 1,
  scope: "singleton",
};
```

Ограничения: интерфейс описывает форму; прямое создание привязок вне контейнера не регистрирует их.

### `BindingBuilder`

Сигнатура:

```ts
interface BindingBuilder {
  inSingletonScope(): BindingBuilder;
  inTransientScope(): BindingBuilder;
  inScopedScope(): BindingBuilder;
}
```

Описание: построитель скоупа, возвращаемый `bind`. Каждый метод меняет скоуп привязки и возвращает тот же объект (цепочка вызовов).

Пример:

```ts
import { Container, createToken } from "@silent/di";

const root = new Container("root");
const token = createToken<string>("chain");
const builder = root.bind(token, () => "x");
builder.inTransientScope().inSingletonScope();
```

Ограничения: методы идемпотентны только по смыслу скоупа; смена скоупа очищает кеш токена.

## Сценарии

### Singleton / transient / scoped

```ts
import { Container, createToken } from "@silent/di";

const root = new Container("root");
const singletonToken = createToken<{ id: number }>("singleton");
const scopedToken = createToken<{ id: number }>("scoped");
const transientToken = createToken<{ id: number }>("transient");

let s = 0, c = 0, t = 0;
root.bind(singletonToken, () => ({ id: ++s }));
root.bind(scopedToken, () => ({ id: ++c })).inScopedScope();
root.bind(transientToken, () => ({ id: ++t })).inTransientScope();

const scope = root.createScope("s");
const a = await scope.resolve(singletonToken);
const b = await root.resolve(singletonToken);
const scopedA = await scope.resolve(scopedToken);
const scopedB = await scope.resolve(scopedToken);
const t1 = await root.resolve(transientToken);
const t2 = await root.resolve(transientToken);
```

### `Container.peek`

Возвращает уже разрешённое значение из кеша без вызова factory. Если значение не разрешено — `undefined`. Для транзиент после успешного resolve — `undefined` (не хранится). Учитывает родителя для синглтонов.

### `Container.has`

Проверяет наличие привязки с учётом родителя. Не запускает factory и не создаёт неявных привязок.

### `Container.dispose`

Помечает контейнер как disposed, вызывает `onDispose`-хуки (сначала контейнера, затем дочерних — в порядке вызова `createScope`/`onDispose`), очищает кеш, привязки и неявные токены, удаляет контейнер из `children` родителя, рекурсивно dispose-ит детей. Повторный вызов не делает ничего.

### `Container.clearCache`

Без аргумента очищает кеш, `resolved` и `resolving` текущего контейнера и всех потомков. С аргументом-токеном очищает только этот токен в текущем контейнере и потомках.

### Родительские скоупы и наследование

Дочерний скоуп наследует привязки родителя. Синглтоны привязки родителя кешируются у владельца (родителя) и разделяются между всеми потомками. `clearCache` и `bind` очищают кеш в потомках. `dispose` скоупа не затрагивает родителя.

### Поведение после `dispose`

- `has(token)` возвращает `false` (привязки очищены).
- `peek(token)` возвращает `undefined`.
- `resolve(token)` выбрасывает ошибку `"Container ... has been disposed"`.
- Вызов `dispose()` повторно — no-op.

## Ошибки

- `CircularDependencyError` — возникает при циклической зависимости. Поле `path: unknown[]` содержит путь из токенов.
- Отсутствующая привязка — `resolve` неизвестного токена (не функции-класса и не зарегистрированного) выбрасывает `Error("Async DI: no binding registered for token ...")`.
- Вызов после `dispose` — `resolve` выбрасывает `Error("Container \"name\" has been disposed")`.
- `resolve(undefined)` — выбрасывает `Error("Async DI: resolve<T>() must be transformed by silentwire before runtime")`.

## Интеграция с компилятором

### Что делает `DI_CREATE`

Компилятор оборачивает конструктор класса статическим методом `[DI_CREATE](container)`, который создаёт экземпляр, подставляя зависимости из контейнера. Рантайм использует этот символ как точку инстанциирования, если он есть; иначе вызывает `new` без аргументов. Символ равен `Symbol.for("silent.di.create")`.

### Сканер индекса

Сканер собирает JSON с двумя ключами:

- `interfaces`: отображение `"/abs/path/types.ts#Store"` → `["/abs/path/memory-store.ts#MemoryStore"]`;
- `values`: список экспортируемых значений модуля, например `["Store", "createStore"]`.

Компилятор использует `interfaces`, чтобы при конструкторе, принимающем интерфейс, подставить единственную реализацию как класс-токен. `values` нужны, чтобы отличить value-токен от интерфейса при `import type`.

### Почему `import type` важен

Если интерфейс импортируется через `import type`, он существует только на уровне типов, и компилятор, используя индекс, заменяет его на value-import конкретной реализации. Без `import type` (обычный import) модуль уже является value-импортом и индекс не применяется. Поэтому зависимости-интерфейсы следует объявлять как `import type`, чтобы автопоиск сработал. Ограничения: интерфейс должен иметь ровно одну реализацию в индексе; иначе используйте явный `bind`. Сложные re-export и generic-типы требуют ручной привязки.
