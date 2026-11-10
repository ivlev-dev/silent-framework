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
- `onDispose(fn)` — регистрирует хук, вызываемый при `dispose`.
- `dispose()` — рекурсивно очищает контейнер и все дочерние скоупы; повторный вызов — no-op. После `dispose` `resolve` выбрасывает ошибку, `has` возвращает `false`, `peek` — `undefined`.

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

`RequestId` будет одинаковым внутри скоупа и разным между запросами.

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

## Ограничения

- ESM-only: пакет экспортируется только через `import` (`"type": "module"`).
- Node.js >= 22.
- Синхронных вызовов нет: `resolve` всегда возвращает `Promise`.
- `resolve(undefined)` требует трансформации Silent Wire/компилятора; без трансформации выбрасывается ошибка.
- Глобальный `container` один на процесс; для изоляции используйте дочерние скоупы или собственный `Container`.
- Интерфейс должен иметь ровно одну реализацию в индексе, иначе — явный `bind`.
- Автопоиск работает только через компилятор Silent Framework; рантайм сам резолвит токены и классы.