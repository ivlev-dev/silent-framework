import type { Child, Children } from "@ivlev-dev/silent-core";
import type {
  ListboxItem,
  ListboxOption,
} from "./listbox-engine.js";

/**
 * Текстовые операции списков. Разметка опций может быть любой: строка,
 * число, массив, вложенный узел или функция. Для поиска и typeahead нужен
 * только текст, поэтому он извлекается без монтирования и без DOM-эффектов.
 */

function childText(value: Child): string {
  if (value === null || value === undefined || typeof value === "boolean") {
    return "";
  }
  if (typeof value === "function") {
    return childrenText(value as unknown as Children);
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "object" && "nodeType" in value) {
    return (value as Node).textContent ?? "";
  }
  if (
    typeof value === "object"
    && typeof (value as Iterable<unknown>)[Symbol.iterator] === "function"
  ) {
    let text = "";
    for (const child of value as Iterable<Child>) {
      const part = childText(child);
      if (part === "") continue;
      text = text === "" ? part : `${text} ${part}`;
    }
    return text;
  }
  return String(value);
}

/** Видимый текст `Children` — для фильтра, typeahead и `title`. */
export function childrenText(value: Children): string {
  if (typeof value === "function") return childrenText(value());
  return childText(value);
}

/** Нормализация поисковой строки: регистр, диакритика, лишние пробелы. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/** Пустой запрос совпадает с любой опцией. */
export function matchesQuery(text: string, query: string): boolean {
  const normalized = normalizeSearch(query);
  if (normalized === "") return true;
  return normalizeSearch(text).includes(normalized);
}

export type ListboxMatch = (option: ListboxOption, query: string) => boolean;

const defaultMatch: ListboxMatch = (option, query) =>
  matchesQuery(childrenText(option.label), query);

function filterOptionList(
  options: readonly ListboxOption[],
  query: string,
  match: ListboxMatch,
): ListboxOption[] {
  return options.filter((option) => match(option, query));
}

/**
 * Фильтрует плоский список или группы. Группа остаётся, если совпала её
 * подпись (тогда видны все опции) или если внутри есть совпадения.
 */
export function filterListboxItems(
  items: readonly ListboxItem[],
  query: string,
  match: ListboxMatch = defaultMatch,
): ListboxItem[] {
  if (normalizeSearch(query) === "") return items.slice();
  const result: ListboxItem[] = [];
  for (const item of items) {
    if (!("options" in item)) {
      if (match(item, query)) result.push(item);
      continue;
    }
    if (matchesQuery(childrenText(item.label), query)) {
      result.push(item);
      continue;
    }
    const options = filterOptionList(item.options, query, match);
    if (options.length === 0) continue;
    result.push({ label: item.label, options });
  }
  return result;
}

/** Плоский вариант фильтра — без групп. */
export function filterOptions(
  options: readonly ListboxOption[],
  query: string,
  match: ListboxMatch = defaultMatch,
): ListboxOption[] {
  if (normalizeSearch(query) === "") return options.slice();
  return filterOptionList(options, query, match);
}

/** Убирает дубликаты значений, сохраняя порядок. */
export function uniqueKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}
