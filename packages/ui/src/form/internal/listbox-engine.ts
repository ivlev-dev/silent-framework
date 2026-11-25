import type { Children } from "@ivlev-dev/silent-core";
import { normalizeSearch } from "./listbox-filter.js";

/**
 * Чистое ядро listbox: модель опций, навигация, typeahead и выбор.
 *
 * Здесь нет DOM и сигналов: компоненты (Listbox, Select, Combobox) владеют
 * состоянием и разметкой, а движок отвечает за предсказуемое поведение.
 * Благодаря этому навигацию/фильтр можно тестировать без монтирования.
 */

export type ListboxValue = string | number;

export interface ListboxOption {
  readonly value: ListboxValue;
  readonly label: Children;
  readonly disabled?: boolean | undefined;
  /** Вторая строка опции: пояснение, адрес, код. */
  readonly description?: Children | undefined;
  /** Иконка/аватар перед подписью. */
  readonly leading?: Children | undefined;
  /** Дополнение справа: горячая клавиша, счётчик. */
  readonly trailing?: Children | undefined;
}

export interface ListboxGroup {
  readonly label: Children;
  readonly options: readonly ListboxOption[];
}

export type ListboxItem = ListboxOption | ListboxGroup;

export function isListboxGroup(item: ListboxItem): item is ListboxGroup {
  return "options" in item;
}

/** Внутренний ключ опции: значения сравниваются как строки. */
export function listboxKey(value: ListboxValue): string {
  return String(value);
}

/** Детерминированные id: от `id` контрола, без счётчиков. */
export function listboxId(base: string): string {
  return `${base}-listbox`;
}

export function listboxOptionId(base: string, index: number): string {
  return `${base}-option-${index}`;
}

export interface FlatListboxOption {
  readonly option: ListboxOption;
  readonly key: string;
  /** Порядковый номер среди всех опций (включая отфильтрованные). */
  readonly index: number;
  readonly group: ListboxGroup | null;
  /** Индекс группы или `-1` для плоского списка. */
  readonly groupIndex: number;
}

/** Разворачивает опции и группы в один массив с глобальными индексами. */
export function flattenListbox(
  items: readonly ListboxItem[],
): FlatListboxOption[] {
  const result: FlatListboxOption[] = [];
  let index = 0;
  let groupIndex = -1;
  for (const item of items) {
    if (!isListboxGroup(item)) {
      result.push({
        option: item,
        key: listboxKey(item.value),
        index,
        group: null,
        groupIndex: -1,
      });
      index += 1;
      continue;
    }
    groupIndex += 1;
    for (const option of item.options) {
      result.push({
        option,
        key: listboxKey(option.value),
        index,
        group: item,
        groupIndex,
      });
      index += 1;
    }
  }
  return result;
}

/** Индекс опции по её значению или `-1`. */
export function indexOfValue(
  flat: readonly FlatListboxOption[],
  value: ListboxValue | null | undefined,
): number {
  if (value === undefined || value === null) return -1;
  const key = listboxKey(value);
  for (let index = 0; index < flat.length; index += 1) {
    if (flat[index]?.key === key) return index;
  }
  return -1;
}

/** Первая/последняя включённая опция. */
export function edgeEnabledIndex(
  flat: readonly FlatListboxOption[],
  edge: "first" | "last",
): number {
  if (edge === "first") {
    for (let index = 0; index < flat.length; index += 1) {
      if (flat[index]?.option.disabled !== true) return index;
    }
    return -1;
  }
  for (let index = flat.length - 1; index >= 0; index -= 1) {
    if (flat[index]?.option.disabled !== true) return index;
  }
  return -1;
}

/**
 * Следующая включённая опция. `wrap` замыкает список; при `false` у края
 * возвращается `-1`. `from = -1` трактуется как «до первой».
 */
export function nextEnabledIndex(
  flat: readonly FlatListboxOption[],
  from: number,
  step: 1 | -1,
  wrap = true,
): number {
  const count = flat.length;
  if (count === 0) return -1;
  let index = from;
  if (index < -1) index = -1;
  if (index >= count) index = count - 1;
  for (let attempt = 0; attempt < count; attempt += 1) {
    index += step;
    if (index < 0) {
      if (!wrap) return -1;
      index = count - 1;
    } else if (index >= count) {
      if (!wrap) return -1;
      index = 0;
    }
    if (flat[index]?.option.disabled !== true) return index;
  }
  return -1;
}

/**
 * PageUp/PageDown: сдвиг на `pageSize` включённых опций без замыкания.
 * Если двигаться некуда — остаётся текущая позиция.
 */
export function pageEnabledIndex(
  flat: readonly FlatListboxOption[],
  from: number,
  direction: 1 | -1,
  pageSize: number,
): number {
  const size = Math.max(1, Math.floor(pageSize));
  if (from < 0) {
    return direction === 1 ? edgeEnabledIndex(flat, "first") : edgeEnabledIndex(flat, "last");
  }
  let index = from;
  for (let step = 0; step < size; step += 1) {
    const next = nextEnabledIndex(flat, index, direction, false);
    if (next < 0) break;
    index = next;
  }
  return index;
}

export interface TypeaheadState {
  readonly query: string;
  readonly key: string;
  readonly at: number;
}

export interface TypeaheadResult {
  readonly index: number;
  readonly state: TypeaheadState;
}

export const TYPEAHEAD_TIMEOUT = 500;

export function createTypeaheadState(): TypeaheadState {
  return { query: "", key: "", at: 0 };
}

export type OptionText = (option: ListboxOption) => string;

function findByPrefix(
  flat: readonly FlatListboxOption[],
  query: string,
  start: number,
  textOf: OptionText,
): number {
  const count = flat.length;
  if (count === 0) return -1;
  for (let offset = 0; offset < count; offset += 1) {
    const index = ((start + offset) % count + count) % count;
    const entry = flat[index];
    if (entry === undefined || entry.option.disabled === true) continue;
    const text = normalizeSearch(textOf(entry.option));
    if (text.startsWith(query)) return index;
  }
  return -1;
}

/**
 * Инкрементальный typeahead. Повтор одной и той же буквы в пределах
 * `timeout` перебирает совпадения, а не накапливает строку. Возвращает
 * новый индекс и состояние; если совпадений нет — индекс `-1`.
 */
export function typeahead(
  state: TypeaheadState,
  flat: readonly FlatListboxOption[],
  char: string,
  now: number,
  from: number,
  textOf: OptionText,
  timeout = TYPEAHEAD_TIMEOUT,
): TypeaheadResult {
  if (char.length !== 1) return { index: -1, state };
  const within = state.query !== "" && now - state.at <= timeout;
  const repeated = within
    && [...state.query].every((item) => item === state.query[0])
    && state.query[0] === char;
  const query = repeated ? char : within ? state.query + char : char;
  const normalized = normalizeSearch(query);
  if (normalized === "") return { index: -1, state };

  // Тот же символ — циклический перебор; продолжение строки ищем с начала,
  // чтобы префикс находился независимо от текущей позиции.
  const start = repeated || !within ? from + 1 : 0;
  const index = findByPrefix(flat, normalized, start, textOf);
  return {
    index,
    state: { query, key: char, at: now },
  };
}

/** Значения из `value`/`field.value` как строковые ключи. */
export function valueKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

/** Одиночное значение как строка (пустая строка для `null`/`undefined`). */
export function singleValueKey(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value[0];
    return first === undefined || first === null ? "" : String(first);
  }
  if (value === undefined || value === null) return "";
  return String(value);
}

/** Добавляет/убирает ключ при `multiple`; одиночный выбор не снимается. */
export function toggleSelectedKey(
  keys: readonly string[],
  key: string,
  multiple: boolean,
): string[] {
  if (!multiple) return [key];
  return keys.includes(key)
    ? keys.filter((item) => item !== key)
    : [...keys, key];
}

export interface SyntheticChangeTarget {
  readonly value?: string | undefined;
  readonly multiple?: true | undefined;
  readonly selectedOptions?: readonly { readonly value: string }[] | undefined;
}

export type SyntheticChangeEvent = Event;

/**
 * Событие `change` для `field.onChange` без нативного контрола.
 * Форма читает `currentTarget.value` (одиночный) либо
 * `currentTarget.selectedOptions` при `multiple`.
 */
export function createSelectChangeEvent(
  keys: readonly string[],
  multiple: boolean,
): SyntheticChangeEvent {
  const target: SyntheticChangeTarget = multiple
    ? {
        multiple: true,
        selectedOptions: keys.map((value) => ({ value })),
      }
    : { value: keys[0] ?? "" };
  let defaultPrevented = false;
  const event = {
    type: "change",
    bubbles: true,
    cancelable: true,
    target,
    currentTarget: target,
    get defaultPrevented(): boolean {
      return defaultPrevented;
    },
    preventDefault(): void {
      defaultPrevented = true;
    },
    stopPropagation(): void {
      // Синтетическое событие не всплывает.
    },
  };
  return event as unknown as SyntheticChangeEvent;
}
