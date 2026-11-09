# Silent Framework

Легковесный фронтенд-фреймворк с гранулярной реактивностью, компилируемым JSX, MVVM и compile-time DI.

## Возможности

- Сигналы, мемо, эффекты, батчинг и точечные обновления DOM без виртуального DOM.
- Stage-3 декораторы `@reactive`, `@computed`, `@watch`.
- Глубокая реактивность объектов и массивов, включая `push`, `splice`, `sort`.
- MVVM: каждый view получает ViewModel через async DI.
- DI без декораторов: интерфейсы, автопоиск реализаций, скоупы, кеш промисов, обнаружение циклов.
- Компилятор на Rust + `swc_core` и нативный Node-API addon.
- Vite 8 плагин с полной компиляцией TS/TSX и HMR.
- Прелоадеры на уровне view и HMR с сохранением состояния.

## Установка

```bash
pnpm add @silent/core @silent/di @silent/reactivity
pnpm add -D @silent/vite
```

```ts
import { defineConfig } from "vite";
import { silent } from "@silent/vite";

export default defineConfig({
  plugins: [silent()],
});
```

По умолчанию плагин компилирует TS/TSX с `target: "es2024"`, включает source maps и HMR.

## Компонент и ViewModel

```tsx
import { computed, reactive, ViewModel, watch } from "@silent/core";

function CounterPreloader() {
  return <span>Загрузка...</span>;
}

export class CounterVM extends ViewModel<{ step: number }> {
  @reactive accessor count = 0;

  @computed get double() {
    return this.count * 2;
  }

  @watch((vm: CounterVM) => vm.count, { immediate: true })
  onCount(next: number, prev: number | undefined): void {
    console.log(prev, next);
  }

  increment(): void {
    this.count += this.props.step;
  }
}

export function Counter(
  this: { vm: CounterVM; preloader: typeof CounterPreloader },
  props: { step: number },
) {
  return (
    <div>
      <button onClick={() => this.vm.increment()}>+</button>
      <span>{this.vm.count}</span>
      <span>{this.vm.double}</span>
    </div>
  );
}
```

`vm` и `preloader` извлекаются из `this`-типа компилятором. `<Counter step={2} />` типизируется без параметра `vm`.

Если `preloader` не указан, используется глобальный прелоадер или пустой якорь. Опция плагина `requirePreloader: true` делает его обязательным.

## Реактивность

```ts
import { batch, createEffect, createSignal } from "@silent/reactivity";

const [count, setCount] = createSignal(0);
createEffect(() => console.log(count()));
batch(() => {
  setCount(1);
  setCount(2);
});
```

`@reactive accessor user = { name: "Ann", address: { city: "Moscow" } }` создаёт отдельный сигнал на каждое вложенное свойство. Изменение `user.address.city` не перезапускает эффекты, читающие `user.name`.

## DI

```ts
import type { Store } from "./types";

export class Service {
  constructor(private readonly store: Store) {}
}
```

Сканер индекса находит `class MemoryStore implements Store`, и конструктор компилируется в фабрику с разрешением реализации. Поддерживаются `singleton`, `transient`, `scoped`, `peek`, `has`, `dispose`, `CircularDependencyError`.

## HMR

В dev-режиме компилятор внедряет `import.meta.hot.accept`. При изменении view сохраняется ViewModel и состояние сигналов. При изменении модуля ViewModel создаётся новый экземпляр с переносом значений `@reactive`-полей.

## Опции плагина

```ts
silent({
  include: /\.(ts|tsx|js|jsx)$/,
  exclude: /node_modules/,
  root: process.cwd(),
  swc: {
    jsc: { target: "es2020" },
    minify: false,
  },
  requirePreloader: false,
  hmr: true,
  index: true,
});
```

`swc` принимает опции компилятора SWC. JSX всегда компилируется рантаймом Silent Framework.

## Ограничения

- Синхронные компоненты без ViewModel разрешены только для прелоадеров и простых UI-листьев.
- Интерфейс в DI должен иметь ровно одну реализацию в индексе; иначе используйте явный `bind`.
- Сложные re-export и generic-типы в DI требуют ручной привязки.
- HMR рантайма самого фреймворка выполняет полную перезагрузку.

## Разработка

```bash
pnpm install
pnpm build:native
pnpm build
pnpm test
pnpm typecheck
pnpm dev
pnpm bench
```
