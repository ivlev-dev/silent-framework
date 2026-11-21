# @ivlev-dev/silent-form

Реактивные формы на stage-3 декораторах: поля на базе `@ivlev-dev/silent-validation`, значения и ошибки — на реактивности `@ivlev-dev/silent-core`.

[![npm version](https://img.shields.io/npm/v/@ivlev-dev/silent-form)](https://www.npmjs.com/package/@ivlev-dev/silent-form)
[![license](https://img.shields.io/npm/l/@ivlev-dev/silent-form)](https://github.com/ivlev-dev/silent-framework/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ivlev-dev/silent-form)](https://www.npmjs.com/package/@ivlev-dev/silent-form)

## Возможности

- `@Field()` делает accessor реактивным и регистрирует его в форме.
- Метаданные для UI: `@Label`, `@Placeholder`, `@Hint`, `@Required`, `@ValidateOn`.
- Все правила `@ivlev-dev/silent-validation` доступны без дополнительной настройки.
- Вложенные формы (`@FormField()`) связываются автоматически: значения, ошибки и `isReady` агрегируются.
- Режимы проверки: `change`, `input`, `blur`, `submit`, `none`, для поля и для формы.
- Серверные ошибки через `setFieldErrors` с автоочисткой при изменении.
- Типизированные пути полей, включая `address.city`, без generic-интерфейса.
- DOM-`id` по умолчанию: `${className}-${path}`; `formId` переопределяет префикс.

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

`onSubmit` вызывает `preventDefault`, проверяет форму (при `validateOnSubmit`), вызывает колбэк только при `isReady`, сбрасывает `isSubmitting` в `finally`. Ошибки колбэка уходят в `onError` (по умолчанию `console.error`).

## Ограничения

- Только stage-3 `accessor`-поля с публичным строковым именем.
- Поле должно быть отмечено декоратором формы (`@Field`/`@FormField`/`@Required`/`@Label` и т. п.).
- `reset()` восстанавливает значения, зафиксированные `@Field` при создании экземпляра.
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
