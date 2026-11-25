import type { FieldProps as FormFieldProps } from "@ivlev-dev/silent-form";
import type { Children } from "@ivlev-dev/silent-core";

/**
 * Поле формы из `@ivlev-dev/silent-form`.
 *
 * `field` — источник значений; явные пропсы контрола — overrides.
 * Spread `{...field}` не используется: контрол читает конкретные свойства
 * (`field.value`, `field.error`, …) и подписывается на них через JSX.
 */
export type BoundField<Value = string> = FormFieldProps<Value>;

export type ControlSize = "sm" | "md" | "lg";

/** Оформление выбора: обычная строка, карточка или плитка. */
export type ChoiceVariant = "default" | "card" | "tile";

/** Направление группы выбора. */
export type GroupOrientation = "vertical" | "horizontal";

/** Число колонок сетки группы выбора. */
export type GroupColumns = 1 | 2 | 3 | 4;

/** Строковый ключ значения опции — общий для id и сравнений. */
export function valueKey(value: string | number): string {
  return String(value);
}

/** Стабильный id опции: `<база>-<значение>` без небезопасных символов. */
export function optionDomId(base: string, value: string | number): string {
  return `${base}-${valueKey(value).replace(/[^A-Za-z0-9_-]+/gu, "-")}`;
}

/** Подставляет `{count}` в строку-шаблон из `UiConfigProvider`. */
export function withCount(template: string, count: number): string {
  return template.replace(/\{count\}/gu, String(count));
}

/** Setter-заглушка для `bindValue`/`bindChecked`. */
export const NO_WRITE = (_value: unknown): void => undefined;

/**
 * Стабильный DOM-id: явный `id`, детерминированный из имени поля или
 * fallback-база контрола. Никогда не использует счётчики/`Math.random`,
 * поэтому SSR и клиент дают одинаковый id.
 */
export function resolveControlId(
  id: string | undefined,
  name: string | undefined,
  fallback: string,
): string {
  if (id !== undefined && id !== "") return id;
  if (name !== undefined && name !== "") {
    return `sui-${name.replace(/[^A-Za-z0-9_-]+/gu, "-")}`;
  }
  return `sui-${fallback}`;
}

export function hintIdFor(id: string | undefined): string {
  return id === undefined ? "" : `${id}-hint`;
}

export function errorIdFor(id: string | undefined): string {
  return id === undefined ? "" : `${id}-error`;
}

export function descriptionIdFor(id: string | undefined): string {
  return id === undefined ? "" : `${id}-description`;
}

/** Склеивает `aria-describedby` из непустых id. */
export function describedBy(
  ...ids: readonly (string | undefined)[]
): string | undefined {
  const present = ids.filter(
    (id): id is string => id !== undefined && id !== "",
  );
  return present.length === 0 ? undefined : present.join(" ");
}

/** Маркер «контент есть»: пустая строка/null/undefined не считаются. */
export function hasContent(value: Children): boolean {
  return value !== undefined && value !== null && value !== "";
}
