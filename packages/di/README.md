# @ivlev-dev/silent-di

Асинхронный контейнер зависимостей без декораторов: токены, скоупы, кеш промисов и compile-time привязка интерфейсов к реализациям.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-di)](https://www.npmjs.com/package/@ivlev-dev/silent-di)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-di)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-di)](https://www.npmjs.com/package/@ivlev-dev/silent-di)

## Возможности

- DI без декораторов: токены-символы и классы как токены, зависимости как обычные параметры конструктора.
- Автопоиск реализаций: компилятор строит индекс `интерфейс → реализация` и подставляет единственную реализацию на этапе компиляции.
- Скоупы: `singleton`, `scoped`, `transient` и дочерние контейнеры с наследованием привязок.
- Асинхронное разрешение: `resolve` всегда возвращает `Promise`, кеш промисов разделяет параллельные вызовы.
- Детектор циклов: `CircularDependencyError` с путём из токенов.
- Точечное управление: `peek`, `has`, `clearCache(token?)`, `onDispose`-хуки, рекурсивный `dispose`.

## Установка

```bash
pnpm add @ivlev-dev/silent-di
```

```bash
npm install @ivlev-dev/silent-di
```

```bash
yarn add @ivlev-dev/silent-di
```

Требуется Node.js >= 22. Пакет ESM-only (`type: "module"`).

## Быстрый старт

```ts
import { container, createToken } from "@ivlev-dev/silent-di";

const token = createToken<string>("config");

container.bind(token, () => "hello");

const value = await container.resolve<string>(token);

container.dispose();
```

`bind` принимает фабрику в виде функции, класса или константы; по умолчанию привязка — `singleton`. `dispose()` рекурсивно очищает контейнер и все дочерние скоупы.

## Интерфейсы и автопоиск

Рантайм работает с токенами — `Symbol` с phantom-параметром типа. Токен создаётся функцией `createToken`, класс может выступать токеном напрямую, декораторы не нужны:

```ts
import type { Store } from "./store.types";

export class MemoryStore implements Store {}
```

Сканер индекса собирает отображение `интерфейс → список реализаций`. При компиляции конструктора, принимающего интерфейс через `import type`, подставляется единственная найденная реализация — её класс становится токеном:

```ts
import type { Store } from "./store.types";

export class ViewModel {
  constructor(private readonly store: Store) {}
}
```

Чтобы автопоиск сработал, интерфейс нужно импортировать как `import type`. В рантайме компилятор оборачивает классы через статический метод по символу `DI_CREATE` (`Symbol.for("silent.di.create")`) и передаёт туда контейнер для разрешения зависимостей.

Класс без явной привязки при `resolve` автоматически регистрируется как синглтон в контейнере, с которого началось разрешение:

```ts
import { Container } from "@ivlev-dev/silent-di";

class Service {}

const root = new Container("root");
const service = await root.resolve(Service);
root.has(Service);
```

Если интерфейс имеет более одной реализации, используйте явный `bind`.

## Скоупы

Привязки наследуются: скоуп, созданный через `createScope(name?)`, разрешает привязки родителя, а `dispose` скоупа не затрагивает родителя.

```ts
import { Container, createToken } from "@ivlev-dev/silent-di";

const root = new Container("root");

const singletonToken = createToken<object>("singleton");
const scopedToken = createToken<object>("scoped");
const transientToken = createToken<object>("transient");

root.bind(singletonToken, () => ({}));
root.bind(scopedToken, () => ({})).inScopedScope();
root.bind(transientToken, () => ({})).inTransientScope();

const scope = root.createScope("request");

const singletonA = await scope.resolve(singletonToken);
const singletonB = await root.resolve(singletonToken);

const scopedA = await scope.resolve(scopedToken);
const scopedB = await scope.resolve(scopedToken);

const transientA = await root.resolve(transientToken);
const transientB = await root.resolve(transientToken);
```

- `singleton` — экземпляр кешируется в контейнере-владельце привязки и разделяется между всеми скоупами (`singletonA === singletonB`).
- `scoped` — экземпляр кешируется в контейнере, с которого начался `resolve` (`scopedA === scopedB` внутри одного скоупа, но не между скоупами).
- `transient` — каждый последовательный `resolve` создаёт новый экземпляр; параллельные вызовы до завершения разрешения разделяют один промис.

## Ошибки и защита

- `CircularDependencyError` — выбрасывается при циклической зависимости; поле `path` содержит токены в порядке обхода.
- Отсутствующая привязка — `resolve` неизвестного токена выбрасывает ошибку `Async DI: no binding registered for token ...`.
- После `dispose()` — `resolve` выбрасывает ошибку, `has` возвращает `false`, `peek` возвращает `undefined`, повторный `dispose` — no-op.
- `resolve(undefined)` — выбрасывает ошибку `Async DI: resolve<T>() must be transformed by silentwire before runtime`.
- При ошибке фабрики кеш токена очищается, следующий `resolve` повторяет попытку.
- `clearCache()` без аргумента сбрасывает кеш текущего контейнера и всех потомков; `clearCache(token)` — только один токен.

```ts
import { CircularDependencyError, Container, createToken } from "@ivlev-dev/silent-di";

const root = new Container("root");
const token = createToken<never>("parent");

const scope = root.createScope("loop");
scope.bind(token, (c: Container) => c.resolve(token));

try {
  await scope.resolve(token);
} catch (error) {
  if (error instanceof CircularDependencyError) {
    console.log(error.path.length);
  }
}
```

## API

| Символ | Назначение |
| --- | --- |
| `Container` | Асинхронный контейнер: `bind`, `resolve`, `createScope`, `peek`, `has`, `clearCache`, `onDispose`, `dispose` |
| `container` | Глобальный корневой экземпляр `Container("root")` |
| `createToken` | Создаёт типизированный токен (`symbol` c phantom-типом `T`) |
| `Token` | Тип токена: `symbol` c phantom-параметром `T` |
| `DI_CREATE` | Рантайм-символ `Symbol.for("silent.di.create")` для инстанциирования классов компилятором |
| `CircularDependencyError` | Ошибка циклической зависимости с полем `path` |
| `ScopeName` | Тип скоупа: `"singleton"`, `"transient"`, `"scoped"` |
| `Factory` | Фабрика: `(container: Container) => T | Promise<T>` |
| `Binding` | Привязка: `factory` + `scope` |
| `BindingBuilder` | Строитель скоупа привязки: `inSingletonScope`, `inTransientScope`, `inScopedScope` |

Подробнее — в [справочнике API](https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/di.md).

## Ограничения и совместимость

- ESM-only: экспорт только через `import` (`"type": "module"`).
- Node.js >= 22.
- Синхронных вызовов нет: `resolve` всегда возвращает `Promise`.
- Интерфейс должен иметь ровно одну реализацию в индексе; иначе — явный `bind`.
- Сложные re-export и generic-типы в DI требуют ручной привязки.
- Автопоиск работает только через компилятор Silent Framework; рантайм сам по себе резолвит только токены и классы.
- Глобальный `container` один на процесс; для изоляции используйте дочерние скоупы или собственный `Container`.

## Ссылки

- Репозиторий: https://github.com/ivlev-dev/silent-framework
- Документация API: https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/di.md
- CHANGELOG: https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md
- Issues: https://github.com/ivlev-dev/silent-framework/issues

---

MIT © ivlev-dev
