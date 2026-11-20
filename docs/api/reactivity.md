# @ivlev-dev/silent-reactivity

Пакет содержит примитивы гранулярной реактивности: сигналы, мемо, эффекты, владельцы, батчинг, глубокие прокси и реактивные store. Экспорты пакета используются напрямую и компилятором Silent Framework для `@reactive`, `@computed`, `@watch`.

## Базовые понятия

- **Сигнал (`createSignal`)** — атомарная единица состояния: читается через `Accessor<T>`, изменяется через `Setter<T>`.
- **Мемо (`createMemo`)** — лениво вычисляемое и закешированное значение, которое пересчитывается только при изменении зависимостей.
- **Эффект (`createEffect`, `createRenderEffect`)** — функция, перезапускаемая при изменении прочитанных зависимостей. Оборачивает вычисления трекингом.
- **Владелец (`Owner`)** — узел в графе, связывающий эффекты и мемо с cleanup-функциями и disposal-иерархией.
- **Батчинг (`batch`)** — группировка записей в сигналы с одним отложенным flush.
- **Flush (`flushSync`)** — принудительный прогон очереди эффектов.
- **Глубокий прокси (`deepReactive`)** — прокси над объектом/массивом, создающий отдельный сигнал на каждое свойство, индекс и `length`.
- **Store (`ReactiveStore`)** — хранилище сигналов и вычислений на экземпляр класса, используемое декоратором `@reactive`.

## Экспорты

#### `Accessor`

Стабильность: public

```ts
type Accessor<T> = () => T;
```

Функция без аргументов, возвращающая текущее значение сигнала или мемо. При вызове внутри эффекта/мемо автоматически регистрирует зависимость.

```ts
const read: Accessor<number> = () => 0;
```

Примечание: только чтение; прямое присваивание невозможно.

#### `Setter`

Стабильность: public

```ts
type Setter<T> = (value: T | ((prev: T) => T)) => T;
```

Функция записи в сигнал. Принимает значение или updater-функцию от предыдущего значения и возвращает записанное значение.

```ts
const set: Setter<number> = (v) => (typeof v === "function" ? (v as (p: number) => number)(0) : v);
```

Примечание: updater вызывается с текущим значением через `peek()`.

#### `SignalOptions`

Стабильность: public

```ts
interface SignalOptions<T> {
  equals?: (a: T, b: T) => boolean;
}
```

Опции сигнала. `equals` заменяет сравнение по умолчанию `Object.is`.

```ts
const opts: SignalOptions<number> = { equals: (a, b) => a === b };
```

Примечание: если `equals` возвращает `true`, запись не bump-ит версию и не уведомляет наблюдателей.

#### `MemoOptions`

Стабильность: public

```ts
interface MemoOptions<T> extends SignalOptions<T> {
  name?: string;
}
```

Опции мемо; наследуют `equals` из `SignalOptions`. Необязательное `name` используется в диагностике циклических вычислений и в `CircularComputationError.path`.

```ts
const opts: MemoOptions<number> = { equals: (a, b) => a === b, name: "double" };
```

#### `EffectErrorHandler`

Стабильность: public

```ts
type EffectErrorHandler = (error: unknown, owner: Owner | null) => void;
```

Тип обработчика ошибок эффектов, передаваемого в `setEffectErrorHandler`. Второй аргумент — `Owner` вычисления, в котором произошла ошибка, либо `null` для эффекта, созданного вне контекста владельца. Обработчики с одной сигнатурой остаются совместимыми: лишний аргумент просто игнорируется.

```ts
const handler: EffectErrorHandler = (error, owner) =>
  console.error(error, owner?.disposed);
```

#### `OnOptions`

Стабильность: public

```ts
interface OnOptions {
  defer?: boolean;
}
```

Опции хелпера `on`. `defer: true` пропускает первый вызов `fn` при инициализации.

```ts
const opts: OnOptions = { defer: true };
```

#### `Owner`

Стабильность: public

```ts
interface Owner {
  readonly disposed: boolean;
  dispose(): void;
}
```

Ссылка на узел-владельца. `disposed` отражает состояние, `dispose()` уничтожает поддерево владельца.

```ts
const owner: Owner | null = null;
```

Примечание: получается через `getOwner()`.

#### `ReactiveStore`

Стабильность: public

```ts
interface ReactiveStore {
  readonly disposed: boolean;
  dispose(): void;
}
```

Контейнер сигналов/вычислений экземпляра. Создаётся через `createReactiveStore` или `storeFor`.

```ts
const store: ReactiveStore = createReactiveStore();
```

#### `batch`

Стабильность: public

```ts
function batch<T>(fn: () => T): T;
```

Выполняет `fn`, объединяя записи в сигналы. Flush эффектов происходи́т при выходе из внешнего (depth=0) батча.

```ts
import { batch, createSignal } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(0);
batch(() => {
  setCount(1);
  setCount(2);
});
```

Примечание: вложенные `batch` не запускают flush до выхода из внешнего.

#### `createEffect`

Стабильность: public

```ts
function createEffect(fn: () => void): void;
```

Создаёт эффект. Первый запуск планируется в микротаске; последующие — при изменении зависимостей. Эффект создаёт собственный `Owner`.

```ts
import { createEffect, createSignal } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(0);
createEffect(() => console.log(count()));
```

Примечание: `onCleanup` внутри эффекта выполняется перед повторным запуском и при dispose.

#### `createMemo`

Стабильность: public

```ts
function createMemo<T>(fn: () => T, options?: MemoOptions<T>): Accessor<T>;
```

Создаёт ленивый мемо. Возвращает `Accessor<T>`, вычисляющий `fn` при первом чтении и при изменении зависимостей. Значение кешируется; dependent-эффекты уведомляются только если значение изменилось.

```ts
import { createMemo, createSignal } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(2);
const double = createMemo(() => count() * 2);
console.log(double());
```

Примечание: мемо ленив, не вычисляется до первого чтения. Если `fn` или `equals` бросают, мемо откатывается в `DIRTY`: ошибка не кешируется, следующий read пересчитывает значение. Исключение распространяется к читателю (эффекту или прямому вызову).

#### `CircularComputationError`

Стабильность: public

```ts
class CircularComputationError extends Error {
  readonly path: readonly string[];
}
```

Возникает при циклической зависимости мемо (self или mutual). `path` содержит имена мемо от точки входа до повторного чтения; имя задаётся через `MemoOptions.name`, иначе используется имя функции или `memo#N`.

```ts
const self = createMemo((): number => self() + 1, { name: "self" });
self(); // CircularComputationError: self -> self
```

#### `setEffectErrorHandler`

Стабильность: public

```ts
type EffectErrorHandler = (error: unknown, owner: Owner | null) => void;

function setEffectErrorHandler(
  handler: EffectErrorHandler | null,
): EffectErrorHandler | null;
```

Настраивает обработчик ошибок эффектов. По умолчанию ошибки выводятся через `console.error`. Возвращает предыдущий обработчик; `null` отключает вывод, но не отключает изоляцию — остальные эффекты всё равно выполняются. Ошибка эффекта не прерывает flush и не влияет на последующие flush.

Второй аргумент обработчика — `Owner` сбойного эффекта (позволяет привязать ошибку к нужному `ErrorBoundary`), либо `null`, если эффект создан вне контекста владельца. Сюда же приходит диагностическая ошибка превышения лимита flush (см. `flushSync`).

```ts
const previous = setEffectErrorHandler((error, owner) => report(error, owner));
// ...
setEffectErrorHandler(previous);
```

#### `createRenderEffect`

Стабильность: public

```ts
function createRenderEffect(fn: () => void): void;
```

Создаёт render-эффект: первый запуск синхронный, обновления помещаются в общую очередь flush.

```ts
import { createRenderEffect, createSignal } from "@ivlev-dev/silent-reactivity";

const [text, setText] = createSignal("a");
createRenderEffect(() => {
  console.log(text());
});
```

Примечание: отличие от `createEffect` — синхронный первый прогон.

#### `createRoot`

Стабильность: public

```ts
function createRoot<T>(fn: (dispose: () => void) => T): T;
```

Создаёт корневой `Owner`. Возвращает результат `fn`, передавая функцию `dispose` для уничтожения поддерева. Если `fn` бросает — owner dispose-ится и ошибка пробрасывается.

```ts
import { createRoot, createSignal } from "@ivlev-dev/silent-reactivity";

const value = createRoot((dispose) => {
  const [count] = createSignal(0);
  return count();
});
```

#### `createSignal`

Стабильность: public

```ts
function createSignal<T>(value: T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>];
```

Создаёт сигнал. Возвращает пару `[read, set]`.

```ts
import { createSignal } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(0);
setCount((prev) => prev + 1);
```

Примечание: updater работает через `peek()` и не регистрирует зависимость.

#### `flushSync`

Стабильность: public

```ts
function flushSync(): void;
```

Принудительно прогоняет начальные и обычные эффекты (initial + queued). Игнорирует планирование через микротаску.

Лимит flush — диагностика, а не падение рантайма. Если один эффект за flush запускается больше 1000 раз (или суммарно набирается больше 100 000 итераций), он считается runaway: ошибка передаётся в `setEffectErrorHandler` вместе с `owner`, узел снимается с очереди и больше не ставится в неё автоматически (пользовательские cleanup не вызываются). Остальные эффекты продолжают выполняться, а `flushSync` и микротаска не бросают исключение.

```ts
import { createEffect, createSignal, flushSync } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(0);
createEffect(() => console.log(count()));
flushSync();
```

#### `getOwner`

Стабильность: public

```ts
function getOwner(): Owner | null;
```

Возвращает текущего владельца или `null`, если вызов вне эффекта/мемо/`createRoot`.

```ts
import { getOwner } from "@ivlev-dev/silent-reactivity";

const owner = getOwner();
```

#### `getReactivityStats`

Стабильность: public

```ts
function getReactivityStats(): ReactivityStats;
```

Возвращает счётчики графа: сколько сигналов, эффектов и мемо создано, сколько эффектов и мемо активно, сколько раз запускались эффекты, сколько эффектов ждёт flush, глубину текущего батча и число активных владельцев. Счётчики только читаются и не удерживают ссылки на узлы графа.

```ts
import { createSignal, getReactivityStats } from "@ivlev-dev/silent-reactivity";

createSignal(0);
console.log(getReactivityStats().signalsCreated);
```

#### `ReactivityStats`

Стабильность: public

```ts
interface ReactivityStats {
  readonly signalsCreated: number;
  readonly effectsCreated: number;
  readonly renderEffectsCreated: number;
  readonly memosCreated: number;
  readonly effectRuns: number;
  readonly activeEffects: number;
  readonly activeMemos: number;
  readonly activeOwners: number;
  readonly pendingEffects: number;
  readonly batchDepth: number;
}
```

Снимок счётчиков реактивности, используемый `getReactivityStats()` и DevTools. `signalsCreated`, `effectsCreated`, `renderEffectsCreated` и `memosCreated` — монотонные счётчики за время жизни процесса; `activeEffects`, `activeMemos` и `activeOwners` уменьшаются при dispose соответствующего узла.

Примечание: сигналы не имеют явного dispose, поэтому для них доступен только счётчик созданных экземпляров.

#### `onCleanup`

Стабильность: public

```ts
function onCleanup(fn: () => void): void;
```

Регистрирует cleanup для текущего владельца. Если владелец уже dispose-нут — `fn` вызывается синхронно. Cleanup-и выполняются в обратном порядке регистрации.

```ts
import { createEffect, onCleanup } from "@ivlev-dev/silent-reactivity";

createEffect(() => {
  const timer = setInterval(() => {}, 1000);
  onCleanup(() => clearInterval(timer));
});
```

Примечание: вне владельца вызов игнорируется.

#### `runWithOwner`

Стабильность: public

```ts
function runWithOwner<T>(owner: Owner | null, fn: () => T): T;
```

Выполняет `fn` с указанным владельцем как текущим и восстанавливает предыдущего в `finally`.

```ts
import { getOwner, runWithOwner } from "@ivlev-dev/silent-reactivity";

const owner = getOwner();
runWithOwner(owner, () => {
  // код в контексте owner
});
```

#### `untrack`

Стабильность: public

```ts
function untrack<T>(fn: () => T): T;
```

Выполняет `fn` без трекинга зависимостей (currentListener = null) и восстанавливает предыдущий listener.

```ts
import { createEffect, createSignal, untrack } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(0);
createEffect(() => {
  const v = untrack(() => count());
  console.log(v);
});
```

#### `on`

Стабильность: public

```ts
function on<T>(
  deps: Accessor<T> | Accessor<T>[],
  fn: (value: T, prev: T) => void,
  options?: OnOptions,
): void;
```

Создаёт эффект, реагирующий на `deps`. Если `deps` — массив, `value`/`prev` тоже массивы. При первом запуске, если `defer` не задан, `fn` вызывается с `prev === value`. При `defer: true` первый вызов пропускается.

```ts
import { createSignal, on } from "@ivlev-dev/silent-reactivity";

const [count, setCount] = createSignal(0);
on(count, (value, prev) => {
  console.log(prev, value);
});
```

Примечание: вычисление deps происходит с трекингом, тело `fn` — через `untrack`.

#### `deepReactive`

Стабильность: public

```ts
function deepReactive<T>(value: T): T;
```

Возвращает прокси над объектом/массивом. Каждое свойство, индекс и `length` получает отдельный сигнал. Вложенные объекты оборачиваются лениво при доступе.

```ts
import { deepReactive } from "@ivlev-dev/silent-reactivity";

const state = deepReactive({ user: { name: "Ann" } });
state.user.name = "Bob";
```

Примечание: не оборачивает DOM-узлы, `Date`, `Map`, `Set`, `Promise`, `RegExp` и другие не-plain объекты.

#### `isReactive`

Стабильность: public

```ts
function isReactive(value: unknown): boolean;
```

Проверяет, является ли значение прокси, созданным `deepReactive`.

```ts
import { deepReactive, isReactive } from "@ivlev-dev/silent-reactivity";

const state = deepReactive({ a: 1 });
console.log(isReactive(state)); // true
```

#### `isReactiveClass`

Стабильность: public

```ts
function isReactiveClass(value: unknown): boolean;
```

Проверяет, отмечен ли конструктор как реактивный класс через `markReactiveClass`.

```ts
import { isReactiveClass, markReactiveClass } from "@ivlev-dev/silent-reactivity";

class VM {}
markReactiveClass(VM);
console.log(isReactiveClass(VM)); // true
```

#### `markReactiveClass`

Стабильность: public

```ts
function markReactiveClass(ctor: Function): void;
```

Отмечает конструктор реактивным классом. Экземпляры с таким прототипом не оборачиваются `deepReactive` повторно.

```ts
import { markReactiveClass } from "@ivlev-dev/silent-reactivity";

class VM {}
markReactiveClass(VM);
```

Примечание: используется компилятором для классов с `@reactive`-полями.

#### `unwrap`

Стабильность: public

```ts
function unwrap<T>(value: T): T;
```

Разворачивает прокси, созданный `deepReactive`, до исходного объекта. Снимает несколько уровней обёртки.

```ts
import { deepReactive, unwrap } from "@ivlev-dev/silent-reactivity";

const state = deepReactive({ a: 1 });
console.log(unwrap(state) === state); // false на оригинале
```

Примечание: возвращает исходное значение, если передан не реактивный объект.

#### `createReactiveStore`

Стабильность: public

```ts
function createReactiveStore(): ReactiveStore;
```

Создаёт новый `ReactiveStore`, не привязанный к экземпляру.

```ts
import { createReactiveStore } from "@ivlev-dev/silent-reactivity";

const store = createReactiveStore();
store.dispose();
```

#### `copyReactiveState`

Стабильность: public

```ts
function copyReactiveState(source: object, target: object): void;
```

Копирует сигналы полей из store источника в store получателя. Для существующих ключей — перезаписывает значение; для новых — создаёт сигнал. Игнорирует disposed source store.

```ts
import { copyReactiveState } from "@ivlev-dev/silent-reactivity";

copyReactiveState(sourceInstance, targetInstance);
```

Примечание: используется при HMR для переноса `@reactive`-полей.

#### `getComputed`

Стабильность: public

```ts
function getComputed<T>(instance: object, key: PropertyKey, compute: () => T): T;
```

Создаёт (или переиспользует) мемо на экземпляр, привязанный к его store, и возвращает текущее значение. При dispose store мемо удаляется.

```ts
import { getComputed } from "@ivlev-dev/silent-reactivity";

const value = getComputed(instance, "double", () => count * 2);
```

#### `readField`

Стабильность: public

```ts
function readField<T>(instance: object, key: PropertyKey, getRaw: () => T): T;
```

Читает поле экземпляра через store: создаёт сигнал при первом чтении, оборачивает значение в `deepReactive`. Если store disposed — возвращает `deepReactive(getRaw())`.

```ts
import { readField } from "@ivlev-dev/silent-reactivity";

const value = readField(instance, "count", () => instance.count);
```

Примечание: используется декоратором `@reactive`.

#### `registerCleanup`

Стабильность: public

```ts
function registerCleanup(store: ReactiveStore, fn: () => void): void;
```

Регистрирует cleanup в store. Если store уже disposed — `fn` вызывается синхронно.

```ts
import { registerCleanup } from "@ivlev-dev/silent-reactivity";

registerCleanup(store, () => {
  // очистка
});
```

#### `storeFor`

Стабильность: public

```ts
function storeFor(instance: object): ReactiveStore;
```

Возвращает (или создаёт) store, привязанный к экземпляру, из WeakMap. Один store на экземпляр.

```ts
import { storeFor } from "@ivlev-dev/silent-reactivity";

const store = storeFor(instance);
```

#### `writeField`

Стабильность: public

```ts
function writeField<T>(instance: object, key: PropertyKey, value: T, setRaw: (value: T) => void): T;
```

Записывает поле экземпляра: unwraps значение, вызывает `setRaw`, затем обновляет сигнал store. Возвращает переданное `value`. Если store disposed — только `setRaw`.

```ts
import { writeField } from "@ivlev-dev/silent-reactivity";

writeField(instance, "count", 5, (v) => {
  instance.count = v;
});
```

Примечание: используется декоратором `@reactive`.

## Порядок обновлений

1. `createRenderEffect` выполняется синхронно при создании и далее обновляется через flush.
2. `createEffect` и начальные эффекты планируются в микротаске через `queueMicrotask`.
3. Запись в сигнал уведомляет наблюдателей: мемо помечаются `CHECK`/`DIRTY`, эффекты попадают в `effectQueue`.
4. `batch(fn)` подавляет flush до выхода из внешнего батча; вложенные батчи не запускают flush. `batch` не запускает начальные эффекты и не прерывает их выполнение: если `batch` вызван внутри начального эффекта, обычные обновления ждут завершения всех начальных эффектов.
5. `flushSync()` принудительно прогоняет `flushInitialEffects` и `flushEffects`, минуя микротаску.
6. Обычный flush происходит один раз на микротаску (`scheduleFlush`); при разрывах батча — через `flushEffects`.
7. Исключение одного эффекта изолируется: остальные эффекты выполняются, а ошибка передаётся в `setEffectErrorHandler` вместе с `owner` сбойного вычисления.
8. Если эффект изменил источник, прочитанный в этом же прогоне (включая самый первый), узел помечается `DIRTY` и выполняется повторно — поведение первого и последующих прогонов совпадает.
9. Превышение лимита flush не бросает исключение: runaway-эффект снимается с очереди и отключается, ошибка уходит в `setEffectErrorHandler` с `owner`, остальные эффекты выполняются.

Следствие: синхронные render-эффекты видят состояние сразу; обычные эффекты асинхронны; `batch` объединяет несколько записей в один прогон.

## Глубокие прокси и store

- `deepReactive` лениво оборачивает plain-объекты и массивы в прокси с сигналом на каждое свойство/индекс/`length`.
- `unwrap` снимает обёртку и возвращает исходный объект.
- `isReactive` проверяет принадлежность к прокси `deepReactive`.
- `isReactiveClass` и `markReactiveClass` управляют списком классов, экземпляры которых не оборачиваются повторно.
- `createReactiveStore` создаёт самостоятельный store; `storeFor` привязывает store к экземпляру (WeakMap).
- `readField`/`writeField` читают и пишут поле экземпляра через store и `deepReactive`.
- `getComputed` создаёт мемо на экземпляр, привязанный к store и его lifecycle.
- `registerCleanup` добавляет функцию очистки в store (или вызывает синхронно, если store disposed).
- `copyReactiveState` переносит сигналы полей между store (HMR).

#### `createSignalHandle`

```ts
function createSignalHandle<T>(value: T, equals?: (a: T, b: T) => boolean): {
  read(): T;
  peek(): T;
  write(next: T): T;
};
```

Низкоуровневый handle сигнала с `read`/`peek`/`write` без tuple-обёртки.

#### `markRaw`

```ts
function markRaw<T>(value: T): T;
```

Помечает объект/`Map`/`Set`/класс как необорачиваемый `deepReactive`; `deepReactive(x) === x` и вложенные значения сохраняют идентичность.

#### `isRaw`

```ts
function isRaw(value: unknown): boolean;
```

Возвращает `true` для значения, помеченного `markRaw`.

#### `readonly`

```ts
function readonly<T>(value: T): T;
```

Глубокий read-only слой для объектов, массивов, `Map` и `Set`; чтения продолжают отслеживаться, мутации бросают `ReadonlyMutationError`.

#### `isReadonly`

```ts
function isReadonly(value: unknown): boolean;
```

Проверяет read-only обёртку.

#### `ReadonlyMutationError`

```ts
class ReadonlyMutationError extends TypeError {}
```

Ошибка мутации read-only значения.

`deepReactive` также поддерживает `Map` и `Set`: `get/set/delete/has/size/clear` и итераторы подписаны на ключи/состав; вложенные значения и объектные ключи оборачиваются лениво.

## Ограничения

- Массивы: мутирующие методы (`push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`) уведомляют только затронутые индексы и `length`; сигналы ключей bump-ятся только при изменении состава ключей.
- Повторная обёртка: экземпляры классов, отмеченных через `markReactiveClass` (компилятором для классов с `@reactive`), `deepReactive` не оборачивает повторно.
- Ленивость мемо: `createMemo` не вычисляется до первого чтения; dependent-эффекты уведомляются только при реальном изменении значения (с учётом `equals`).
- Ошибки мемо не кешируются: после исключения мемо остаётся `DIRTY` и пересчитывается при следующем чтении. Циклические мемо завершаются `CircularComputationError`.
- Ошибки эффектов изолированы и передаются в `setEffectErrorHandler` (второй аргумент — `owner` сбойного вычисления или `null`); синхронный первый запуск `createRenderEffect` по-прежнему пробрасывает исключение вызывающему.
- Превышение лимита flush не роняет рантайм: runaway-эффект отключается до пересоздания, ошибка приходит в `setEffectErrorHandler`; независимые эффекты продолжают обновляться.
- `deepReactive` не оборачивает DOM-узлы, `Date`, `Promise`, `RegExp`, `Error`, буферы и прочие не-plain объекты; `Map`/`Set` оборачиваются, если не помечены `markRaw`.
- `Setter` updater использует `peek()` и не регистрирует зависимость; запись с `equals === true` не уведомляет наблюдателей.