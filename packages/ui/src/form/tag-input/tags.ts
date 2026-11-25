/**
 * Чистая модель TagInput: нормализация, разбиение вставки, добавление с
 * ограничениями `max`/`unique`/длины и удаление. Без DOM и сигналов.
 */

export type TagNormalizer = (value: string) => string;
export type TagValidator = (value: string) => boolean;

export interface AddTagsOptions {
  readonly max?: number | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly unique?: boolean | undefined;
  readonly normalize?: TagNormalizer | undefined;
  readonly validate?: TagValidator | undefined;
}

const KEY_DELIMITERS = new Set([
  "Enter",
  "NumpadEnter",
  "Tab",
  "Space",
]);

/** Клавиша-разделитель (`Enter`, `Tab`) — не текст для разделения вставки. */
export function isKeyDelimiter(delimiter: string): boolean {
  return KEY_DELIMITERS.has(delimiter);
}

/** Разделители-символы; клавиши и пустые строки отбрасываются. */
export function literalDelimiters(
  delimiters: readonly string[],
): readonly string[] {
  return delimiters.filter(
    (delimiter) => delimiter !== "" && !isKeyDelimiter(delimiter),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Разбивает вставленный текст на теги: символьные разделители + переводы
 * строк. Пустые куски сохраняются для последующей нормализации.
 */
export function splitTagText(
  text: string,
  delimiters: readonly string[],
): string[] {
  const literals = literalDelimiters(delimiters);
  if (literals.length === 0) return [text];
  const pattern = new RegExp(
    `(?:${literals.map(escapeRegExp).join("|")}|\\r?\\n)`,
    "gu",
  );
  return text.split(pattern);
}

/** Нормализация по умолчанию: обрезка внешних пробелов. */
export function normalizeTagText(value: string): string {
  return value.trim();
}

function tagAllowed(
  tag: string,
  next: readonly string[],
  options: AddTagsOptions,
): boolean {
  if (tag === "") return false;
  if (options.minLength !== undefined && tag.length < options.minLength) {
    return false;
  }
  if (options.maxLength !== undefined && tag.length > options.maxLength) {
    return false;
  }
  if (options.unique !== false && next.includes(tag)) return false;
  if (options.validate !== undefined && !options.validate(tag)) return false;
  if (options.max !== undefined && next.length >= options.max) return false;
  return true;
}

/**
 * Добавляет теги по порядку. Некорректные/дубликаты пропускаются, при
 * достижении `max` оставшиеся кандидаты не добавляются. Возвращает новый
 * массив; если ничего не изменилось — исходный (сравнение по ссылке).
 */
export function addTagValues(
  current: readonly string[],
  candidates: readonly string[],
  options: AddTagsOptions = {},
): readonly string[] {
  const normalize = options.normalize ?? normalizeTagText;
  let next: string[] | null = null;
  for (const raw of candidates) {
    const tag = normalize(raw);
    const target = next ?? current;
    if (!tagAllowed(tag, target, options)) {
      if (
        options.max !== undefined
        && target.length >= options.max
        && tag !== ""
      ) {
        break;
      }
      continue;
    }
    if (next === null) next = [...current];
    next.push(tag);
  }
  return next ?? current;
}

/** Удаление по индексу: сохраняет поведение Backspace на последнем теге. */
export function removeTagAt(
  current: readonly string[],
  index: number,
): readonly string[] {
  if (index < 0 || index >= current.length) return current;
  return current.filter((_, position) => position !== index);
}

/** Удаление по значению (кнопка на чипе); первое совпадение. */
export function removeTagValue(
  current: readonly string[],
  value: string,
): readonly string[] {
  const index = current.indexOf(value);
  return index === -1 ? current : removeTagAt(current, index);
}

/** Значение поля как массив строк: защищает от строки/одиночного значения. */
export function tagValues(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string | number => (
        typeof item === "string" || typeof item === "number"
      ))
      .map((item) => String(item));
  }
  if (typeof value === "string" && value !== "") return [value];
  if (typeof value === "number") return [String(value)];
  return [];
}
