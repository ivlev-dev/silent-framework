# @ivlev-dev/silent-protocol

Бинарный протокол вместо JSON: схема — сам класс, на wire нет имён полей, значения идут в порядке сортировки по имени. Работает в TS, Rust и Kotlin.

## Установка

```bash
pnpm add @ivlev-dev/silent-protocol
pnpm add -D @ivlev-dev/silent-protocol-vite
```

## Использование

```ts
import { decode, encode, ProtocolModel, OneOf } from "@ivlev-dev/silent-protocol";

class Address extends ProtocolModel {
  public accessor city: string = "";
  public accessor zip: number = 0;
}

class User extends ProtocolModel {
  public accessor name: string = "";
  public accessor address: Address = new Address();
  public accessor tags: string[] = [];
  public accessor email: string | undefined = undefined;
}

const user = new User();
user.name = "Ivan";
const bytes = encode(user);
const restored = decode(User, bytes);
```

Схема генерируется Vite-плагином `protocol()` из `@ivlev-dev/silent-protocol-vite`. Без плагина схему можно задать вручную через `defineProtocol`.

## Возможности

- varint/zigzag/fixed, float32/64, строки UTF-8, bytes, массивы, кортежи, map/set/record, вложенные классы без length-префикса.
- bitmap для `T | undefined` / `T | null`; oneof через enum-дискриминатор и `@OneOf`.
- `Date`, `bigint`, `Uint8Array`/`ArrayBuffer`, typed arrays.
- Детерминированная сортировка map/set и полей; лимиты глубины/размера; обнаружение циклов.
- Опциональная интеграция с `@ivlev-dev/silent-validation` через `encode(value, { validate: true })`.
- Статические кодеки из `protocol()` и generic fallback; кеш по конструктору, без рефлексии в горячем пути.
- Бенчмарк: `pnpm bench:protocol` (static/generic/JSON). Ориентиры: static encode ~1.56M ops/s, decode ~0.78M на модели User (60 B); Rust/Kotlin — 5–8M ops/s.

## Ограничения

- Схема фиксируется классом: добавление/перестановка полей меняет wire-формат.
- Нет произвольных union без enum-дискриминатора, `any`/`unknown`, функций, `Promise`, `WeakMap`/`WeakSet`.
- Циклы объектов запрещены.

Спецификация: [`docs/protocol.md`](../../docs/protocol.md).
