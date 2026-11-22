# @ivlev-dev/silent-reactivity

Гранулярный граф сигналов с глубокими прокси для объектов и массивов — ядро реактивности Silent Framework.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-reactivity)](https://www.npmjs.com/package/@ivlev-dev/silent-reactivity)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-reactivity)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-reactivity)](https://www.npmjs.com/package/@ivlev-dev/silent-reactivity)

## Возможности

- Сигналы, мемо, эффекты с точным отслеживанием зависимостей без виртуального DOM.
- Мемо ленивые: не вычисляются до первого чтения; наблюдатели уведомляются только при реальном изменении значения (с учётом `equals`).
- `batch` объединяет несколько записей в один прогон, `flushSync` — принудительный синхронный flush.
- Ошибки эффектов изолированы: один упавший эффект не срывает flush, ошибка уходит в `setEffectErrorHandler` (по умолчанию `console.error`) вместе с `owner` сбойного вычисления.
- Первый прогон эффекта согласован с последующими: запись в источник, прочитанный в том же прогоне, помечает эффект грязным и перезапускает его.
- Превышение лимита flush — диагностика, а не падение: runaway-эффект отключается, ошибка уходит в `setEffectErrorHandler`, остальные эффекты продолжают обновляться.
- Ошибки мемо не кешируются: после исключения мемо пересчитывается при следующем чтении, циклические мемо дают `CircularComputationError`. Если мемо бросила при проверке `CHECK`, эффект восстанавливается и продолжает реагировать на другие зависимости, а ошибка уходит в `setEffectErrorHandler`.
- Ошибка cleanup не прерывает остальные cleanup-и и dispose детей. При rerun/каскаде она репортится в `setEffectErrorHandler`, а прямой `dispose()` выбрасывает первую ошибку или `AggregateError`.
- Глубокая реактивность: отдельный сигнал на каждое свойство, индекс и `length` массива; мутирующие методы (`push`, `splice`, `sort`, `reverse` и др.) уведомляют только затронутые индексы.
- `deepReactive` авто-оборачивает plain-объекты, массивы, `Map`/`Set`; экземпляры пользовательских классов не оборачиваются (реактивность классов — через `@reactive`/`@Field` и store).
- Реактивные `Map` и `Set`: `get`/`has`/`size` и итерация отслеживаются по ключу, `markRaw` исключает значение из проксирования, `readonly` создаёт глубокий read-only слой.
- Владельцы (`createRoot`, `getOwner`, `runWithOwner`) и `onCleanup` для автоматической очистки эффектов и подписок.
- Store-примитивы для привязки реактивности к экземплярам классов: `readField`, `writeField`, `getComputed`, `copyReactiveState`.

## Установка

```bash
pnpm add @ivlev-dev/silent-reactivity
```

```bash
npm install @ivlev-dev/silent-reactivity
```

```bash
yarn add @ivlev-dev/silent-reactivity
```

Пакет распространяется только как ESM (`type: "module"`) и не имеет рантайм-зависимостей.

## Быстрый старт

```ts
import { createEffect, createRoot, createSignal, onCleanup } from "@ivlev-dev/silent-reactivity";

createRoot((dispose) => {
  const [count, setCount] = createSignal(0);

  createEffect(() => {
    console.log("count:", count());
  });

  onCleanup(() => console.log("cleanup"));

  setCount(1);
  setCount(2); // эффект увидит только итоговое значение — flush в микротаске

  dispose(); // вызовет onCleanup и уничтожит эффекты поддерева
});
```

`Setter` принимает значение или функцию-апдейтер: `setCount((prev) => prev + 1)`. Апдейтер читает предыдущее значение через `peek()` и не регистрирует зависимость.

## Мемо и батчинг

```ts
import { batch, createMemo, createSignal, untrack } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(2);
const [factor, setFactor] = createSignal(3);

const product = createMemo(() => count() * factor());

product(); // лениво: вычисляется при первом чтении

product() === 6;

batch(() => {
  setCount(10);
  setFactor(4);
  setFactor(5);
});
// один прогон: промежуточные значения factor не видны эффектам

untrack(() => {
  // чтение count() внутри untrack не регистрирует зависимость
  console.log(count());
});
```

Можно задать свою функцию равенства: `createMemo(() => fn(), { equals: (a, b) => a.id === b.id })`.

## Глубокие прокси и массивы

`deepReactive` лениво оборачивает plain-объекты и массивы в прокси с сигналом на каждое свойство. Изменение `state.user.name` не трогает эффекты, читающие `state.user.address.city`.

```ts
import { createEffect, deepReactive, isReactive, on, unwrap } from "@ivlev-dev/silent-reactivity";

const state = deepReactive({
  user: {
    name: "Ann",
    tags: ["a", "b"],
  },
});

createEffect(() => {
  console.log(state.user.name);
});

createEffect(() => {
  console.log(state.user.tags.join(", "));
});

// уведомляются только индексы от 1 и length, а не всё состояние
state.user.tags.push("c");
state.user.tags.splice(0, 1);

console.log(isReactive(state.user), state.user.tags); // true true
console.log(unwrap(state.user)); // исходный объект без прокси
```

`on` запускает функцию при изменении конкретных зависимостей и передаёт `(value, prev)`:

```ts
on(() => state.user.name, (name, prev) => console.log(prev, name));
```

### Map, Set и markRaw

`deepReactive` оборачивает `Map` и `Set`. Зависимости точечные: `get`/`has` подписаны на конкретный ключ, `size` и итерация — на изменение состава, `values`/`entries` — ещё и на значения. Вложенные объекты в ключах и значениях оборачиваются лениво.

```ts
import { deepReactive, isReactive, markRaw, unwrap } from "@ivlev-dev/silent-reactivity";

const cache = deepReactive(new Map<string, { hits: number }>());
cache.set("page", { hits: 0 });
cache.get("page")!.hits += 1; // обновит только наблюдателей ключа "page"
cache.size; // отдельная зависимость

const raw = markRaw({ reason: "third-party" });
deepReactive(raw) === raw; // true, isRaw(raw) === true, isReactive(raw) === false
unwrap(cache) instanceof Map; // true
```

`markRaw` можно применять к объектам, `Map`/`Set` и классам. Экземпляры помеченного класса `deepReactive` не оборачивает.

### readonly

`readonly` создаёт глубокий read-only слой над объектом, массивом, `Map` или `Set`. Вложенные значения тоже read-only, а чтения продолжают отслеживаться, поэтому эффекты обновляются при изменении исходного реактивного значения. Любая мутация (`set`, `delete`, `push`, `add`, `clear`, `Object.defineProperty` и т.п.) бросает `ReadonlyMutationError` (наследник `TypeError`).

```ts
import { deepReactive, isReadonly, readonly } from "@ivlev-dev/silent-reactivity";

const state = deepReactive({ items: [1, 2], map: new Map<string, number>() });
const view = readonly(state);

view.items[0]; // 1
view.map.has("key"); // false

view.items.push(3); // ReadonlyMutationError
isReadonly(view.items); // true
isReactive(view); // false
```

`markRaw`-значения `readonly` не оборачивает и возвращает как есть.

Компоненты store-примитивов привязывают сигналы к экземплярам классов:

```ts
import {
  createReactiveStore,
  getComputed,
  readField,
  registerCleanup,
  writeField,
} from "@ivlev-dev/silent-reactivity";

const store = createReactiveStore();

writeField(instance, "count", () => 0, 5);
readField(instance, "count", () => 0); // реактивное чтение поля

const double = getComputed(instance, "double", () => readField(instance, "count", () => 0) * 2);

registerCleanup(store, () => console.log("store disposed"));
```

Реальная привязка к классам делается в `@ivlev-dev/silent-core` декораторами `@reactive`/`@computed` — пакет то же самое предоставляет как функции.

## Владение и очистка

`createRoot` создаёт корневой `Owner`: все эффекты, мемо и cleanup-функции, зарегистрированные внутри, привязываются к нему и уничтожаются при `dispose`. Обнаружить текущего владельца можно через `getOwner`, а выполнять код в контексте конкретного `Owner` — через `runWithOwner`.

```ts
import {
  createRoot,
  createSignal,
  flushSync,
  getOwner,
  onCleanup,
  runWithOwner,
} from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(0);

const stop = createRoot((dispose) => {
  console.log(getOwner()); // текущий Owner

  onCleanup(() => console.log("root disposed"));

  runWithOwner(getOwner(), () => {
    // эффекты здесь привязаны к внешнему owner, а не к глобальному контексту
  });

  return dispose;
});

setCount(1);
flushSync(); // принудительно прогоняет все запланированные и начальные эффекты сейчас

stop();
```

`createEffect` планирует обновления в микротаске; `createRenderEffect` выполняется синхронно при создании. `flushSync()` прогоняет очередь вручную, минуя микротаску.

## API

| Символ | Назначение |
| --- | --- |
| `createSignal` | Сигнал: пара `[read, set]`, опция `equals` |
| `createMemo` | Ленивое мемо с отслеживанием зависимостей, опции `equals` и `name` |
| `CircularComputationError` | Ошибка циклической зависимости мемо с путём вычисления |
| `setEffectErrorHandler` | Обработчик ошибок эффектов (по умолчанию `console.error`); второй аргумент — `owner` или `null`; `null` отключает вывод |
| `createEffect` | Эффект с автоочисткой зависимостей, обновляется в микротаске |
| `createRenderEffect` | Эффект, выполняющийся синхронно при создании |
| `batch` | Откладывает flush до выхода из самого внешнего `batch` |
| `flushSync` | Принудительный синхронный прогон эффектов |
| `untrack` | Выполняет функцию без регистрации зависимостей |
| `createRoot` | Создаёт корневой `Owner` с функцией `dispose` |
| `getOwner` | Возвращает текущий `Owner` или `null` |
| `runWithOwner` | Выполняет функцию в контексте конкретного `Owner` |
| `onCleanup` | Регистрирует очистку в текущем `Owner` |
| `on` | Запускает функцию на изменение конкретных зависимостей, опция `defer` |
| `deepReactive` | Ленивый глубокий прокси для plain-объектов, массивов, `Map` и `Set` |
| `unwrap` | Возвращает исходный объект из-под прокси (включая `readonly`) |
| `isReactive` | Проверяет, является ли значение прокси `deepReactive` |
| `markRaw` / `isRaw` | Исключает объект, `Map`/`Set` или класс из проксирования |
| `readonly` / `isReadonly` | Глубокий read-only прокси; мутации бросают `ReadonlyMutationError` |
| `ReadonlyMutationError` | Ошибка попытки мутации read-only значения |
| `markReactiveClass` / `isReactiveClass` | Помечает класс как управляющий реактивностью сам: его экземпляры `deepReactive` не оборачивает (используется `@reactive`/`@Field`) |
| `createReactiveStore` | Создаёт самостоятельный `ReactiveStore` |
| `storeFor` | Привязывает store к экземпляру (WeakMap) |
| `readField` / `writeField` | Реактивное чтение и запись поля через store |
| `getComputed` | Мемо на экземпляре, привязанный к lifecycle store |
| `registerCleanup` | Очистка в store (или синхронный вызов, если store disposed) |
| `copyReactiveState` | Переносит сигналы полей между store (используется HMR) |
| `Accessor`, `Setter` | Типы пары `createSignal` |
| `SignalOptions`, `MemoOptions`, `OnOptions` | Типы опций: `equals`, `name`, `defer` |
| `EffectErrorHandler` | Тип обработчика ошибок эффектов |
| `Owner`, `ReactiveStore` | Типы владельца и store |

## Ограничения и совместимость

- Только ESM, Node.js >= 22, без рантайм-зависимостей.
- `deepReactive` оборачивает `Map` и `Set`, но не оборачивает DOM-узлы, `Date`, `WeakMap`, `WeakSet`, `Promise`, `RegExp`, `Error`, буферы и другие не-plain объекты.
- Мутирующие методы массивов (`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`) уведомляют только затронутые индексы и `length`; сигналы ключей обновляются только при изменении состава ключей.
- При удалении свойства сигнал поля не создаётся и удаляется, если у него нет наблюдателей; повторное добавление ключа безопасно.
- `readonly` не оборачивает уже помеченные `markRaw` значения и не-plain объекты; чтение через read-only слой отслеживается, но `isReactive` для него возвращает `false`.
- `deepReactive` автоматически оборачивает только plain-объекты, массивы, `Map`/`Set`; экземпляры пользовательских классов не оборачиваются (иначе ломаются `#private`-поля и accessor-декораторы). Реактивность классов — через `@reactive`/`@Field` (store) или явные `readField`/`writeField`.
- Вложенные значения из frozen/sealed-слотов (non-configurable + non-writable) возвращаются как есть и не реактивны — инвариант `Proxy`.
- `getComputed` запоминает `compute` при первом вызове для ключа; смена функции не пересоздаёт мемо.
- Апдейтер `Setter` использует `peek()` и не регистрирует зависимость; запись с неизменным значением (по `equals`) не уведомляет наблюдателей.
- `createMemo` ленивое: до первого чтения значение не вычисляется.
- Runaway-эффект (больше 1000 запусков за один flush или больше 100 000 суммарных итераций) отключается до пересоздания: ошибка приходит в `setEffectErrorHandler`, пользовательские cleanup не вызываются.

## Ссылки

- Репозиторий: <https://github.com/ivlev-dev/silent-framework>
- Документация: <https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/reactivity.md>
- CHANGELOG: <https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md>
- Баги и предложения: <https://github.com/ivlev-dev/silent-framework/issues>

---

MIT © ivlev-dev
