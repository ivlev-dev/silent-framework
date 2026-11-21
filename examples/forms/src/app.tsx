import { Show } from "@ivlev-dev/silent-core";
import type { AppVM } from "./app.vm";

/** Список id подсказки и ошибки для `aria-describedby`. */
function describedBy(
  id: string,
  hint: string | undefined,
  error: string | undefined,
): string | undefined {
  const ids: string[] = [];
  if (hint !== undefined) {
    ids.push(`${id}-hint`);
  }
  if (error !== undefined) {
    ids.push(`${id}-error`);
  }
  return ids.length === 0 ? undefined : ids.join(" ");
}

export function App(this: { vm: AppVM }) {
  const form = this.vm.form;
  const name = form.getFieldProps("name");
  const email = form.getFieldProps("email");
  const age = form.getFieldProps("age");
  const avatar = form.getFieldProps("avatar");
  const address = form.getFieldProps("address");
  const city = form.getFieldProps("address.city");
  const state = form.getFieldProps("address.state");
  const interests = form.getFieldProps("interests");

  return (
    <main class="app">
      <title>Silent Framework: форма профиля</title>
      <h1>Профиль</h1>
      <p class="lead">
        Форма на <code>@ivlev-dev/silent-form</code>: декораторы полей, вложенная
        форма адреса, серверные ошибки и асинхронная готовность.
      </p>

      <form class="profile" onSubmit={this.vm.submit} novalidate>
        <div class="field">
          <label for={name.id}>
            {name.label}
            {name.isRequired ? " *" : ""}
          </label>
          <input
            id={name.id}
            name={name.name}
            value={name.value}
            placeholder={name.placeholder ?? ""}
            autocomplete="name"
            onInput={(event: InputEvent) => name.onInput(event)}
            onBlur={(event: FocusEvent) => name.onBlur(event)}
            aria-invalid={!name.isValid}
            aria-describedby={describedBy(name.id, name.hint, name.error)}
            disabled={name.isValidating}
          />
          <Show when={name.hint !== undefined}>
            <p class="hint" id={`${name.id}-hint`}>
              {name.hint}
            </p>
          </Show>
          <Show when={name.error !== undefined}>
            <p class="error" id={`${name.id}-error`}>
              {name.error}
            </p>
          </Show>
        </div>

        <div class="field">
          <label for={email.id}>
            {email.label}
            {email.isRequired ? " *" : ""}
          </label>
          <input
            id={email.id}
            name={email.name}
            type="email"
            value={email.value}
            placeholder={email.placeholder ?? ""}
            autocomplete="email"
            onInput={(event: InputEvent) => email.onInput(event)}
            onBlur={(event: FocusEvent) => email.onBlur(event)}
            aria-invalid={!email.isValid}
            aria-describedby={describedBy(email.id, email.hint, email.error)}
            disabled={email.isValidating}
          />
          <Show when={email.hint !== undefined}>
            <p class="hint" id={`${email.id}-hint`}>
              {email.hint}
            </p>
          </Show>
          <Show when={email.error !== undefined}>
            <p class="error" id={`${email.id}-error`}>
              {email.error}
            </p>
          </Show>
        </div>

        <div class="field">
          <label for={age.id}>{age.label}</label>
          <input
            id={age.id}
            name={age.name}
            type="number"
            min="18"
            max="120"
            value={age.value}
            onInput={(event: InputEvent) => age.onInput(event)}
            onBlur={(event: FocusEvent) => age.onBlur(event)}
            aria-invalid={!age.isValid}
            aria-describedby={describedBy(age.id, age.hint, age.error)}
            disabled={age.isValidating}
          />
          <Show when={age.error !== undefined}>
            <p class="error" id={`${age.id}-error`}>
              {age.error}
            </p>
          </Show>
        </div>

        <div class="field">
          <label for={avatar.id}>{avatar.label}</label>
          <input
            id={avatar.id}
            name={avatar.name}
            type="file"
            accept="image/*"
            onChange={(event: Event) => {
              const input = event.currentTarget;
              if (!(input instanceof HTMLInputElement)) {
                return;
              }
              const file = input.files?.[0];
              if (file !== undefined) {
                form.upload(file);
              }
            }}
            aria-describedby={describedBy(avatar.id, avatar.hint, avatar.error)}
            disabled={avatar.isValidating}
          />
          <Show when={avatar.hint !== undefined}>
            <p class="hint" id={`${avatar.id}-hint`}>
              {avatar.hint}
            </p>
          </Show>
          <Show when={!avatar.isReady}>
            <p class="pending">Загрузка...</p>
          </Show>
          <Show when={avatar.value !== ""}>
            <p class="file-name">Выбран файл: {avatar.value}</p>
          </Show>
          <Show when={avatar.error !== undefined}>
            <p class="error" id={`${avatar.id}-error`}>
              {avatar.error}
            </p>
          </Show>
        </div>

        <fieldset class="group">
          <legend>{address.label}</legend>

          <div class="field">
            <label for={city.id}>
              {city.label}
              {city.isRequired ? " *" : ""}
            </label>
            <input
              id={city.id}
              name={city.name}
              value={city.value}
              placeholder={city.placeholder ?? ""}
              autocomplete="address-level2"
              onInput={(event: InputEvent) => city.onInput(event)}
              onBlur={(event: FocusEvent) => city.onBlur(event)}
              aria-invalid={!city.isValid}
              aria-describedby={describedBy(city.id, city.hint, city.error)}
              disabled={city.isValidating}
            />
            <Show when={city.hint !== undefined}>
              <p class="hint" id={`${city.id}-hint`}>
                {city.hint}
              </p>
            </Show>
            <Show when={city.error !== undefined}>
              <p class="error" id={`${city.id}-error`}>
                {city.error}
              </p>
            </Show>
          </div>

          <div class="field">
            <label for={state.id}>
              {state.label}
              {state.isRequired ? " *" : ""}
            </label>
            <select
              id={state.id}
              name={state.name}
              value={state.value}
              autocomplete="address-level1"
              onChange={(event: Event) => state.onChange(event)}
              onBlur={(event: FocusEvent) => state.onBlur(event)}
              aria-invalid={!state.isValid}
              aria-describedby={describedBy(state.id, state.hint, state.error)}
              disabled={state.isValidating}
            >
              <option value="">{state.placeholder ?? "Выберите регион"}</option>
              <option value="moscow">Москва</option>
              <option value="spb">Санкт-Петербург</option>
              <option value="kazan">Казань</option>
              <option value="novosibirsk">Новосибирск</option>
            </select>
            <Show when={state.hint !== undefined}>
              <p class="hint" id={`${state.id}-hint`}>
                {state.hint}
              </p>
            </Show>
            <Show when={state.error !== undefined}>
              <p class="error" id={`${state.id}-error`}>
                {state.error}
              </p>
            </Show>
          </div>
        </fieldset>

        <div class="field">
          <label for={interests.id}>{interests.label}</label>
          <input
            id={interests.id}
            name={interests.name}
            value={interests.value}
            placeholder={interests.placeholder ?? ""}
            onInput={(event: InputEvent) => interests.onInput(event)}
            onBlur={(event: FocusEvent) => interests.onBlur(event)}
            aria-invalid={!interests.isValid}
            aria-describedby={describedBy(
              interests.id,
              interests.hint,
              interests.error,
            )}
            disabled={interests.isValidating}
          />
          <Show when={interests.error !== undefined}>
            <p class="error" id={`${interests.id}-error`}>
              {interests.error}
            </p>
          </Show>
        </div>

        <div class="actions">
          <button type="submit" disabled={!form.isReady || form.isSubmitting}>
            Сохранить
          </button>
          <Show when={form.isSubmitting}>
            <span class="pending">Отправляем...</span>
          </Show>
          <Show when={this.vm.status !== ""}>
            <span class="success">{this.vm.status}</span>
          </Show>
        </div>

        <p class="hint">
          Подсказка: email <code>taken@example.com</code> вернёт серверную ошибку.
        </p>
      </form>
    </main>
  );
}
