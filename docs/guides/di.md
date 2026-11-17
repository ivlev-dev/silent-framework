# Dependency Injection

Silent Framework использует асинхронный DI без декораторов: зависимости передаются обычными параметрами конструктора, а контейнер резолвит их как промисы. Три ключевые идеи:

- Токены — `symbol` (через `createToken`) или сам класс; декораторы `@Inject` не нужны.
- Разрешение всегда асинхронное: `resolve` возвращает `Promise<T>`, параллельные вызовы делят один промис.
- Интерфейсы превращаются в реализации на этапе компиляции: импорт через `import type` + индекс `интерфейс → реализация`.

Глобальный корневой контейнер доступен как `container` из `@ivlev-dev/silent-di`; для изоляции (тесты, запросы) создавайте собственный `Container`.

## Токены и bind

Токен задаёт контракт. Два способа создать:

```ts
import { container, createToken } from "@ivlev-dev/silent-di";

const Greeting = createToken<string>("greeting");
container.bind(Greeting, () => "hello");

const value = await container.resolve<string>(Greeting);
```

Класс сам может быть токеном — удобно для сервисов без интерфейса:

```ts
class Logger {
  log(message: string): void {
    console.log(message);
  }
}

const logger = await container.resolve(Logger); // автопривязка singleton
container.has(Logger); // true
```

`bind(token, factory?)` принимает три вида фабрики:

- значение — возвращается как есть;
- функция `(container) => T | Promise<T>` — вызывается при разрешении;
- класс — инстанцируется через `new` или статический `[DI_CREATE]`, если он есть.

Привязка по умолчанию — `singleton`. Скоуп меняют через строитель:

```ts
container.bind(Token, () => ({}));                  // singleton
container.bind(Token, () => ({})).inScopedScope();  // scoped
container.bind(Token, () => ({})).inTransientScope(); // transient
container.bind(Token, () => ({})).inSingletonScope(); // явно singleton
```

Методы `BindingBuilder`: `inSingletonScope`, `inTransientScope`, `inScopedScope`. Повторный `bind` того же токена перезаписывает привязку и очищает кеш токена.

## Интерфейсы и автопоиск

Рантайм работает с токенами; интерфейсы существуют только на уровне типов. Чтобы компилятор подставил единственную реализацию, интерфейс импортируют через `import type`:

```ts
// clock.ts
export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
```

```ts
// timer.vm.ts
import type { Clock } from "./clock";

export class TimerVM {
  constructor(private readonly clock: Clock) {}
}
```

Компилятор, используя индекс `интерфейс → реализация`, заменяет `Clock` на класс `SystemClock`, и `SystemClock` становится токеном. Без `import type` (обычный import) индекс не применяется.

Если у интерфейса больше одной реализации — автопоиск не сработает; используйте явный `bind`:

```ts
container.bind(Clock, FakeClock);
```

Инстанциирование классов со зависимостями выполняется через статический метод `[DI_CREATE]` (`Symbol.for("silent.di.create")`). Рантайм вызывает его, если он есть, иначе — `new` без аргументов. Пример ручного объявления (обычно генерирует компилятор):

```ts
import { DI_CREATE } from "@ivlev-dev/silent-di";
import type { Container } from "@ivlev-dev/silent-di";
import { SystemClock } from "./clock";

class TimerVM {
  readonly clock: SystemClock;

  constructor(clock: SystemClock) {
    this.clock = clock;
  }

  static [DI_CREATE] = async (di: Container): Promise<TimerVM> => {
    return new TimerVM(await di.resolve(SystemClock));
  };
}
```

В сгенерированном коде вместо интерфейса стоит конкретная реализация из индекса (`SystemClock`); вручную импортировать её не требуется.
```

Ограничение: интерфейс должен иметь ровно одну реализацию в индексе; сложные re-export и generic-типы требуют ручной привязки.


### Alias и tsconfig paths

Индекс понимает алиасы и разрешает их так же, как Vite/TypeScript:

- строковые записи из `resolve.alias` Vite (RegExp-алиасы пропускаются);
- `compilerOptions.baseUrl` + `compilerOptions.paths` из `tsconfig.json`, `tsconfig.app.json` или `tsconfig.base.json`.

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

```ts
import type { UsersService } from "@/application/users/service";

export class UsersProbe {
  constructor(private readonly users: UsersService) {}
}
```

Такой `import type` индексируется как относительный: компилятор подставит реализацию `UsersService`. При нескольких подходящих правилах выигрывает самое длинное совпадение. Если алиас не найден, импорт считается внешним пакетом.

## ViewModel и scope

View-компонент получает ViewModel асинхронно через DI:

1. `createComponent` создаёт дочерний scope контейнера (`options.container ?? container`) с именем `view:<имя>`.
2. Создаётся `ComponentContext` и биндится в scope как DI-токен — VM может затребовать его через конструктор.
3. Резолвится `scope.resolve(meta.vm)`; после резолва назначаются `props`, вызываются `created`, `beforeMount`, рендерится view.

```ts
import type { Clock } from "./clock";
import { ViewModel } from "@ivlev-dev/silent-core";

export class CounterVM extends ViewModel<{ step: number }> {
  constructor(
    private readonly clock: Clock,
  ) {
    super();
  }
}
```

`CounterVM` импортируется в view через `import type` — компилятор сам добавит токен.

Scope наследуется вниз: компоненты, вызванные внутри view, получают те же runtime-опции с `container: scope`, поэтому их DI-биндинги видны детям.

`ComponentContext` из `@ivlev-dev/silent-core` — и DI-токен, и источник метаданных view:

```ts
import { ComponentContext } from "@ivlev-dev/silent-core";

export class ContextVM {
  readonly context: ComponentContext<{ count: number }>;

  constructor(context: ComponentContext<{ count: number }>) {
    this.context = context;
  }
}
```

Через контекст VM читает `props`, `container` (дочерний scope), `signal` (`AbortSignal`, прерываемый при dispose view) и `view` (корневой узел после вставки).

## Скоупы и жизненный цикл

`container.createScope(name?)` создаёт дочерний контейнер с наследованием привязок. Привязки родителя доступны, `dispose` дочернего не затрагивает родителя.

Управление кешем и жизненным циклом:

- `peek(token)` — возвращает кешированный экземпляр или `undefined`, не запуская разрешение.
- `has(token)` — есть ли привязка (с учётом родителей и неявных).
- `clearCache()` — сброс кеша текущего контейнера и всех потомков; `clearCache(token)` — только один токен.
- `onDispose(fn)` — регистрирует хук, вызываемый при `dispose` в порядке регистрации.
- `dispose()` — рекурсивно очищает контейнер и все дочерние скоупы; повторный вызов — no-op. Разрешённые инстансы освобождаются в порядке LIFO, у них вызывается `[Symbol.dispose]`, если он есть. Исключения хуков и `[Symbol.dispose]` не прерывают очистку: после неё выбрасывается первая ошибка или `AggregateError`. После `dispose` `resolve` возвращает отклонённый промис, `resolveSync`, `createScope` и `bind` выбрасывают синхронно, `has` возвращает `false`, `peek` — `undefined`.

```ts
const root = new Container("root");
const scope = root.createScope("request");

scope.onDispose(() => {
  // освободить ресурсы запроса
});

await scope.resolve(SomeService);
scope.clearCache(SomeService); // принудительно пересоздать

scope.dispose(); // + все дочерние скоупы
```

Семантика скоупов привязки:

- `singleton` — кешируется в контейнере-владельце привязки, разделяется всеми скоупами.
- `scoped` — кешируется в контейнере, с которого начался `resolve` (внутри одного скоупа одинаков, между скоупами — разный).
- `transient` — каждый завершённый `resolve` создаёт новый экземпляр; параллельные вызовы до завершения разделяют один промис, после чего кеш очищается.

Фабрика получает контейнер, из которого вызван `resolve`, но кеш всегда принадлежит владельцу привязки. Это важно для SSR: глобальный контейнер — process-wide состояние, а request scope — данные одного запроса.

### Captive dependency: singleton и scoped

`singleton` живёт дольше request scope, поэтому его фабрика не может захватить `scoped`-сервис из контейнера короче своей жизни. Такое разрешение отклоняется `InvalidScopeError`:

```ts
const Tenant = createToken<{ id: string }>("Tenant");
const Repo = createToken<Repo>("Repo");

root.bind(Tenant, () => ({ id: "request" })).inScopedScope();
root.bind(Repo, async (c) => new Repo(await c.resolve(Tenant))); // singleton

await root.createScope("request").resolve(Repo); // InvalidScopeError
```

Исправление: сделайте зависимость `singleton`, если она общая для процесса, либо переведите сам сервис в `scoped`/`transient`, чтобы он жил в request scope. Singleton и `scoped` в одном контейнере допустимы — например, ViewModel в `view:*`-скоупе может зависеть от request-scoped сервиса этого view.

## Циклы и ошибки

`CircularDependencyError` выбрасывается при циклической зависимости; поле `path` содержит токены в порядке обхода.

```ts
import { CircularDependencyError, Container, createToken } from "@ivlev-dev/silent-di";

const root = new Container("root");
const token = createToken<never>("node");

const scope = root.createScope("loop");
scope.bind(token, (c) => c.resolve(token));

try {
  await scope.resolve(token);
} catch (error) {
  if (error instanceof CircularDependencyError) {
    console.log(error.path.length);
  }
}
```

Сообщения и поведение:

- Отсутствующая привязка: `Async DI: no binding registered for token ...`
- Контейнер утилизирован: `Container "<name>" has been disposed`
- Нет трансформации: `Async DI: resolve<T>() must be transformed by silentwire before runtime` (при `resolve(undefined)`)
- Captive-зависимость: `InvalidScopeError` с полями `singletonToken`, `scopedToken`, `owner`.
- `resolve` не бросает синхронно: перечисленные ошибки приходят отклонённым промисом. Для синхронного чтения готового значения есть `resolveSync`.
- При ошибке фабрики кеш токена очищается — следующий `resolve` повторяет попытку.

Как чинить циклы: разбейте зависимость через ленивый резолв (вызывать `container.resolve` внутри метода, а не в конструкторе) или вынесите общий код в третий сервис. При необходимости очистите кеш `clearCache(token)` после исправления.

## Рецепты

### 1. Сервис-синглтон

```ts
// logger.ts
export class Logger {
  log(message: string): void {
    console.log(`[app] ${message}`);
  }
}

// app.vm.ts
import type { Logger } from "./logger";
import { ViewModel } from "@ivlev-dev/silent-core";

export class AppVM extends ViewModel {
  constructor(private readonly logger: Logger) {
    super();
  }

  mounted(): void {
    this.logger.log("app mounted");
  }
}
```

`Logger` автоматически привязывается как singleton при первом `resolve`. При необходимости явной регистрации:

```ts
import { container } from "@ivlev-dev/silent-di";
import { Logger } from "./logger";

container.bind(Logger, Logger);
```

### 2. Request-scoped зависимость

```ts
import { Container, createToken } from "@ivlev-dev/silent-di";

const RequestId = createToken<string>("requestId");

const root = new Container("root");

export function handleRequest(id: string): void {
  const scope = root.createScope(`request:${id}`);
  scope.bind(RequestId, () => id).inScopedScope();

  // ... резолв VM и рендер внутри scope

  scope.dispose(); // очистка ресурсов запроса
}
```

`RequestId` будет одинаковым внутри скоупа и разным между запросами. В SSR `renderToString` создаёт такой request scope автоматически от `options.container` и освобождает его после рендера, поэтому вручную оборачивать каждый вызов не нужно.

### 3. Подмена реализации в тестах

Создайте отдельный контейнер и укажите его в `mount`:

```ts
import { Container } from "@ivlev-dev/silent-di";
import { mount } from "@ivlev-dev/silent-core";
import { Counter } from "./counter";

const testContainer = new Container("test");
testContainer.bind(Clock, FakeClock);

void mount("#app", Counter, { container: testContainer, props: { step: 1 } });
```

Тесты не трогают глобальный `container`; после проверки вызовите `testContainer.dispose()`.

### 4. Ленивый async-сервис

```ts
import { container, createToken } from "@ivlev-dev/silent-di";

const Config = createToken<{ apiBase: string }>("config");

container.bind(Config, async () => {
  const response = await fetch("/config.json");
  return (await response.json()) as { apiBase: string };
});

const config = await container.resolve<{ apiBase: string }>(Config);
```

Фабрика вызывается один раз (singleton); при ошибке кеш очищается и повторный `resolve` повторит попытку.

### 5. Конфиг через environment

```ts
import { createToken } from "@ivlev-dev/silent-di";

export const ApiBase = createToken<string>("apiBase");

// при старте приложения
container.bind(ApiBase, () => import.meta.env.VITE_API_BASE ?? "http://localhost:3000");
```

VM получает значение через конструктор, как любой токен:

```ts
export class ApiVM extends ViewModel {
  constructor(private readonly apiBase: string) {
    super();
  }
}
```

(Компилятор подставит реализацию для интерфейса; для value-токена привязку нужно сделать явно, как выше.)

### 6. Router + Session + вложенные ViewModel

Долгоживущие сервисы (Router, Session) регистрируйте в корневом контейнере через `bindValue` или singleton-фабрику, и включайте строгий режим, чтобы неявные биндинги классов не проскальзывали:

```ts
import { Container, createToken } from "@ivlev-dev/silent-di";
import { Router } from "./router";
import { Session } from "./session";

const RouterToken = createToken<Router>("router");
const SessionToken = createToken<Session>("session");

const root = new Container("app", undefined, { implicitBindings: "error" });

const router = new Router();
const session = new Session();

root.bindValue(RouterToken, router);
root.bind(SessionToken, () => session); // singleton по умолчанию
```

Дочерние scope (view-scope) наследуют режим и привязки:

```ts
const viewScope = root.createScope("view:home");
const sameRouter = await viewScope.resolve(RouterToken); // === router
```

Почему не `scoped`: `inScopedScope()` создаёт новый экземпляр на каждый view-scope, поэтому Router/Session «размножатся» по каждому view и потеряют общее состояние. `bindValue`/singleton гарантируют один экземпляр на корень и разделение между всеми view.

### Почему появился второй экземпляр

Если сервис зарегистрирован фабрикой `bind(factory)` со scope `singleton`, он всё равно создаётся лениво — при первом `resolve`. До первого разрешения `peek` возвращает `undefined`, и код, который ожидает «уже готовый» экземпляр, может создать второй через прямой `new` или через отдельный контейнер.

Проверка:

```ts
import { Container, createToken } from "@ivlev-dev/silent-di";
import { Router } from "./router";

const root = new Container("app");
const token = createToken<Router>("router");
root.bind(token, () => new Router()); // singleton, ленивый

console.log(root.peek(token)); // undefined — ещё не разрешён
const first = await root.resolve(token);
console.log(root.peek(token) === first); // true

const scope = root.createScope("view");
console.log(scope.peek(token) === first); // true — singleton виден из скоупа
```

Если нужно гарантировать наличие значения до любого `resolve` (например, Router/Session), используйте `bindValue` — он кладёт значение в `resolved`-кэш сразу:

```ts
import { Container, createToken } from "@ivlev-dev/silent-di";
import { Router } from "./router";

const root = new Container("app");
const token = createToken<Router>("router");

root.bindValue(token, new Router());
console.log(root.peek(token) !== undefined); // true синхронно
console.log(root.resolveSync(token)); // то же значение
```

Типичные причины «второго экземпляра»:
- фабричный `bind` + чтение через `new` в другом месте до `resolve`;
- отдельный контейнер/тестовый контейнер без общей привязки;
- `inScopedScope()` для долгоживущего сервиса — каждый scope получает свой экземпляр;
- `clearCache(token)` или повторный `bind` сбросили кеш.

Чтобы избежать — регистрируйте долгоживущие сервисы в корне через `bindValue`/singleton и разрешайте через контейнер, а не через `new`.

## Ограничения

- ESM-only: пакет экспортируется только через `import` (`"type": "module"`).
- Node.js >= 22.
- Синхронных вызовов нет: `resolve` всегда возвращает `Promise`.
- `resolve(undefined)` требует трансформации Silent Wire/компилятора; без трансформации выбрасывается ошибка.
- Глобальный `container` один на процесс; для изоляции используйте дочерние скоупы или собственный `Container`.
- Интерфейс должен иметь ровно одну реализацию в индексе, иначе — явный `bind`.
- Автопоиск работает только через компилятор Silent Framework; рантайм сам резолвит токены и классы.