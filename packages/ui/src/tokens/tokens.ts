/**
 * Токены дизайн-системы в TypeScript.
 *
 * Значения цветов дублируют `themes.css` (тест `tokens.test.ts` падает при
 * расхождении): CSS — то, что потребляют компоненты, TS — то, что нужно
 * JS-коду (тема, контраст, генерация палитры).
 */
export {
  baseFontSize,
  breakpointEm,
  breakpointOrder,
  breakpoints,
  mediaDown,
  mediaUp,
  type Breakpoint,
} from "./breakpoints.js";

/**
 * Исходная палитра бренда: тёплая бумажная база и глубокий navy с золотом.
 * Одна на светлую и тёмную темы; старые ключи сохранены как алиасы.
 */
export const palette = {
  ivory: "#F9F8F7",
  almond: "#EDEAE4",
  mist: "#ADB8BB",
  navy: "#153147",
  noir: "#232A2F",
  gold: "#CEA434",
  "navy-deep": "#193153",
  "navy-mid": "#122948",
  "navy-dark": "#0E1F33",
  white: "#FFFFFF",

  /* Алиасы прежней палитры: не ломают код, который читает `palette.primary`. */
  primary: "#153147",
  secondary: "#ADB8BB",
  tertiary: "#CEA434",
  neutralDarkest: "#0E1F33",
  neutralDark: "#153147",
  neutralLightest: "#F9F8F7",
} as const;

export type PaletteColor = keyof typeof palette;

/** Семантические роли Material 3 + акцентная пара для золотых CTA/хайлайтов. */
export interface SemanticColors {
  readonly primary: string;
  readonly "on-primary": string;
  readonly "primary-container": string;
  readonly "on-primary-container": string;
  readonly "primary-fixed": string;
  readonly "primary-fixed-dim": string;
  readonly "on-primary-fixed": string;
  readonly "on-primary-fixed-variant": string;

  readonly secondary: string;
  readonly "on-secondary": string;
  readonly "secondary-container": string;
  readonly "on-secondary-container": string;

  readonly tertiary: string;
  readonly "on-tertiary": string;
  readonly "tertiary-container": string;
  readonly "on-tertiary-container": string;

  /** Акцент (золото) — для CTA, хайлайтов и декоративных акцентов. */
  readonly accent: string;
  readonly "on-accent": string;

  readonly error: string;
  readonly "on-error": string;
  readonly "error-container": string;
  readonly "on-error-container": string;

  readonly success: string;
  readonly "on-success": string;
  readonly "success-container": string;
  readonly "on-success-container": string;

  readonly warning: string;
  readonly "on-warning": string;
  readonly "warning-container": string;
  readonly "on-warning-container": string;

  readonly surface: string;
  readonly "surface-dim": string;
  readonly "surface-bright": string;
  readonly "surface-container-lowest": string;
  readonly "surface-container-low": string;
  readonly "surface-container": string;
  readonly "surface-container-high": string;
  readonly "surface-container-highest": string;

  readonly "on-surface": string;
  readonly "on-surface-variant": string;
  readonly "on-surface-muted": string;

  readonly outline: string;
  readonly "outline-variant": string;

  readonly scrim: string;
  readonly shadow: string;

  readonly "inverse-surface": string;
  readonly "inverse-on-surface": string;
  readonly "inverse-primary": string;
}

export type SemanticColorRole = keyof SemanticColors;

/**
 * Светлая тема: ivory-бумага, almond-контейнеры, noir-текст и navy-основа.
 * `tertiary`/`accent` — золотая заливка (не текст); текст на золоте — noir.
 */
export const lightColors: SemanticColors = {
  primary: "#153147",
  "on-primary": "#F9F8F7",
  "primary-container": "#DCE3E3",
  "on-primary-container": "#153147",
  "primary-fixed": "#B9C7CC",
  "primary-fixed-dim": "#94A6AC",
  "on-primary-fixed": "#153147",
  "on-primary-fixed-variant": "#2C4550",

  secondary: "#4C5D68",
  "on-secondary": "#FFFFFF",
  "secondary-container": "#DCE3E4",
  "on-secondary-container": "#1C3038",

  tertiary: "#CEA434",
  "on-tertiary": "#232A2F",
  "tertiary-container": "#F2E3B8",
  "on-tertiary-container": "#33270A",

  accent: "#CEA434",
  "on-accent": "#232A2F",

  error: "#A8322A",
  "on-error": "#FFFFFF",
  "error-container": "#F6DAD6",
  "on-error-container": "#410E0B",

  success: "#1F6B45",
  "on-success": "#FFFFFF",
  "success-container": "#CFE9D9",
  "on-success-container": "#04291A",

  warning: "#7A5200",
  "on-warning": "#FFFFFF",
  "warning-container": "#F6E0B0",
  "on-warning-container": "#2E2000",

  surface: "#F9F8F7",
  "surface-dim": "#EDEAE4",
  "surface-bright": "#FFFFFF",
  "surface-container-lowest": "#FFFFFF",
  "surface-container-low": "#FBF9F6",
  "surface-container": "#F3F0EA",
  "surface-container-high": "#EDEAE4",
  "surface-container-highest": "#E4E0D7",

  "on-surface": "#232A2F",
  "on-surface-variant": "#42505A",
  "on-surface-muted": "#4D5A63",

  outline: "#6F7D80",
  "outline-variant": "#D5D2C9",

  scrim: "#0E1F33",
  shadow: "#153147",

  "inverse-surface": "#153147",
  "inverse-on-surface": "#F9F8F7",
  "inverse-primary": "#CEA434",
};

/**
 * Тёмная тема: глубокий navy (`#0E1F33` → `#193153`), ivory-текст и
 * золотой primary/accent с noir-текстом на заливке.
 */
export const darkColors: SemanticColors = {
  primary: "#E6C766",
  "on-primary": "#1A1405",
  "primary-container": "#153147",
  "on-primary-container": "#F3E3B4",
  "primary-fixed": "#E6C766",
  "primary-fixed-dim": "#CEA434",
  "on-primary-fixed": "#1A1405",
  "on-primary-fixed-variant": "#4A3A0C",

  secondary: "#ADB8BB",
  "on-secondary": "#12252E",
  "secondary-container": "#2A414B",
  "on-secondary-container": "#DCE3E4",

  tertiary: "#E6C766",
  "on-tertiary": "#1A1405",
  "tertiary-container": "#514015",
  "on-tertiary-container": "#F2E3B8",

  accent: "#E6C766",
  "on-accent": "#1A1405",

  error: "#F2B8B5",
  "on-error": "#3B0A0A",
  "error-container": "#5E1A16",
  "on-error-container": "#F6DAD6",

  success: "#8FD3A8",
  "on-success": "#062A18",
  "success-container": "#1C4A31",
  "on-success-container": "#CFE9D9",

  warning: "#E8C56A",
  "on-warning": "#2A1E00",
  "warning-container": "#4E3A0A",
  "on-warning-container": "#F6E0B0",

  surface: "#0E1F33",
  "surface-dim": "#081522",
  "surface-bright": "#23405E",
  "surface-container-lowest": "#0A1828",
  "surface-container-low": "#122948",
  "surface-container": "#153147",
  "surface-container-high": "#193153",
  "surface-container-highest": "#1E3A5C",

  "on-surface": "#F9F8F7",
  "on-surface-variant": "#C3CED2",
  "on-surface-muted": "#ADB8BB",

  outline: "#7E8C8F",
  "outline-variant": "#33495A",

  scrim: "#050D16",
  shadow: "#050D16",

  "inverse-surface": "#F9F8F7",
  "inverse-on-surface": "#153147",
  "inverse-primary": "#153147",
};

/** Список ролей в стабильном порядке — для тестов и генераторов. */
export const semanticRoles: readonly SemanticColorRole[] = [
  "primary",
  "on-primary",
  "primary-container",
  "on-primary-container",
  "primary-fixed",
  "primary-fixed-dim",
  "on-primary-fixed",
  "on-primary-fixed-variant",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "on-tertiary",
  "tertiary-container",
  "on-tertiary-container",
  "accent",
  "on-accent",
  "error",
  "on-error",
  "error-container",
  "on-error-container",
  "success",
  "on-success",
  "success-container",
  "on-success-container",
  "warning",
  "on-warning",
  "warning-container",
  "on-warning-container",
  "surface",
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "on-surface",
  "on-surface-variant",
  "on-surface-muted",
  "outline",
  "outline-variant",
  "scrim",
  "shadow",
  "inverse-surface",
  "inverse-on-surface",
  "inverse-primary",
];

/** Прозрачность state layers (накладывается на `currentColor`). */
export const stateLayerOpacity = {
  hover: 0.08,
  focus: 0.12,
  pressed: 0.12,
  dragged: 0.16,
  disabled: 0.38,
  disabledContainer: 0.12,
} as const;

export type StateLayer = keyof typeof stateLayerOpacity;

/** Шкала отступов (4px base). */
export const spacing = {
  0: "0",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  7: "2rem",
  8: "2.5rem",
  9: "3rem",
  10: "4rem",
} as const;

export type SpacingStep = keyof typeof spacing;

/** Радиусы: сдержанные 4/8/12/16/24, `full` — только для аватаров и кругов. */
export const radii = {
  none: "0",
  xs: "0.25rem",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.5rem",
  full: "999px",
  card: "1rem",
  dialog: "1.5rem",
  sheet: "1.5rem",
} as const;

export type Radius = keyof typeof radii;

/**
 * Elevation: мягкие navy-tinted тени из `--sui-color-shadow-rgb` — без
 * обязательного `color-mix`; работают в старых WebView (TV).
 */
export const elevation = {
  0: "none",
  1: "0 1px 2px rgba(var(--sui-color-shadow-rgb), 0.10), 0 1px 3px 1px rgba(var(--sui-color-shadow-rgb), 0.06)",
  2: "0 2px 4px rgba(var(--sui-color-shadow-rgb), 0.10), 0 4px 12px 2px rgba(var(--sui-color-shadow-rgb), 0.08)",
  3: "0 6px 16px 4px rgba(var(--sui-color-shadow-rgb), 0.10), 0 2px 6px rgba(var(--sui-color-shadow-rgb), 0.08)",
  4: "0 10px 24px 6px rgba(var(--sui-color-shadow-rgb), 0.12), 0 4px 8px rgba(var(--sui-color-shadow-rgb), 0.08)",
  5: "0 16px 36px 8px rgba(var(--sui-color-shadow-rgb), 0.14), 0 6px 12px rgba(var(--sui-color-shadow-rgb), 0.10)",
} as const;

export type Elevation = keyof typeof elevation;

/** Семейство шрифта для варианта шкалы: display — serif, UI — sans. */
export type TypeFamily = "display" | "sans" | "mono";

/** Типографическая шкала: fluid через `clamp`, но с верхней границей на 4K. */
export interface TypeStyle {
  readonly family: TypeFamily;
  readonly size: string;
  readonly lineHeight: string;
  readonly weight: string;
  readonly tracking: string;
}

export const typeScale = {
  "display-large": { family: "display", size: "clamp(2.75rem, 2.1rem + 1.9vw, 4rem)", lineHeight: "1.06", weight: "600", tracking: "-0.02em" },
  "display-medium": { family: "display", size: "clamp(2.25rem, 1.8rem + 1.4vw, 3.25rem)", lineHeight: "1.1", weight: "600", tracking: "-0.015em" },
  "display-small": { family: "display", size: "clamp(1.875rem, 1.55rem + 1.1vw, 2.5rem)", lineHeight: "1.16", weight: "600", tracking: "-0.01em" },
  "headline-large": { family: "display", size: "clamp(1.625rem, 1.45rem + 0.7vw, 2.125rem)", lineHeight: "1.2", weight: "600", tracking: "-0.005em" },
  "headline-medium": { family: "display", size: "clamp(1.375rem, 1.27rem + 0.5vw, 1.75rem)", lineHeight: "1.25", weight: "600", tracking: "0" },
  "headline-small": { family: "display", size: "clamp(1.25rem, 1.18rem + 0.3vw, 1.5rem)", lineHeight: "1.3", weight: "600", tracking: "0" },
  "title-large": { family: "sans", size: "clamp(1.25rem, 1.2rem + 0.2vw, 1.375rem)", lineHeight: "1.35", weight: "600", tracking: "0" },
  "title-medium": { family: "sans", size: "1.125rem", lineHeight: "1.4", weight: "600", tracking: "0.002em" },
  "title-small": { family: "sans", size: "1rem", lineHeight: "1.45", weight: "600", tracking: "0.005em" },
  "body-large": { family: "sans", size: "clamp(1.125rem, 1.08rem + 0.2vw, 1.25rem)", lineHeight: "1.6", weight: "400", tracking: "0" },
  "body-medium": { family: "sans", size: "1.0625rem", lineHeight: "1.6", weight: "400", tracking: "0.002em" },
  "body-small": { family: "sans", size: "1rem", lineHeight: "1.55", weight: "400", tracking: "0.005em" },
  "label-large": { family: "sans", size: "0.9375rem", lineHeight: "1.4", weight: "600", tracking: "0.01em" },
  "label-medium": { family: "sans", size: "0.875rem", lineHeight: "1.4", weight: "600", tracking: "0.015em" },
  "label-small": { family: "sans", size: "0.75rem", lineHeight: "1.35", weight: "600", tracking: "0.04em" },
} as const satisfies Readonly<Record<string, TypeStyle>>;

export type TypeVariant = keyof typeof typeScale;

/** Motion: сдержанные 120/180/240ms плюс прежняя M3-шкала для совместимости. */
export const motion = {
  duration: {
    fast: "120ms",
    base: "180ms",
    slow: "240ms",
    short1: "50ms",
    short2: "100ms",
    short3: "150ms",
    short4: "200ms",
    medium1: "250ms",
    medium2: "300ms",
    long1: "400ms",
    long2: "500ms",
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    standardAccelerate: "cubic-bezier(0.3, 0, 1, 1)",
    standardDecelerate: "cubic-bezier(0, 0, 0, 1)",
    emphasized: "cubic-bezier(0.05, 0.7, 0.1, 1)",
    editorial: "cubic-bezier(0.22, 1, 0.36, 1)",
    linear: "linear",
  },
} as const;

/** Плотность: множитель вертикальных отступов контролов. */
export const density = {
  compact: 0.875,
  default: 1,
  comfortable: 1.125,
} as const;

export type Density = keyof typeof density;

/** Размеры контролов по умолчанию: md уже touch-target 44px. */
export const controlHeight = {
  sm: "2.25rem",
  md: "2.75rem",
  lg: "3rem",
} as const;

export type ControlSize = keyof typeof controlHeight;

/** Радиус из формы (`shape`). */
export function cssVar(name: string): string {
  return `--sui-${name}`;
}
