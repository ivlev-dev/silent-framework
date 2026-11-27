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
 * Палитра бренда: холодный ink, глубокий teal, туманный mist и ivory-бумага.
 * Основа светлой темы и брендовых акцентов; тёмная тема — отдельный soft black.
 * Старые ключи сохранены как алиасы.
 */
export const palette = {
  "ink-900": "#081A2E",
  "ink-800": "#0E2A47",
  "teal-700": "#1F4E6B",
  "mist-300": "#9FB8C9",
  "ivory-50": "#F2F5F7",

  /* Публичные алиасы: не ломают код, который читает `palette.ivory`/`palette.navy`. */
  ivory: "#F2F5F7",
  almond: "#E6EDF2",
  mist: "#9FB8C9",
  navy: "#0E2A47",
  noir: "#081A2E",
  gold: "#1F4E6B",
  "navy-deep": "#081A2E",
  "navy-mid": "#0E2A47",
  "navy-dark": "#061424",
  white: "#FFFFFF",

  /* Алиасы прежней палитры ролей. */
  primary: "#0E2A47",
  secondary: "#9FB8C9",
  tertiary: "#1F4E6B",
  neutralDarkest: "#061424",
  neutralDark: "#0E2A47",
  neutralLightest: "#F2F5F7",
} as const;

export type PaletteColor = keyof typeof palette;

/** Семантические роли Material 3 + акцентная пара для mist-CTA/хайлайтов. */
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

  /** Акцент (mist-300) — для CTA, хайлайтов и декоративных акцентов. */
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
 * Светлая тема: ivory-поверхности, ink-текст, teal-основа и mist-акцент.
 * `tertiary`/`accent` — mist-заливка (не текст); текст на mist — ink-900.
 */
export const lightColors: SemanticColors = {
  primary: "#0E2A47",
  "on-primary": "#F2F5F7",
  "primary-container": "#D9E4EC",
  "on-primary-container": "#081A2E",
  "primary-fixed": "#9FB8C9",
  "primary-fixed-dim": "#7E99AC",
  "on-primary-fixed": "#081A2E",
  "on-primary-fixed-variant": "#1F4E6B",

  secondary: "#1F4E6B",
  "on-secondary": "#F2F5F7",
  "secondary-container": "#D9E4EC",
  "on-secondary-container": "#081A2E",

  tertiary: "#9FB8C9",
  "on-tertiary": "#081A2E",
  "tertiary-container": "#D9E4EC",
  "on-tertiary-container": "#081A2E",

  accent: "#9FB8C9",
  "on-accent": "#081A2E",

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

  surface: "#F2F5F7",
  "surface-dim": "#E3EBF1",
  "surface-bright": "#FFFFFF",
  "surface-container-lowest": "#FFFFFF",
  "surface-container-low": "#F7F9FA",
  "surface-container": "#EDF2F5",
  "surface-container-high": "#E6EDF2",
  "surface-container-highest": "#D2DFE8",

  "on-surface": "#081A2E",
  "on-surface-variant": "#3A566B",
  // AA-правка: #4C6477 вместо #5A7285 — 4.5:1 на elevated surface.
  "on-surface-muted": "#4C6477",

  // AA-правка: #638198 вместо #6E8CA3 — 3:1 на surface-container-highest.
  outline: "#638198",
  "outline-variant": "#C9D8E2",

  scrim: "#081A2E",
  shadow: "#0E2A47",

  "inverse-surface": "#0E2A47",
  "inverse-on-surface": "#F2F5F7",
  "inverse-primary": "#9FB8C9",
};

/**
 * Тёмная тема: soft black/charcoal surface (`#17181B` → elevated `#333439`),
 * neutral-текст и тёплый neutral primary/accent с тёмным текстом на заливке.
 */
export const darkColors: SemanticColors = {
  primary: "#D9D5CB",
  "on-primary": "#141416",
  "primary-container": "#34343A",
  "on-primary-container": "#EDEAE2",
  "primary-fixed": "#D9D5CB",
  "primary-fixed-dim": "#B9B5AB",
  "on-primary-fixed": "#141416",
  "on-primary-fixed-variant": "#C9C5BB",

  secondary: "#C4C1B9",
  "on-secondary": "#141416",
  "secondary-container": "#2C2D32",
  "on-secondary-container": "#E7E4DC",

  tertiary: "#A9B3AC",
  "on-tertiary": "#141416",
  "tertiary-container": "#2C342F",
  "on-tertiary-container": "#DCE5DC",

  accent: "#C9C5BB",
  "on-accent": "#141416",

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

  surface: "#17181B",
  "surface-dim": "#101114",
  "surface-bright": "#3A3B41",
  "surface-container-lowest": "#131417",
  "surface-container-low": "#1D1E22",
  "surface-container": "#232428",
  "surface-container-high": "#2A2B30",
  "surface-container-highest": "#333439",

  "on-surface": "#ECECEF",
  "on-surface-variant": "#C9C9D0",
  "on-surface-muted": "#A5A5AE",

  outline: "#85858F",
  "outline-variant": "#3C3D44",

  scrim: "#000000",
  shadow: "#000000",

  "inverse-surface": "#ECECEF",
  "inverse-on-surface": "#1D1E22",
  "inverse-primary": "#3A3B41",
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

/** Радиусы: сдержанные 4/6/10/14/20, `full` — только для аватаров и чипов. */
export const radii = {
  none: "0",
  xs: "0.25rem",
  sm: "0.375rem",
  md: "0.625rem",
  lg: "0.875rem",
  xl: "1.25rem",
  full: "999px",
  card: "0.875rem",
  dialog: "1.25rem",
  sheet: "1.25rem",
} as const;

export type Radius = keyof typeof radii;

/**
 * Elevation: мягкие ink-tinted тени из `--sui-color-shadow-rgb` — без
 * обязательного `color-mix`; работают в старых WebView (TV).
 */
export const elevation = {
  0: "none",
  1: "0 1px 2px rgba(var(--sui-color-shadow-rgb), 0.06), 0 1px 2px rgba(var(--sui-color-shadow-rgb), 0.04)",
  2: "0 2px 8px rgba(var(--sui-color-shadow-rgb), 0.08), 0 1px 3px rgba(var(--sui-color-shadow-rgb), 0.05)",
  3: "0 8px 24px rgba(var(--sui-color-shadow-rgb), 0.10), 0 2px 6px rgba(var(--sui-color-shadow-rgb), 0.06)",
  4: "0 12px 32px rgba(var(--sui-color-shadow-rgb), 0.12), 0 4px 10px rgba(var(--sui-color-shadow-rgb), 0.06)",
  5: "0 20px 48px rgba(var(--sui-color-shadow-rgb), 0.14), 0 8px 16px rgba(var(--sui-color-shadow-rgb), 0.08)",
} as const;

export type Elevation = keyof typeof elevation;

/** Семейство шрифта для варианта шкалы: display и UI — один sans, mono — код. */
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
  "display-large": { family: "display", size: "clamp(2.125rem, 1.8rem + 1.1vw, 2.75rem)", lineHeight: "1.2", weight: "600", tracking: "-0.015em" },
  "display-medium": { family: "display", size: "clamp(1.875rem, 1.62rem + 0.85vw, 2.375rem)", lineHeight: "1.2", weight: "600", tracking: "-0.012em" },
  "display-small": { family: "display", size: "clamp(1.6875rem, 1.5rem + 0.6vw, 2.125rem)", lineHeight: "1.2", weight: "600", tracking: "-0.01em" },
  "headline-large": { family: "display", size: "clamp(1.5rem, 1.38rem + 0.45vw, 2rem)", lineHeight: "1.25", weight: "600", tracking: "-0.008em" },
  "headline-medium": { family: "display", size: "clamp(1.375rem, 1.28rem + 0.35vw, 1.75rem)", lineHeight: "1.3", weight: "600", tracking: "-0.005em" },
  "headline-small": { family: "display", size: "clamp(1.25rem, 1.18rem + 0.25vw, 1.5rem)", lineHeight: "1.3", weight: "600", tracking: "0" },
  "title-large": { family: "sans", size: "clamp(1.125rem, 1.09rem + 0.15vw, 1.25rem)", lineHeight: "1.35", weight: "600", tracking: "0" },
  "title-medium": { family: "sans", size: "1.125rem", lineHeight: "1.4", weight: "600", tracking: "0" },
  "title-small": { family: "sans", size: "1rem", lineHeight: "1.45", weight: "600", tracking: "0" },
  "body-large": { family: "sans", size: "1.0625rem", lineHeight: "1.55", weight: "400", tracking: "0" },
  "body-medium": { family: "sans", size: "1rem", lineHeight: "1.55", weight: "400", tracking: "0" },
  "body-small": { family: "sans", size: "0.875rem", lineHeight: "1.5", weight: "400", tracking: "0" },
  "label-large": { family: "sans", size: "0.8125rem", lineHeight: "1.35", weight: "600", tracking: "0.005em" },
  "label-medium": { family: "sans", size: "0.75rem", lineHeight: "1.35", weight: "600", tracking: "0.01em" },
  "label-small": { family: "sans", size: "0.75rem", lineHeight: "1.3", weight: "600", tracking: "0.04em" },
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

/** Размеры контролов: компактная шкала, на coarse-pointer минимум 44px. */
export const controlHeight = {
  sm: "2rem",
  md: "2.5rem",
  lg: "3rem",
} as const;

export type ControlSize = keyof typeof controlHeight;

/** Радиус из формы (`shape`). */
export function cssVar(name: string): string {
  return `--sui-${name}`;
}
