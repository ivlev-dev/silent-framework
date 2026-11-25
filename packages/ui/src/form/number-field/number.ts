/**
 * Числовая модель NumberField: точность, разбор и форматирование.
 *
 * Здесь нет DOM и сигналов, поэтому правила ввода проверяются отдельно
 * от монтирования: компонент отвечает только за клавиши и разметку.
 */

export type NumberFormat = "plain" | "grouped" | ((value: number) => string);

/** Десятичных знаков в шаге: `0.01` → 2, `1` → 0, `1.5e-7` → 8. */
export function precisionOfStep(step: number): number {
  if (!Number.isFinite(step) || step === 0) return 0;
  const [mantissa = "", exponent = "0"] = String(Math.abs(step)).split("e");
  const decimals = mantissa.split(".")[1]?.length ?? 0;
  const digits = decimals - Number(exponent);
  return Math.min(20, Math.max(0, digits));
}

/** Округление без артефактов вида `0.30000000000000004`. */
export function roundToPrecision(value: number, precision: number): number {
  if (!Number.isFinite(value)) return value;
  const digits = Math.min(20, Math.max(0, Math.trunc(precision)));
  // Сдвиг через строку выполняет десятичное округление, а не двоичное:
  // `1.005.toFixed(2)` даёт `1.00`, а `1.005e2` → 100.5 → 101.
  const shifted = Number(`${value}e${digits}`);
  if (!Number.isFinite(shifted)) return Number(value.toFixed(digits));
  const rounded = Math.sign(shifted) * Math.round(Math.abs(shifted));
  const result = Number(`${rounded}e-${digits}`);
  return Number.isFinite(result) ? result : Number(value.toFixed(digits));
}

/** Ограничение значения диапазоном; `undefined` — границы нет. */
export function clampNumber(
  value: number,
  min?: number | undefined,
  max?: number | undefined,
): number {
  let next = value;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}

/** Округление + ограничение — общая нормализация для ввода и шагов. */
export function normalizeNumberValue(
  value: number,
  options: {
    readonly min?: number | undefined;
    readonly max?: number | undefined;
    readonly precision: number;
  },
): number {
  return clampNumber(
    roundToPrecision(value, options.precision),
    options.min,
    options.max,
  );
}

/** Разделитель целой и дробной части для локали (`,` в ru-RU). */
export function decimalSeparatorFor(locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1.5);
    const decimal = parts.find((part) => part.type === "decimal");
    if (decimal !== undefined && decimal.value !== "") return decimal.value;
  } catch {
    // Неизвестная локаль — используем точку.
  }
  return ".";
}

/** Текст для редактирования: без группировки, с локальным разделителем. */
export function editableNumberText(value: number, locale: string): string {
  const separator = decimalSeparatorFor(locale);
  const text = String(value);
  return separator === "." ? text : text.replace(".", separator);
}

function groupSeparated(text: string, separator: string): string | null {
  const parts = text.split(separator);
  if (parts.length < 2) return null;
  const [first, ...rest] = parts;
  if (first === undefined) return null;
  const grouped = rest.every((part) => part.length === 3);
  if (!grouped) return null;
  return `${first}${rest.join("")}`;
}

/**
 * Разбор введённого текста. Понимает пробелы/NBSP как группировку,
 * запятую и точку как десятичный разделитель, минус Unicode и `e`-запись.
 * Возвращает `null`, если число не распознано.
 */
export function parseNumberText(text: string): number | null {
  let value = text.trim();
  if (value === "") return null;
  value = value
    .replace(/[\s\u00a0\u202f']/gu, "")
    .replace(/\u2212/gu, "-");
  if (value === "" || value === "-" || value === "+") return null;

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      value = value.replace(/\./gu, "").replace(/,/gu, ".");
    } else {
      value = value.replace(/,/gu, "");
    }
  } else if (lastComma !== -1) {
    const parts = value.split(",");
    if (parts.length > 2) {
      const grouped = groupSeparated(value, ",");
      if (grouped !== null) {
        value = grouped;
      } else {
        const decimal = parts.pop() ?? "";
        value = `${parts.join("")}.${decimal}`;
      }
    } else {
      // Одна запятая — десятичный разделитель (ru), а не группировка.
      value = value.replace(",", ".");
    }
  } else if (lastDot !== -1) {
    const grouped = groupSeparated(value, ".");
    value = grouped ?? value;
  }

  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Группировка по локали с ограничением дробной части. */
export function formatGroupedNumber(
  value: number,
  locale: string,
  precision: number,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: Math.min(20, Math.max(0, precision)),
    }).format(value);
  } catch {
    return String(value);
  }
}

/** Отображаемый текст по режиму `format`; ошибка форматтера — fallback. */
export function formatNumberValue(
  value: number,
  options: {
    readonly format?: NumberFormat | undefined;
    readonly locale: string;
    readonly precision: number;
  },
): string {
  const format = options.format ?? "plain";
  if (typeof format === "function") {
    const text = format(value);
    return typeof text === "string" ? text : String(text);
  }
  if (format === "grouped") {
    return formatGroupedNumber(value, options.locale, options.precision);
  }
  return String(value);
}

/** Подпись для `aria-valuetext`: отформатированное значение и единица. */
export function numberValueText(
  value: number | null,
  options: {
    readonly format?: NumberFormat | undefined;
    readonly locale: string;
    readonly precision: number;
    readonly unit?: string | undefined;
  },
): string {
  if (value === null) return "";
  const text = formatNumberValue(value, options);
  return options.unit === undefined || options.unit === ""
    ? text
    : `${text} ${options.unit}`;
}
