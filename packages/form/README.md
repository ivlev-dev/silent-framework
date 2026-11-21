# @ivlev-dev/silent-form

Реактивные формы на stage-3 декораторах: поля на базе `@ivlev-dev/silent-validation`, значения и ошибки — на реактивности `@ivlev-dev/silent-core`.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-form)](https://www.npmjs.com/package/@ivlev-dev/silent-form)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-form)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-form)](https://www.npmjs.com/package/@ivlev-dev/silent-form)

## Возможности

- `@Field()` делает accessor реактивным и регистрирует его в форме; без `@Field`/`@FormField` поле не инициализируется.
- Метаданные для UI: `@Label`, `@Placeholder`, `@Hint`, `@Required`, `@Optional`, `@ValidateIf`, `@ValidateOn`.
- Все правила `@ivlev-dev/silent-validation` доступны без дополнительной настройки.
- Вложенные формы (`@FormField()`) связываются автоматически: значения, ошибки и `isReady` агрегируются; `validateOnSubmit: false` рекурсивно проверяет `@ValidateOn("submit")` на любой глубине.
- Режимы проверки: `change`, `input`, `blur`, `submit`, `none`, для поля и для формы; поколения валидации отменяют устаревшие результаты после `reset()`/`dispose()`.
- Серверные ошибки через `setFieldErrors` с автоочисткой при изменении.
- Типизированные пути полей, включая `address.city`, без generic-интерфейса.
- DOM-`id` по умолчанию: `${className}-${path}`; `formId` переопределяет префикс.
- `values` — снимок-копия, `reset()` — эталон после конструкции и свежая копия при каждом вызове.

## Установка

```bash
pnpm add @ivlev-dev/silent-form
```

```bash
npm install @ivlev-dev/silent-form
```

```bash
yarn add @ivlev-dev/silent-form
```

Пакет ESM-only и требует Node.js >= 22. Нужны stage-3 декораторы: `experimentalDecorators: false`.

## Быстрый старт

```ts
import {
  Field,
  Form,
  IsEmail,
  Label,
  MinLength,
  Required,
} from "@ivlev-dev/silent-form";

class LoginForm extends Form {
  @Field()
  @Required()
  @IsEmail()
  @Label("Email")
  public accessor email = "";

  @Field()
  @Required()
  @MinLength(8)
  @Label("Пароль")
  public accessor password = "";
}

const form = new LoginForm();
const email = form.getFieldProps("email");

email.label; // "Email"
email.isRequired; // true
email.id; // "LoginForm-email"
email.onChange({ currentTarget: { value: "user@example.com" } });
email.onBlur();

await form.onSubmit(async (submitted) => {
  await api.login(submitted.values);
})();
```

Пути полей выводятся из accessor-полей класса: `form.getFieldProps("email")` типизирован, а `form.getFieldProps("surname")` — ошибка компиляции (методы и служебные члены `Form` тоже не являются путями). DOM-`id` по умолчанию — `${className}-${path}`; опция `formId` задаёт свой префикс: `new LoginForm({ formId: "login" })` → `login-email`.

`getFieldProps` возвращает стабильный объект с `value`, `label`, `placeholder`, `hint`, `error`, `errors`, `isRequired`, `isReady`, `isValidating`, `touched`, `dirty`, `isValid`, `name`, `id`, `setValue`, `setReady`, обработчиками `onChange`/`onInput`/`onFocus`/`onBlur` и `validate()`.

`onChange` читает `event.currentTarget`: `checkbox` → `checked`, `radio` → только при `checked`, остальные → `value`. Для числового поля непустая строка приводится к `number`, пустая остаётся строкой.

## Условия и необязательные поля

```ts
import {
  Field,
  Form,
  Optional,
  Required,
  ValidateIf,
} from "@ivlev-dev/silent-form";

class OrderForm extends Form {
  @Field()
  @Required()
  public accessor kind = "";

  @Field()
  @Required()
  @ValidateIf((form: OrderForm) => form.kind === "custom")
  public accessor customValue = "";

  @Field()
  @Required()
  @Optional()
  public accessor note: string | undefined = undefined;
}
```

`isReady` требует значение только при активном требовании: `@Optional` с `undefined`/`null` и `@ValidateIf` с предикатом, вернувшим не `true`, снимают требование. Асинхронное условие считается активным. **`Optional` и `ValidateIf` импортируйте из `@ivlev-dev/silent-form`** — версии из `@ivlev-dev/silent-validation` форма не видит.

## Вложенная форма

```ts
import { Field, Form, FormField, Required } from "@ivlev-dev/silent-form";

class AddressForm extends Form {
  @Field()
  @Required()
  public accessor city = "";
}

class ProfileForm extends Form {
  @Field()
  @Required()
  public accessor name = "";

  @FormField()
  public accessor address = new AddressForm();
}

const form = new ProfileForm();
form.getFieldProps("address.city").onChange({
  currentTarget: { value: "Москва" },
});
form.getFieldProps("address.city").id; // "ProfileForm-address.city"

form.errors; // { "address.city": [...] } после проверки
form.isReady; // учитывает готовность вложенной формы
```

Один экземпляр вложенной формы нельзя использовать в двух родителях — будет понятная ошибка.

## Серверные ошибки

```ts
form.setFieldErrors("email", ["Этот email уже занят"]);
form.getFieldProps("email").error; // "Этот email уже занят"

// Очистить вручную:
form.clearFieldErrors("email");

// По умолчанию ошибки очищаются и при изменении значения:
form.getFieldProps("email").setValue("other@example.com");
```

Отключить автоочистку: `new LoginForm({ clearExternalErrorsOnChange: false })`.

## Проверка и отправка

```ts
const form = new LoginForm({ validateOnInput: true, debounceMs: 200 });

form.getFieldProps("email").onInput({ currentTarget: { value: "x" } });
await form.validateField("email"); // true | false
await form.validate(); // проверяет все поля и вложенные формы

await form.onSubmit(async (submitted) => {
  // submitted === form; isSubmitting === true
})();
```

`onSubmit` вызывает `preventDefault`, проверяет форму (при `validateOnSubmit`), вызывает колбэк только при `isReady`, сбрасывает `isSubmitting` в `finally`. Ошибки колбэка уходят в `onError` (по умолчанию `console.error`). `reset()`/`dispose()` во время проверки отменяют устаревший результат; после `dispose()` колбэк не вызывается.

`validate()` возвращает `false`, если есть ошибки у полей без `@Field`, и один раз сообщает о таком поле через `onError` (или `console.warn`).

## Снимки и сброс

- `values` возвращает глубокую копию: массивы и plain-объекты клонируются рекурсивно, `Map`/`Set`/`Date` копируются, экземпляры классов и вложенные формы — как есть. Мутация снимка не меняет форму.
- Эталон для `reset()` снимается после завершения конструкции (микрозадача или первое обращение), поэтому значение из тела конструктора сохраняется. Каждый `reset()` пишет свежую копию эталона; вложенные формы сбрасываются через `child.reset()`.

## Ограничения

- Только stage-3 `accessor`-поля с публичным строковым именем.
- Любое поле формы обязано иметь `@Field()`/`@FormField()`; поля только с `@Required`/`@Label` дают `TypeError`.
- `reset()` восстанавливает эталон, снятый после создания экземпляра; прямые присваивания до первого обращения/микрозадачи считаются частью конструкции.
- `@ValidateOn("none")` отключает автоматическую проверку по событиям; явные `validate()`/`validateField()` работают всегда.
- Вложенность определяется по `instanceof Form`.
- `FieldPath` видит все публичные не-методы класса, но `getFieldProps` работает только для полей, отмеченных декоратором формы (иначе — понятная ошибка).
- DOM-`id` по умолчанию строится из имени класса; минификатор может его переименовать. Для стабильных id/SSR задайте `formId`.

## Ссылки

- Документация API: [docs/api/form.md](https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/form.md)
- Валидация: [@ivlev-dev/silent-validation](https://github.com/ivlev-dev/silent-framework/blob/main/docs/api/validation.md)
- Issues: https://github.com/ivlev-dev/silent-framework/issues

---

MIT © ivlev-dev
