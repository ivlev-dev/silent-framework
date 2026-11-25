/**
 * Чистое ядро OTP-поля: фильтрация символов, посимвольный ввод, вставка,
 * Backspace/Delete и переходы фокуса. Компонент владеет DOM, а правила
 * набора проверяются без монтирования.
 */

export type OtpCharSet = "numeric" | "alphanumeric" | "letters";

export type OtpChangeReason = "input" | "paste" | "keyboard" | "clear";

const NUMERIC = /^\p{N}$/u;
const LETTERS = /^\p{L}$/u;

function accepts(char: string, charSet: OtpCharSet): boolean {
  if (charSet === "numeric") return NUMERIC.test(char);
  if (charSet === "letters") return LETTERS.test(char);
  return NUMERIC.test(char) || LETTERS.test(char);
}

/** Оставляет только символы выбранного набора, сохраняя порядок. */
export function sanitizeOtpText(text: string, charSet: OtpCharSet): string {
  let result = "";
  for (const char of text) {
    if (accepts(char, charSet)) result += char;
  }
  return result;
}

/** Символы поля фиксированной длины: внешнее значение обрезается/дополняется. */
export function otpChars(value: string, length: number): string[] {
  const size = Math.max(0, Math.trunc(length));
  const chars: string[] = [];
  for (let index = 0; index < size; index += 1) {
    chars.push(value[index] ?? "");
  }
  return chars;
}

export interface OtpState {
  readonly chars: readonly string[];
  readonly focus: number;
}

export type OtpAction =
  | {
      readonly type: "input";
      readonly index: number;
      readonly text: string;
      readonly length: number;
      readonly charSet: OtpCharSet;
    }
  | {
      readonly type: "paste";
      readonly index: number;
      readonly text: string;
      readonly length: number;
      readonly charSet: OtpCharSet;
    }
  | {
      readonly type: "key";
      readonly index: number;
      readonly key: string;
      readonly length: number;
    }
  | {
      readonly type: "clear";
      readonly length: number;
    };

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.trunc(index)));
}

export function createOtpState(
  value: string,
  length: number,
  charSet: OtpCharSet,
): OtpState {
  const chars = otpChars(sanitizeOtpText(value, charSet), length);
  const firstEmpty = chars.findIndex((char) => char === "");
  return {
    chars,
    focus: firstEmpty === -1 ? Math.max(0, chars.length - 1) : firstEmpty,
  };
}

function writeChars(
  chars: readonly string[],
  length: number,
  index: number,
  incoming: string,
): { readonly chars: string[]; readonly focus: number } {
  const size = Math.max(0, Math.trunc(length));
  const next: string[] = [];
  for (let cursor = 0; cursor < size; cursor += 1) {
    next.push(chars[cursor] ?? "");
  }
  if (size === 0) return { chars: next, focus: 0 };
  const start = clampIndex(index, size);
  if (incoming === "") {
    next[start] = "";
    return { chars: next, focus: start };
  }
  const incomingChars = Array.from(incoming);
  let cursor = start;
  for (const char of incomingChars) {
    if (cursor >= size) break;
    next[cursor] = char;
    cursor += 1;
  }
  return { chars: next, focus: clampIndex(cursor, size) };
}

/** Единый редьюсер действий ввода; возвращает новое состояние. */
export function otpReducer(state: OtpState, action: OtpAction): OtpState {
  const length = Math.max(0, Math.trunc(action.length));
  const chars = state.chars.slice(0, length);
  while (chars.length < length) chars.push("");
  if (action.type === "clear") {
    return { chars: chars.map(() => ""), focus: 0 };
  }
  if (length === 0) return { chars: [], focus: 0 };
  const index = clampIndex(action.index, length);

  if (action.type === "input" || action.type === "paste") {
    const text = sanitizeOtpText(action.text, action.charSet);
    if (text === "" && action.text !== "") {
      return { chars, focus: index };
    }
    const written = writeChars(chars, length, index, text);
    return { chars: written.chars, focus: written.focus };
  }

  switch (action.key) {
    case "ArrowLeft":
      return { chars, focus: Math.max(0, index - 1) };
    case "ArrowRight":
      return { chars, focus: Math.min(length - 1, index + 1) };
    case "Home":
      return { chars, focus: 0 };
    case "End":
      return { chars, focus: length - 1 };
    case "Backspace": {
      if ((chars[index] ?? "") !== "") {
        chars[index] = "";
        return { chars, focus: index };
      }
      if (index > 0) {
        chars[index - 1] = "";
        return { chars, focus: index - 1 };
      }
      return { chars, focus: index };
    }
    case "Delete": {
      chars[index] = "";
      return { chars, focus: index };
    }
    default:
      return { chars, focus: index };
  }
}

/** Полный код: все разряды заполнены. */
export function isOtpComplete(
  chars: readonly string[],
  length: number,
): boolean {
  const size = Math.max(0, Math.trunc(length));
  if (size === 0) return false;
  for (let index = 0; index < size; index += 1) {
    if ((chars[index] ?? "") === "") return false;
  }
  return true;
}

/** Индекс первого пустого разряда; для полного кода — последний. */
export function otpNextIndex(
  chars: readonly string[],
  length: number,
): number {
  const size = Math.max(0, Math.trunc(length));
  const empty = chars.findIndex((char) => char === "");
  if (empty !== -1) return empty;
  return Math.max(0, size - 1);
}

/**
 * Границы групп: индексы, после которых нужен визуальный разрыв.
 * Хвост, не попавший в `groups`, становится последней группой.
 */
export function otpGroupBoundaries(
  groups: readonly number[] | undefined,
  length: number,
): number[] {
  const size = Math.max(0, Math.trunc(length));
  const result: number[] = [];
  let sum = 0;
  for (const group of groups ?? []) {
    if (!Number.isFinite(group) || group <= 0) continue;
    sum += Math.trunc(group);
    if (sum >= size) break;
    result.push(sum);
  }
  return result;
}
