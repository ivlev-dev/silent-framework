# @ivlev-dev/silent-di

Асинхронный контейнер зависимостей без декораторов: токены, явные и неявные привязки, скоупы, кеш промисов, обнаружение циклов, `peek`, `has`, `dispose`.

## Модель

### Токены

`Token<T>` — `symbol` с phantom-параметром `T` для типобезопасности. Токен создаётся функцией `createToken<T>(name)`, каждый вызов возвращает новый уникальный символ, `description` равен `name`. Класс также может выступать токеном, когда он передаётся в `bind` или `resolve`.

### Явные привязки (`bind`)

`bind(token, factory?)` регистрирует привязку в текущем контейнере. `factory` принимается в нескольких формах:

- функция-класс (`class`) — инстанциируется через `new` или через статический `[DI_CREATE]`;
- обычная функция — вызывается с контейнером как аргументом;
- константа — сразу кладётся в `resolved`, поэтому `peek`/`peekValue`/`resolveSync` видят её без `resolve`; асинхронная фабрика при этом возвращает то же значение;
- `undefined` — фабрика возвращает `undefined`.

Повторный `bind` того же токена заменяет фабрику и очищает кеш токена в текущем контейнере и во всех потомках; ранее разрешённый инстанс при этом освобождается (см. `[Symbol.dispose]`). Скоуп по умолчанию — `singleton`. Методы `BindingBuilder` меняют скоуп привязки; при смене скоупа кеш токена тоже очищается.

Если эвристика «класс vs фабрика» ошибается (встроенный класс вроде `Map`, bound-класс, ES5-конструктор), `bind` подсказывает решение в тексте ошибки. Для явного выбора формы регистрации используйте:

- `bindClass(token, Ctor)` — всегда создаёт экземпляр через `new` или `[DI_CREATE]`;
- `bindFactory(token, fn)` — всегда вызывает `fn(container)` и никогда не применяет `new`.

Обе формы доступны как методы `Container` и как экспортируемые функции, работающие с глобальным `container` (аналог `bind`).

### Неявные привязки (класс как токен)

Если `resolve` вызван с функцией-классом, для которого нет явной привязки, контейнер автоматически создаёт привязку этого класса как синглтона в контейнере, с которого начался `resolve`, и резолвит её рекурсивно. Классы со статическим свойством `[DI_CREATE]` инстанциируются через него с передачей текущего контейнера. После такого разрешения `has(token)` возвращает `true`.

Поведение неявной привязки управляется режимом `ImplicitBindingMode`, передаваемым через `ContainerOptions` (по умолчанию `"warn"` в development, `"allow"` в production):

- `"allow"` — прежнее поведение: класс автоматически биндится как singleton, без предупреждений.
- `"warn"` — в `console.warn` выводится сообщение с именем зависимости, контейнера и стеком вызовов, после чего выполняется обычный implicit bind.
- `"error"` — `resolve` незабинженного класса отклоняется `MissingBindingError`, экземпляр не создаётся; явные `bind`/`bindValue` работают как обычно. Незабинженный symbol-токен в любом режиме даёт прежнюю ошибку `no binding registered`.

Режим наследуется в дочерние скоупы, созданные через `createScope`. В `createScope` передаётся `{ implicitBindings: this.implicitBindings }`, поэтому дочерний контейнер всегда имеет тот же режим, что и родитель. Установить другой режим для скоупа нельзя — только при создании корневого контейнера.

### `ContainerOptions`

```ts
interface ContainerOptions {
  readonly implicitBindings?: ImplicitBindingMode;
}
```

Описание: опции конструктора `Container`. Поле `implicitBindings` задаёт режим неявных биндингов для контейнера и его потомков. Если не задано, наследуется от родителя; для корневого контейнера используется значение по умолчанию (`"warn"` в development, `"allow"` в production).

Ограничения: опции читаются один раз при создании контейнера; изменить режим после создания нельзя.

### `ImplicitBindingMode`

```ts
type ImplicitBindingMode = "allow" | "warn" | "error";
```

Описание: режим обработки неявных биндингов (класс как токен без явной привязки). Значения: `"allow"`, `"warn"`, `"error"` — см. раздел «Неявные привязки».

Ограничения: строковый union из трёх значений.

### `MissingBindingError`

```ts
class MissingBindingError extends Error {
  readonly token: unknown;
  readonly container: Container;
}
```

Описание: ошибка, отклоняющая `resolve` незабинженного класса в режиме `"error"`. Поле `token` содержит класс/токен, поле `container` — контейнер, в котором attempted resolve. Не создаёт экземпляр класса.

Пример:

```ts
import { Container, MissingBindingError } from "@ivlev-dev/silent-di";

class Service {
  readonly id = 1;
}

const root = new Container("app", undefined, { implicitBindings: "error" });

try {
  await root.resolve(Service);
} catch (error) {
  if (error instanceof MissingBindingError) {
    console.log(error.token === Service); // true
    console.log(error.container === root); // true
  }
}
```

Ограничения: выбрасывается синхронно внутри `bindImplicit`, но `resolve` возвращает отклонённый промис (resolve никогда не бросает синхронно). Имя ошибки — `"MissingBindingError"`.

### `ContainerDisposedError`

```ts
class ContainerDisposedError extends Error {
  readonly container: Container;
}
```

Описание: ошибка обращения к освобождённому контейнеру. Поле `container` содержит сам контейнер. Используется в `assertUsable` (`resolve`, `resolveSync`, `bind`, `createScope` после `dispose`) и для отклонения незавершённых `resolve`, если контейнер освобождён до завершения фабрики. Имя ошибки — `"ContainerDisposedError"`, сообщение — `Container "<name>" has been disposed`.

Пример:

```ts
import { Container, ContainerDisposedError, createToken } from "@ivlev-dev/silent-di";

const root = new Container("app");
const token = createToken<string>("slow");
root.bind(token, async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return "value";
});

const pending = root.resolve(token);
root.dispose();

try {
  await pending;
} catch (error) {
  if (error instanceof ContainerDisposedError) {
    console.log(error.container === root); // true
  }
}
```

Ограничения: ошибка приходит отклонённым промисом из `resolve` и синхронно из `resolveSync`/`bind`/`createScope`. Повторный `dispose()` остаётся no-op. Инстанс, созданный отложенной фабрикой после `dispose`, освобождается один раз, даже если `resolve` уже отклонён: через `[Symbol.dispose]`, а при его отсутствии — методом `dispose()`.

### Интерфейсы и автопоиск реализаций

Рантайм-контейнер работает только с токенами. Автопоиск конкретной реализации интерфейса выполняется компилятором: сканер индекса строит отображение `интерфейс → список реализаций`, и при компиляции конструктора, принимающего интерфейс, подставляется единственная найденная реализация (её класс становится токеном). Ограничения описаны в разделе «Интеграция с компилятором».

### Области видимости

- `singleton` — экземпляр кешируется в контейнере-владельце привязки и разделяется между всеми скоупами, которые обращаются к этой привязке.
- `scoped` — экземпляр кешируется в контейнере, с которого начался `resolve`, и не разделяется между разными скоупами.
- `transient` — после успешного разрешения значение не хранится в долговременном кеше; каждый последующий `resolve` создаёт новый экземпляр. При параллельных вызовах до завершения разрешения разделяется один промис. Transient-инстанс принадлежит вызывающему коду: контейнер не освобождает его ни при rebind, ни при `clearCache`, ни при `dispose`; освобождение — ответственность того, кто получил значение.

Дочерние скоупы создаются через `createScope(name?)` и наследуют привязки родителя.

Фабрика всегда получает контейнер, из которого начался `resolve`, а кеш экземпляра принадлежит владельцу привязки: для `singleton` — контейнеру с `bind`, для `scoped`/`transient` — контейнеру вызова. Если singleton запрошен из другого контейнера, фабрика получает фасад запрашивающего контейнера с тем же `name` и методами; сравнивать его по ссылке с исходным контейнером не следует.

### Captive dependency

`singleton` переживает request scope, поэтому его фабрика не может разрешать `scoped`-токен в контейнере, отличном от владельца singleton. Иначе request-специфичный экземпляр навсегда остался бы в singleton и утёк бы между запросами. Такое разрешение отклоняется `InvalidScopeError`:

```ts
const tenant = createToken<{ id: string }>("Tenant");
root.bind(tenant, () => ({ id: "request" })).inScopedScope();
root.bind(Service, async (c) => new Service(await c.resolve(tenant)));

await root.createScope("request").resolve(Service); // InvalidScopeError
```

Singleton и `scoped` в одном контейнере совместимы: например, ViewModel в `view:*`-скоупе может зависеть от request-scoped сервиса того же view. Для общих данных используйте `singleton`, для данных запроса — отдельный request scope.

### Матрица scope: peek / resolve / resolveSync

Поведение `peek`, `resolve` и `resolveSync` до и после первого успешного разрешения:

| Привязка | До resolve: `peek` | До resolve: `resolveSync` | После resolve: `peek` | После resolve: `resolveSync` | После resolve: `resolve` |
| --- | --- | --- | --- | --- | --- |
| `bindValue(value)` | значение | значение | значение | значение | то же значение |
| `bind(factory)` singleton | `undefined` | бросает | значение (владелец и потомки) | значение | то же значение |
| `bind(factory)` scoped | `undefined` | бросает | значение (только в scope разрешения) | значение (только в scope) | то же значение в том же scope, новое в другом |
| `bind(factory)` transient | `undefined` | бросает | `undefined` | бросает | новый экземпляр каждый раз |

Примечания:
- `bindValue` кладёт значение в `resolved`-кэш владельца сразу при регистрации, поэтому `peek`/`peekValue`/`resolveSync` видят его без `resolve`.
- Singleton-фабрика ленивая: до первого `resolve` `peek` возвращает `undefined`; после успешного разрешения значение видно из дочерних scope через `peek`, потому что кеш принадлежит владельцу (родителю).
- Scoped создаёт экземпляр на scope, в котором начался `resolve`; между scope экземпляры различаются.
- Transient не хранит значение в долговременном кеше: после завершения `resolve` `peek` возвращает `undefined`, `resolveSync` бросает.

### Кеш промисов

Для каждого токена в подходящем контейнере хранится `Promise` разрешения. Параллельные `resolve` одного токена получают один и тот же промис. При ошибке factory кеш очищается, следующий `resolve` повторяет попытку. Транзиент очищает кеш после завершения. `clearCache(token?)`, `bind`, `bindValue` и смена scope сбрасывают кеш и `resolved`-значения, освобождая удалённые инстансы через `[Symbol.dispose]` (одно значение — не более одного раза за операцию; значения, которые остаются под другим токеном, не освобождаются).

Если контейнер освобождается, пока фабрика ещё выполняется, все ожидающие `resolve` этого контейнера отклоняются `ContainerDisposedError`; поздно созданный инстанс освобождается один раз (для `singleton`/`scoped`) через `[Symbol.dispose]`, а при его отсутствии — методом `dispose()`.

### Обнаружение циклов

При рекурсивном разрешении контейнер отслеживает множество токенов, которые сейчас разрешаются. Если токен встречается повторно, `resolve` отклоняется `CircularDependencyError` с полем `path` — массивом токенов в порядке обхода. Защита от captive-зависимостей проверяется до создания экземпляра, поэтому ошибочная конфигурация не оставляет частично закешированных сервисов.

## API

### `Container`

Сигнатура:

```ts
class Container {
  readonly name: string;
  readonly implicitBindings: ImplicitBindingMode;
  constructor(name?: string, parent?: Container, options?: ContainerOptions);
  bind<T = unknown>(token: unknown, factory?: unknown): BindingBuilder;
  bindClass<T = unknown>(token: unknown, ctor: new (...args: never[]) => T): BindingBuilder;
  bindFactory<T = unknown>(token: unknown, factory: Factory<T>): BindingBuilder;
  bindValue<T>(token: unknown, value: T): void;
  resolve<T = unknown>(token: unknown): Promise<T>;
  resolveSync<T = unknown>(token: unknown): T;
  peek<T = unknown>(token: unknown): T | undefined;
  peekValue<T = unknown>(token: unknown): T | undefined;
  has(token: unknown): boolean;
  hasExplicit(token: unknown): boolean;
  createScope(name?: string): Container;
  snapshot(): ContainerSnapshot;
  clearCache(token?: unknown): void;
  onDispose(fn: () => void): void;
  dispose(): void;
}
```

Описание: асинхронный контейнер зависимостей. Хранит привязки, кеш и дочерние скоупы. При передаче `parent` привязки разрешаются с учётом иерархии родителя, а сам контейнер регистрируется как ребёнок родителя. `bindValue` регистрирует готовое значение и сразу кладёт его в `resolved`, поэтому `peek`/`peekValue` синхронно возвращают его без `resolve`. `bindClass` всегда создаёт класс через `new`/`[DI_CREATE]`, `bindFactory` всегда вызывает функцию-фабрику и никогда не применяет `new`. Поле `implicitBindings` содержит текущий режим неявных биндингов (`"allow"`, `"warn"` или `"error"`), унаследованный при создании скоупа через `createScope`.

Пример:

```ts
import { Container, createToken } from "@ivlev-dev/silent-di";

const root = new Container("root");
const token = createToken<string>("value");
root.bind(token, () => "hello");
const scope = root.createScope("request");
const value = await scope.resolve(token);
```

Ограничения: `resolve` никогда не бросает синхронно — ошибки disposed-контейнера, неизвестного токена и `undefined` приходят отклонённым промисом. `resolveSync` читает только уже разрешённое значение и выбрасывает синхронно, если оно ещё не готово. Контейнер не потокобезопасен в смысле реентерабельности — вызовы должны быть асинхронными через промисы.

### `ContainerSnapshot`

Сигнатура:

```ts
interface ContainerSnapshot {
  readonly name: string;
  readonly disposed: boolean;
  readonly parent: string | null;
  readonly scopes: number;
  readonly bindings: number;
  readonly resolved: number;
  readonly resolving: number;
  readonly children: readonly ContainerSnapshot[];
}
```

Описание: снимок контейнера и его дочерних скоупов, который возвращает `Container.snapshot()`. Поля `scopes`, `bindings`, `resolved` и `resolving` агрегируют значения по всему поддереву. Снимок содержит только имена и числа: ссылки на контейнеры, токены и инстансы не удерживаются, поэтому он безопасен для DevTools и диагностики.

Пример:

```ts
const root = new Container("root");
root.createScope("request");
console.log(root.snapshot().scopes); // 1
```

Ограничения: глубина обхода ограничена 64 уровнями; узлы глубже лимита не попадают в `children` (и их счётчики не агрегируются), отдельного флага «дерево обрезано» в `ContainerSnapshot` нет — это известное ограничение диагностического снимка. Для disposed-контейнера возвращается пустое дерево и нулевые счётчики.

### `container`

Сигнатура:

```ts
const container: Container;
```

Описание: глобальный корневой экземпляр `new Container("root")`, с которого начинается разрешение в приложении.

Пример:

```ts
import { container, createToken } from "@ivlev-dev/silent-di";

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

Описание: ошибка, выбрасываемая при обнаружении циклической зависимости во время `resolve`. Поле `path` содержит массив токенов в порядке обхода и завершается токеном, на котором цикл замкнулся.

Циклы обнаруживаются и в синхронных, и в асинхронных фабриках: контейнер отслеживает цепочку разрешения текущей ветки, поэтому `await` внутри фабрики не скрывает повторный запрос токена.

Пример:

```ts
import { CircularDependencyError, Container, createToken } from "@ivlev-dev/silent-di";

const root = new Container("root");
const a = createToken<unknown>("a");
const b = createToken<unknown>("b");
root.bind(a, (c) => c.resolve(b));
root.bind(b, (c) => c.resolve(a));

try {
  await root.resolve(a);
} catch (error) {
  if (error instanceof CircularDependencyError) {
    console.log(error.path); // [a, b] при синхронном цикле
  }
}
```

Асинхронный цикл замыкается уже после `await`, поэтому в `path` попадает и замыкающий токен:

```ts
root.bind(a, async (c) => {
  await Promise.resolve();
  return c.resolve(b);
});
root.bind(b, async (c) => {
  await Promise.resolve();
  return c.resolve(a);
});

try {
  await root.resolve(a);
} catch (error) {
  if (error instanceof CircularDependencyError) {
    console.log(error.path); // [a, b, a]
  }
}
```

Ограничения: `path` содержит токены (символы или классы), а не их строковые имена. После ошибки кеш промиса и счётчик `resolving` очищаются (`snapshot().resolving === 0`), поэтому повторный `bind` или `resolve` позволяет успешно разрешить токен.

### `DI_CREATE`

Сигнатура:

```ts
const DI_CREATE: unique symbol; // Symbol.for("silent.di.create")
```

Описание: символ, через который класс может предоставить статическую фабрику создания экземпляра, принимающую контейнер. Используется и при явном `bind(Class, Class)`, и при неявном разрешении незабинженного класса.

Пример:

```ts
import { Container, DI_CREATE } from "@ivlev-dev/silent-di";

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
import { createToken } from "@ivlev-dev/silent-di";

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
import type { Token } from "@ivlev-dev/silent-di";

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
import type { ScopeName } from "@ivlev-dev/silent-di";

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
import type { Factory } from "@ivlev-dev/silent-di";
import { Container } from "@ivlev-dev/silent-di";

const factory: Factory<string> = (container: Container) => container.name;
```

Ограничения: синхронный результат автоматически оборачивается в промис при вызове; исключения внутри фабрики отклоняют промис разрешения.

### `bindClass` / `bindFactory`

Сигнатуры:

```ts
function bindClass<T = unknown>(token: unknown, ctor: new (...args: never[]) => T): BindingBuilder;
function bindFactory<T = unknown>(token: unknown, factory: Factory<T>): BindingBuilder;
```

Описание: явные формы регистрации для случаев, когда эвристика `bind` неоднозначна. `bindClass` всегда создаёт экземпляр через `new` или `[DI_CREATE]`; `bindFactory` всегда вызывает функцию и никогда не применяет `new`. Те же операции доступны как методы `Container.bindClass` и `Container.bindFactory`. Экспортируемые функции используют глобальный `container`.

Пример:

```ts
import { bindClass, bindFactory, createToken } from "@ivlev-dev/silent-di";

const mapToken = createToken<Map<string, number>>("Map");
const configToken = createToken<{ mode: string }>("Config");

bindClass(mapToken, Map);
bindFactory(configToken, () => ({ mode: "test" }));
```

Ограничения: `bindClass` ожидает конструктор — стрелочная функция не подойдёт и приведёт к ошибке при `resolve`; `bindFactory` ожидает функцию-фабрику. Не-функция отклоняется `TypeError` уже при регистрации. Скоуп по умолчанию — `singleton`, дальнейшая настройка — через возвращённый `BindingBuilder`.

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
import type { Binding } from "@ivlev-dev/silent-di";

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
import { Container, createToken } from "@ivlev-dev/silent-di";

const root = new Container("root");
const token = createToken<string>("chain");
const builder = root.bind(token, () => "x");
builder.inTransientScope().inSingletonScope();
```

Ограничения: методы идемпотентны только по смыслу скоупа; смена скоупа очищает кеш токена.

### `ContainerResolutionEvent`

Сигнатура:

```ts
interface ContainerResolutionEvent {
  readonly token: unknown;
  readonly tokenName: string;
  readonly container: string;
  readonly owner: string;
  readonly scope: ScopeName;
  readonly implicit: boolean;
  readonly cached: boolean;
}
```

Описание: событие, которое контейнер передаёт глобальному инспектору при каждом найденном биндинге. `tokenName` — человекочитаемое имя токена, `container` — имя контейнера, в котором вызван `resolve`, `owner` — имя владельца биндинга, `implicit` — был ли биндинг создан неявно, `cached` — взят ли уже готовый промис из кеша.

Ограничения: событие не содержит значения зависимости и не эмитится для ошибок поиска биндинга.

### `ContainerResolutionInspector`

Сигнатура:

```ts
type ContainerResolutionInspector = (event: ContainerResolutionEvent) => void;
```

Описание: подписчик на события DI-резолва. Используется devtools для построения графа зависимостей.

Ограничения: одновременно активен только один инспектор.

### `setContainerResolutionInspector`

Сигнатура:

```ts
function setContainerResolutionInspector(
  inspector: ContainerResolutionInspector | null,
): void;
```

Описание: устанавливает или снимает глобальный инспектор DI-резолва. Исключения инспектора подавляются и не влияют на `resolve`.

Пример:

```ts
import { setContainerResolutionInspector } from "@ivlev-dev/silent-di";

setContainerResolutionInspector((event) => {
  console.log(event.tokenName, event.container, event.cached);
});
```

Ограничения: функция не включает devtools-события сама по себе; подписку на `DevtoolsEvent` настраивает `installDevtools()` из `@ivlev-dev/silent-core`.

## Сценарии

### Singleton / transient / scoped

```ts
import { Container, createToken } from "@ivlev-dev/silent-di";

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

### `Container.hasExplicit`

Возвращает `true`, если для токена есть явная привязка (`bind`/`bindValue`) с учётом родителя. Неявные биндинги, созданные автоматически при resolve класса, не учитываются. Не запускает factory. Полезен для проверки, зарегистрирован ли токен явно (например, при strict-режиме).

### `Container.resolveSync`

Возвращает уже разрешённое значение из кеша без асинхронного ожидания. Если токен не разрешён, контейнер disposed или привязки нет — выбрасывает ошибку. Полезен в синхронных участках, где значение гарантированно подготовлено ранее.

### `Container.dispose`

Помечает контейнер как disposed, отклоняет незавершённые `resolve` этого контейнера `ContainerDisposedError`, затем вызывает `onDispose`-хуки в порядке регистрации, освобождает разрешённые инстансы в порядке LIFO (вызывая `[Symbol.dispose]`, если он есть), очищает кеш, привязки и неявные токены, удаляет контейнер из `children` родителя, рекурсивно dispose-ит детей. Повторный вызов не делает ничего. Исключения хуков и `[Symbol.dispose]` не прерывают очистку: после неё выбрасывается первая ошибка или `AggregateError`.

Инстанс, созданный отложенной фабрикой уже после `dispose`, освобождается ровно один раз (`singleton`/`scoped`): вызывается `[Symbol.dispose]`, а если его нет — обычный метод `dispose()`. Если объявлены оба, вызывается только `[Symbol.dispose]` (без двойного освобождения). `transient` принадлежит вызывающему и не освобождается.

### `Container.clearCache`

Без аргумента очищает кеш, `resolved` и `resolving` текущего контейнера и всех потомков. С аргументом-токеном очищает только этот токен в текущем контейнере и потомках. Удалённые инстансы освобождаются через `[Symbol.dispose]`: одно значение — не более одного раза за операцию, ошибки освобождения подавляются и не мешают дальнейшей регистрации. Значение, которое осталось под другим токеном в том же поддереве, не освобождается.

### `Container.onDispose`

Регистрирует хук освобождения. Если контейнер уже disposed, хук выполняется сразу же (симметрично `registerCleanup` в reactivity), а не игнорируется.

### Родительские скоупы и наследование

Дочерний скоуп наследует привязки родителя. Синглтоны привязки родителя кешируются у владельца (родителя) и разделяются между всеми потомками. `clearCache` и `bind` очищают кеш в потомках. `dispose` скоупа не затрагивает родителя.

### Router / Session: bindValue или singleton в корне

Для Router и Session (долгоживущие сервисы, общие для всего приложения) используйте `bindValue` или `bind(...)` с scope `singleton` и регистрируйте в корневом контейнере. Не используйте `inScopedScope()`: `inScopedScope()` создаёт новый экземпляр на каждый view-scope, поэтому Router/Session «размножатся» по каждому view. Токен, зарегистрированный как scoped в корне, при resolve из дочернего view-scope создаст отдельный экземпляр в этом view-scope и не будет разделяться между view.

Пример:

```ts
const root = new Container("app", undefined, { implicitBindings: "error" });
const router = new Router();
const session = new Session();

root.bindValue(RouterToken, router);
root.bind(SessionToken, () => session); // singleton по умолчанию

const viewScope = root.createScope("view:home");
// viewScope.resolve(RouterToken) === router
```

### Поведение после `dispose`

- `has(token)` возвращает `false` (привязки очищены).
- `peek(token)` возвращает `undefined`.
- `resolve(token)` возвращает отклонённый промис `ContainerDisposedError` (`"Container ... has been disposed"`).
- Незавершённые на момент `dispose` `resolve` отклоняются `ContainerDisposedError`, а поздно созданный `singleton`/`scoped`-инстанс освобождается один раз через `[Symbol.dispose]` или `dispose()`.
- `resolveSync(token)`, `createScope()` и `bind()` выбрасывают синхронно `ContainerDisposedError`.
- `onDispose(fn)` выполняет `fn` сразу.
- Вызов `dispose()` повторно — no-op.

## Ошибки

- `CircularDependencyError` — возникает при циклической зависимости. Поле `path: unknown[]` содержит путь из токенов.
- `InvalidScopeError` — singleton-фабрика разрешает `scoped`-токен вне контейнера-владельца; поля `singletonToken`, `scopedToken`, `owner`.
- `MissingBindingError` — в режиме `implicitBindings: "error"` `resolve` незабинженного класса отклоняется этой ошибкой; поля `token`, `container`. Экземпляр не создаётся.
- `ContainerDisposedError` — обращение к освобождённому контейнеру или отклонение незавершённого `resolve` при `dispose`; поле `container`.
- Отсутствующая привязка — `resolve` неизвестного токена (не функции-класса и не зарегистрированного) возвращает отклонённый промис с ошибкой `Error("Async DI: no binding registered for token ...")`.
- Вызов после `dispose` — `resolve` возвращает отклонённый промис с `ContainerDisposedError("Container \"name\" has been disposed")`.
- `bind(token, Ctor)` для встроенного/ES5-класса без `new` — `TypeError` с подсказкой использовать `class`/`bindClass`/`bindFactory`; исходная ошибка доступна в `cause`.
- `resolve(undefined)` — отклонённый промис с `Error("Async DI: resolve<T>() must be transformed by silentwire before runtime")`.

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
