/**
 * Брейкпоинты (mobile-first).
 *
 * Источник истины — `breakpoints.json` рядом. Значения в пикселях, `em`-форма
 * считается от `baseFontSize: 16`. Тест `tests/tokens.test.ts` сверяет JSON,
 * этот модуль, CSS-литералы и таблицу в `docs/guides/ui.md`.
 */
const values = {
  xs: 0,
  sm: 360,
  md: 480,
  lg: 600,
  xl: 840,
  "2xl": 1200,
  "3xl": 1600,
  "4xl": 1920,
  "5xl": 2560,
  "6xl": 3840,
} as const;

export type Breakpoint = keyof typeof values;

/** Брейкпоинты в пикселях, от узкого к широкому. */
export const breakpoints: Readonly<Record<Breakpoint, number>> = values;

/** Брейкпоинты в `em` — то, что попадает в `@media (min-width: …)`. */
export const breakpointEm: Readonly<Record<Breakpoint, string>> = {
  xs: "0",
  sm: "22.5em",
  md: "30em",
  lg: "37.5em",
  xl: "52.5em",
  "2xl": "75em",
  "3xl": "100em",
  "4xl": "120em",
  "5xl": "160em",
  "6xl": "240em",
};

/** Порядок от узкого к широкому — используется в тестах и документации. */
export const breakpointOrder: readonly Breakpoint[] = [
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
];

export const baseFontSize = 16;

/**
 * `@media`-условие «от брейкпоинта и шире». Для `xs` возвращает `null`:
 * ограничение не нужно, стили mobile-first действуют всегда.
 */
export function mediaUp(breakpoint: Breakpoint): string | null {
  const em = breakpointEm[breakpoint];
  return breakpoint === "xs" ? null : `(min-width: ${em})`;
}

/**
 * `@media`-условие «уже брейкпоинта»: ширина строго меньше `min-width`.
 * Для `xs` возвращает `null` — narrower than 0 не существует.
 */
export function mediaDown(breakpoint: Breakpoint): string | null {
  const em = breakpointEm[breakpoint];
  if (breakpoint === "xs") return null;
  return `(max-width: ${Number.parseFloat(em) - 0.0625}em)`;
}
