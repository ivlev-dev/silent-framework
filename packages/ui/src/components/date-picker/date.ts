const DAY_MS = 86_400_000;

export interface DateLabels {
  readonly dialog: string;
  readonly clear: string;
  readonly today: string;
  readonly done: string;
  readonly previousMonth: string;
  readonly nextMonth: string;
  readonly chooseMonth: string;
  readonly chooseYear: string;
  readonly selectDate: string;
}

const RU_LABELS: DateLabels = {
  dialog: "Выбор даты",
  clear: "Очистить дату",
  today: "Сегодня",
  done: "Готово",
  previousMonth: "Предыдущий месяц",
  nextMonth: "Следующий месяц",
  chooseMonth: "Выбор месяца",
  chooseYear: "Выбор года",
  selectDate: "Выберите дату",
};

const EN_LABELS: DateLabels = {
  dialog: "Choose date",
  clear: "Clear date",
  today: "Today",
  done: "Done",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  chooseMonth: "Choose month",
  chooseYear: "Choose year",
  selectDate: "Choose a date",
};

export function dateLabels(locale: string): DateLabels {
  return locale.toLowerCase().startsWith("en") ? EN_LABELS : RU_LABELS;
}

export function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function addDays(value: Date, amount: number): Date {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate() + amount,
  );
}

export function addMonths(value: Date, amount: number): Date {
  const target = new Date(value.getFullYear(), value.getMonth() + amount, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(value.getDate(), lastDay));
  return target;
}

export function isSameDay(
  left: Date | null | undefined,
  right: Date | null | undefined,
): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
  );
}

export function isSameMonth(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
  );
}

export function compareDays(left: Date, right: Date): number {
  return startOfDay(left).getTime() - startOfDay(right).getTime();
}

export function daysBetween(left: Date, right: Date): number {
  return Math.round(
    (startOfDay(right).getTime() - startOfDay(left).getTime()) / DAY_MS,
  );
}

export function minDay(left: Date, right: Date): Date {
  return compareDays(left, right) <= 0 ? startOfDay(left) : startOfDay(right);
}

export function maxDay(left: Date, right: Date): Date {
  return compareDays(left, right) >= 0 ? startOfDay(left) : startOfDay(right);
}

export function isDateDisabled(
  date: Date,
  min?: Date | undefined,
  max?: Date | undefined,
): boolean {
  if (min !== undefined && compareDays(date, min) < 0) return true;
  if (max !== undefined && compareDays(date, max) > 0) return true;
  return false;
}

export function normalizeDate(
  value: Date | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null;
  if (Number.isNaN(value.getTime())) return null;
  return startOfDay(value);
}

export function dateKey(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoValue(value: Date | null): string {
  return value === null ? "" : value.toISOString();
}

function defaultWeekStart(locale: string): number {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("en-us") || normalized.startsWith("en-ca")) return 0;
  return 1;
}

export function resolveWeekStart(
  locale: string,
  firstDayOfWeek?: number | undefined,
): number {
  if (
    firstDayOfWeek !== undefined
    && Number.isInteger(firstDayOfWeek)
    && firstDayOfWeek >= 0
    && firstDayOfWeek <= 6
  ) {
    return firstDayOfWeek;
  }
  return defaultWeekStart(locale);
}

export function buildMonthDays(
  month: Date,
  weekStartsOn = 1,
): readonly Date[] {
  const first = startOfMonth(month);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = addDays(first, -offset);
  const days: Date[] = [];
  for (let index = 0; index < 42; index += 1) {
    days.push(addDays(start, index));
  }
  return days;
}

export function buildWeeks(
  month: Date,
  weekStartsOn = 1,
): readonly (readonly Date[])[] {
  const days = buildMonthDays(month, weekStartsOn);
  const weeks: Date[][] = [];
  for (let index = 0; index < 6; index += 1) {
    weeks.push(days.slice(index * 7, index * 7 + 7));
  }
  return weeks;
}

export function startOfWeek(value: Date, weekStartsOn = 1): Date {
  const offset = (value.getDay() - weekStartsOn + 7) % 7;
  return addDays(startOfDay(value), -offset);
}

export function endOfWeek(value: Date, weekStartsOn = 1): Date {
  return addDays(startOfWeek(value, weekStartsOn), 6);
}

function applyFormat(value: Date, format: string): string {
  const pad = (part: number, length = 2): string =>
    String(part).padStart(length, "0");
  return format.replace(
    /yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|mm|m|ss|s/gu,
    (token: string): string => {
      switch (token) {
        case "yyyy":
          return String(value.getFullYear()).padStart(4, "0");
        case "yy":
          return pad(value.getFullYear() % 100);
        case "MMMM":
          return monthName(value, "long");
        case "MMM":
          return monthName(value, "short");
        case "MM":
          return pad(value.getMonth() + 1);
        case "M":
          return String(value.getMonth() + 1);
        case "dd":
          return pad(value.getDate());
        case "d":
          return String(value.getDate());
        case "HH":
          return pad(value.getHours());
        case "H":
          return String(value.getHours());
        case "mm":
          return pad(value.getMinutes());
        case "m":
          return String(value.getMinutes());
        case "ss":
          return pad(value.getSeconds());
        case "s":
          return String(value.getSeconds());
        default:
          return token;
      }
    },
  );
}

export function formatDateValue(
  value: Date | null,
  format?: string | undefined,
  locale = "ru-RU",
): string {
  if (value === null) return "";
  if (format !== undefined && format !== "") return applyFormat(value, format);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function makeDate(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
): Date | null {
  if (
    !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hours < 0
    || hours > 23
    || minutes < 0
    || minutes > 59
    || seconds < 0
    || seconds > 59
  ) {
    return null;
  }
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hours, minutes, seconds, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hours
    || date.getMinutes() !== minutes
    || date.getSeconds() !== seconds
  ) {
    return null;
  }
  return date;
}

function parseIso(text: string): Date | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/u.exec(
    text,
  );
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = match[4] === undefined ? 0 : Number(match[4]);
  const minutes = match[5] === undefined ? 0 : Number(match[5]);
  const seconds = match[6] === undefined ? 0 : Number(match[6]);
  const local = makeDate(year, month, day, hours, minutes, seconds);
  if (local === null) return null;
  const zone = match[8];
  if (zone !== undefined) {
    const native = new Date(text);
    return Number.isNaN(native.getTime()) ? local : native;
  }
  return local;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface ParsedParts {
  year?: number | undefined;
  month?: number | undefined;
  day?: number | undefined;
  hours?: number | undefined;
  minutes?: number | undefined;
  seconds?: number | undefined;
}

function assignToken(parts: ParsedParts, token: string, raw: string): void {
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  switch (token) {
    case "yyyy":
      parts.year = value;
      break;
    case "yy":
      parts.year = value < 100 ? 2000 + value : value;
      break;
    case "MM":
    case "M":
      parts.month = value;
      break;
    case "dd":
    case "d":
      parts.day = value;
      break;
    case "HH":
    case "H":
      parts.hours = value;
      break;
    case "mm":
    case "m":
      parts.minutes = value;
      break;
    case "ss":
    case "s":
      parts.seconds = value;
      break;
    default:
      break;
  }
}

function parseWithPattern(text: string, pattern: string): Date | null {
  const tokens: string[] = [];
  const source: string[] = ["^"];
  const matcher = /yyyy|yy|MM|M|dd|d|HH|H|mm|m|ss|s/gu;
  let cursor = 0;
  for (const match of pattern.matchAll(matcher)) {
    const index = match.index ?? 0;
    source.push(escapeRegExp(pattern.slice(cursor, index)));
    const token = match[0];
    tokens.push(token);
    source.push(token === "yyyy" ? "(\\d{4})" : "(\\d{1,2})");
    cursor = index + token.length;
  }
  source.push(escapeRegExp(pattern.slice(cursor)), "$");
  const result = new RegExp(source.join(""), "u").exec(text);
  if (result === null) return null;
  const parts: ParsedParts = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const raw = result[index + 1];
    if (token === undefined || raw === undefined) return null;
    assignToken(parts, token, raw);
  }
  if (parts.year === undefined || parts.month === undefined || parts.day === undefined) {
    return null;
  }
  return makeDate(
    parts.year,
    parts.month,
    parts.day,
    parts.hours ?? 0,
    parts.minutes ?? 0,
    parts.seconds ?? 0,
  );
}

function parseLoose(text: string, locale: string): Date | null {
  const numbers = text.match(/\d+/gu);
  if (numbers !== null && numbers.length >= 3) {
    const [first, second, third] = numbers;
    if (first === undefined || second === undefined || third === undefined) {
      return null;
    }
    if (first.length === 4) {
      return makeDate(Number(first), Number(second), Number(third));
    }
    if (locale.toLowerCase().startsWith("en")) {
      return makeDate(Number(third), Number(first), Number(second));
    }
    return makeDate(Number(third), Number(second), Number(first));
  }
  if (/[A-Za-zА-Яа-яЁё]/u.test(text)) {
    const native = new Date(text);
    if (!Number.isNaN(native.getTime())) return native;
  }
  return null;
}

export interface DateParseOptions {
  readonly format?: string | undefined;
  readonly locale?: string | undefined;
  readonly parse?: ((text: string) => Date | null) | undefined;
}

export function parseDateValue(
  text: string,
  options: DateParseOptions = {},
): Date | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (options.parse !== undefined) {
    const custom = options.parse(trimmed);
    return custom === null || Number.isNaN(custom.getTime())
      ? null
      : startOfDay(custom);
  }
  const iso = parseIso(trimmed);
  if (iso !== null) return iso;
  if (options.format !== undefined && options.format !== "") {
    const patterned = parseWithPattern(trimmed, options.format);
    if (patterned !== null) return patterned;
  }
  return parseLoose(trimmed, options.locale ?? "ru-RU");
}

export function monthName(
  value: Date,
  width: "long" | "short" | "narrow" = "long",
  locale = "ru-RU",
): string {
  const text = new Intl.DateTimeFormat(locale, { month: width }).format(value);
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export function monthYearLabel(value: Date, locale: string): string {
  const text = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(value);
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export function weekdayLabels(
  locale: string,
  weekStartsOn = 1,
): readonly string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const base = new Date(2024, 0, 7);
  const labels: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(base, (index + weekStartsOn) % 7);
    const text = formatter.format(date);
    labels.push(text.charAt(0).toLocaleUpperCase(locale) + text.slice(1));
  }
  return labels;
}

export function fullDateLabel(
  value: Date,
  locale: string,
  today?: Date,
): string {
  const text = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
  }).format(value);
  const normalized = text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  return isSameDay(value, today) ? `${normalized}, ${dateLabels(locale).today}` : normalized;
}

export function formatDayCount(count: number, locale = "ru-RU"): string {
  if (locale.toLowerCase().startsWith("en")) {
    return count === 1 ? "1 day" : `${String(count)} days`;
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} дня`;
  }
  return `${count} дней`;
}
