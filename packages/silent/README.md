# @ivlev-dev/silent

Метапакет Silent Framework: рантайм и Vite-плагин в одной установке.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent)](https://www.npmjs.com/package/@ivlev-dev/silent)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent)](https://www.npmjs.com/package/@ivlev-dev/silent)

## Возможности

- Один пакет вместо шести: `silent-core`, `silent-di`, `silent-reactivity`, `silent-router`, `silent-swc`, `silent-vite`.
- Валидация ставится отдельно: `@ivlev-dev/silent-validation` (рантайм) и `@ivlev-dev/silent-validation-vite` (плагин).
- Реэкспорт всего публичного API `@ivlev-dev/silent-core`.
- Реэкспорт роутера: `Router`, `RouterView`, `Link` и остальной API `@ivlev-dev/silent-router`.
- Плагин Vite доступен как `silent` из того же пакета.
- Совместим с точечной установкой отдельных пакетов — метапакет ничего не меняет в рантайме.

## Установка

```bash
pnpm add @ivlev-dev/silent
pnpm add -D vite typescript
```

`vite` — peer-зависимость (>= 8). `typescript` нужен для типов и `tsc`. Внутренние пакеты `@ivlev-dev/silent-*` ставятся как зависимости метапакета в диапазоне `>=0.12.0 <0.13.0`, их peer-зависимости менеджер пакетов устанавливает сам (npm 7+ и pnpm — автоматически).

Точечная установка вместо метапакета:

```bash
pnpm add @ivlev-dev/silent-core
pnpm add -D @ivlev-dev/silent-vite vite typescript
```

## Быстрый старт

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent";

export default defineConfig({
  plugins: [silent()],
});
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@ivlev-dev/silent-core"
  }
}
```

`src/main.tsx`:

```tsx
import { mount } from "@ivlev-dev/silent";
import { App } from "./app";

void mount("#app", App);
```

`jsxImportSource` указывает на `@ivlev-dev/silent-core`: JSX-рантайм живёт там, метапакет только реэкспортирует его.

## Состав

| Пакет | Роль |
| --- | --- |
| `@ivlev-dev/silent-core` | MVVM, JSX-рантайм, control flow, гидрация |
| `@ivlev-dev/silent-di` | асинхронный DI без декораторов |
| `@ivlev-dev/silent-reactivity` | сигналы, мемо, эффекты, глубокие прокси |
| `@ivlev-dev/silent-router` | клиентский и серверный роутинг, `Router`, `RouterView`, `Link` |
| `@ivlev-dev/silent-swc` | нативный компилятор на Rust |
| `@ivlev-dev/silent-vite` | Vite-плагин: компиляция, DI-индекс, HMR |

## Ограничения и совместимость

- ESM-only, Node.js >= 22, Vite >= 8.
- `vite` не устанавливается автоматически (peer); добавьте его явно.
- Внутренние пакеты объявлены с диапазоном `>=0.12.0 <0.13.0`: патч-версии совместимы, `0.13.0` требует согласованного обновления.
- Для SSR дополнительно установите `@ivlev-dev/silent-server`.

## Ссылки

- Репозиторий: https://github.com/ivlev-dev/silent-framework
- Документация: https://github.com/ivlev-dev/silent-framework/blob/main/docs/getting-started.md
- CHANGELOG: https://github.com/ivlev-dev/silent-framework/blob/main/CHANGELOG.md
- Issues: https://github.com/ivlev-dev/silent-framework/issues

---

MIT © ivlev-dev
