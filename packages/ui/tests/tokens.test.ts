import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  baseFontSize,
  breakpointEm,
  breakpointOrder,
  breakpoints,
  mediaDown,
  mediaUp,
} from "../src/tokens/index.js";
import {
  darkColors,
  lightColors,
  palette,
  typeScale,
  semanticRoles,
  type SemanticColors,
  type TypeVariant,
} from "../src/tokens/tokens.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const repoRoot = join(packageRoot, "..", "..");

function readText(...parts: string[]): string {
  return readFileSync(join(packageRoot, ...parts), "utf8");
}

/** Достаёт тело правила `selector { … }`, учитывая вложенные скобки. */
function blockBody(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `селектор ${selector} не найден`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error(`не закрыт блок ${selector}`);
}

function colorVars(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /--sui-color-([a-z0-9-]+):\s*([^;]+);/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    result[name] = value.trim();
  }
  return result;
}

function rgbTriplet(color: string): [number, number, number] {
  const hex = color.trim();
  if (!/^#[0-9a-fA-F]{6}$/u.test(hex)) {
    throw new Error(`${hex} должен быть #RRGGBB`);
  }
  const number = Number.parseInt(hex.slice(1), 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const [r, g, b] = rgbTriplet(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.1 contrast ratio. */
export function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const surfaces = [
  "surface",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
] as const satisfies readonly (keyof SemanticColors)[];

const textOnSurfaces = [
  "on-surface",
  "on-surface-variant",
  "on-surface-muted",
  "primary",
  "secondary",
  "error",
  "success",
  "warning",
] as const satisfies readonly (keyof SemanticColors)[];

const onPairs = [
  ["on-primary", "primary"],
  ["on-primary-container", "primary-container"],
  ["on-primary-fixed", "primary-fixed"],
  ["on-secondary", "secondary"],
  ["on-secondary-container", "secondary-container"],
  ["on-tertiary", "tertiary"],
  ["on-tertiary-container", "tertiary-container"],
  ["on-accent", "accent"],
  ["on-error", "error"],
  ["on-error-container", "error-container"],
  ["on-success", "success"],
  ["on-success-container", "success-container"],
  ["on-warning", "warning"],
  ["on-warning-container", "warning-container"],
  ["inverse-on-surface", "inverse-surface"],
  ["inverse-primary", "inverse-surface"],
] as const satisfies readonly (readonly [keyof SemanticColors, keyof SemanticColors])[];

describe("токены", () => {
  it("использует палитру ink/teal/mist/ivory", () => {
    expect(palette).toMatchObject({
      "ink-900": "#081A2E",
      "ink-800": "#0E2A47",
      "teal-700": "#1F4E6B",
      "mist-300": "#9FB8C9",
      "ivory-50": "#F2F5F7",
    });
    // Старые ключи остаются алиасами — обратная совместимость.
    expect(palette.ivory).toBe("#F2F5F7");
    expect(palette.almond).toBe("#E6EDF2");
    expect(palette.mist).toBe("#9FB8C9");
    expect(palette.navy).toBe("#0E2A47");
    expect(palette.noir).toBe("#081A2E");
    expect(palette.gold).toBe("#1F4E6B");
    expect(palette["navy-deep"]).toBe("#081A2E");
    expect(palette["navy-mid"]).toBe("#0E2A47");
    expect(palette["navy-dark"]).toBe("#061424");
    expect(palette.white).toBe("#FFFFFF");
    expect(palette.primary).toBe("#0E2A47");
    expect(palette.secondary).toBe("#9FB8C9");
    expect(palette.tertiary).toBe("#1F4E6B");
    expect(palette.neutralDarkest).toBe("#061424");
    expect(palette.neutralDark).toBe("#0E2A47");
    expect(palette.neutralLightest).toBe("#F2F5F7");
  });

  it.each([
    ["light", lightColors],
    ["dark", darkColors],
  ] as const)("%s: все роли объявлены", (_theme, colors) => {
    for (const role of semanticRoles) {
      expect(colors[role], role).toMatch(/^#[0-9A-F]{6}$/u);
    }
    expect(semanticRoles).toContain("accent");
    expect(semanticRoles).toContain("on-accent");
  });

  it.each([
    ["light", lightColors],
    ["dark", darkColors],
  ] as const)("%s: текст на фоне проходит WCAG AA (4.5:1)", (theme, colors) => {
    const failures: string[] = [];
    for (const [foreground, background] of onPairs) {
      const ratio = contrast(colors[foreground], colors[background]);
      if (ratio < 4.5) {
        failures.push(`${theme} ${foreground}/${background} = ${ratio.toFixed(2)}`);
      }
    }
    for (const surface of surfaces) {
      for (const foreground of textOnSurfaces) {
        const ratio = contrast(colors[foreground], colors[surface]);
        if (ratio < 4.5) {
          failures.push(`${theme} ${foreground}/${surface} = ${ratio.toFixed(2)}`);
        }
      }
      const outline = contrast(colors.outline, colors[surface]);
      if (outline < 3) {
        failures.push(`${theme} outline/${surface} = ${outline.toFixed(2)} (UI 3:1)`);
      }
    }
    for (const surface of ["surface-dim"] as const) {
      for (const foreground of textOnSurfaces) {
        const ratio = contrast(colors[foreground], colors[surface]);
        if (ratio < 4.5) {
          failures.push(`${theme} ${foreground}/${surface} = ${ratio.toFixed(2)}`);
        }
      }
      const outline = contrast(colors.outline, colors[surface]);
      if (outline < 3) {
        failures.push(`${theme} outline/${surface} = ${outline.toFixed(2)} (UI 3:1)`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("акцент — mist в light, neutral в dark, текст на заливке — ink/тёмный", () => {
    expect(lightColors.accent).toBe("#9FB8C9");
    expect(lightColors["on-accent"]).toBe("#081A2E");
    expect(darkColors.accent).toBe("#C9C5BB");
    expect(darkColors["on-accent"]).toBe("#141416");
  });

  it("focus ring использует primary: ink в light, neutral в dark", () => {
    // Ring — UI-элемент, 3:1 достаточно; проверяем на поверхности и на себе.
    expect(contrast(lightColors.primary, lightColors.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkColors.primary, darkColors.surface)).toBeGreaterThanOrEqual(3);
    expect(lightColors.primary).toBe("#0E2A47");
    expect(darkColors.primary).toBe("#D9D5CB");
  });

  it("themes.css повторяет TS-значения ролей", () => {
    const css = readText("src", "styles", "themes.css");
    const light = colorVars(blockBody(css, ':where([data-theme="light"])'));
    const dark = colorVars(blockBody(css, ':where([data-theme="dark"])'));
    for (const role of semanticRoles) {
      expect(light[role], `light ${role}`).toBe(lightColors[role]);
      expect(dark[role], `dark ${role}`).toBe(darkColors[role]);
    }
    // rgba-подложка тени должна соответствовать цвету shadow.
    expect(light["shadow-rgb"]).toBe("14, 42, 71");
    expect(dark["shadow-rgb"]).toBe("0, 0, 0");
  });

  it("themes.css поддерживает light/dark/auto и системный fallback", () => {
    const css = readText("src", "styles", "themes.css");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain(':where([data-theme="auto"])');
    expect(css).toContain("color-scheme: light");
    expect(css).toContain("color-scheme: dark");
    // Локальная тема несёт и поверхность, и цвет: иначе текст на тёмной
    // обёртке остаётся светлым на светлом фоне родителя.
    const scope = blockBody(css, ":where([data-theme])");
    expect(scope).toContain("color: var(--sui-color-on-surface)");
    expect(scope).toContain("background-color: var(--sui-color-surface)");
    // light-dark() не должен быть обязательным для v1.
    expect(css).not.toContain("light-dark(");
  });

  it("типографика: единый sans, компактная шкала, measure и body 16/14px", () => {
    const tokens = readText("src", "tokens", "tokens.css");
    expect(tokens).toContain("--sui-font-display:");
    expect(tokens).toContain("--sui-font-display: var(--sui-font-sans);");
    expect(tokens).not.toContain("Iowan Old Style");
    expect(tokens).not.toContain("Georgia");
    expect(tokens).toContain("--sui-font-sans:");
    expect(tokens).toContain("--sui-font-mono:");
    expect(tokens).toContain("--sui-measure: 68ch;");
    expect(tokens).toContain("--sui-measure-narrow: 52ch;");
    expect(tokens).toContain("--sui-touch-target: 2.75rem;");
    expect(tokens).toContain("--sui-touch-target-cozy: 3rem;");
    expect(tokens).toContain("--sui-control-height-sm: 2rem;");
    expect(tokens).toContain("--sui-control-height-md: 2.5rem;");
    expect(tokens).toContain("--sui-control-height-lg: 3rem;");

    for (const variant of ["body-large", "body-medium"] as const) {
      const rem = Number.parseFloat(typeScale[variant].size);
      expect(rem, `${variant} ≥ 16px`).toBeGreaterThanOrEqual(1);
      expect(typeScale[variant].family).toBe("sans");
    }
    const smallRem = Number.parseFloat(typeScale["body-small"].size);
    expect(smallRem, "body-small = 14px").toBeGreaterThanOrEqual(0.875);
    for (const variant of ["display-large", "display-medium", "display-small", "headline-large", "headline-medium", "headline-small"] as const) {
      expect(typeScale[variant].family).toBe("display");
      expect(Number.parseFloat(typeScale[variant].lineHeight), variant).toBeGreaterThanOrEqual(1.2);
    }
    // Display не раздувается на 4K: верхняя граница ≤ 3rem.
    expect(typeScale["display-large"].size).toContain("2.75rem)");
    // Fluid-шкала всегда с верхней границей: никакого «бесконечного» роста.
    for (const [name, style] of Object.entries(typeScale)) {
      if (!style.size.startsWith("clamp(")) continue;
      expect(style.size, name).toMatch(/,\s*[\d.]+rem\)$/u);
    }
  });

  it("радиусы и motion: сдержанные значения и семантические алиасы", () => {
    const tokens = readText("src", "tokens", "tokens.css");
    for (const [name, value] of [
      ["xs", "0.25rem"],
      ["sm", "0.375rem"],
      ["md", "0.625rem"],
      ["lg", "0.875rem"],
      ["xl", "1.25rem"],
      ["full", "999px"],
    ] as const) {
      expect(tokens, `radius ${name}`).toContain(`--sui-radius-${name}: ${value};`);
    }
    expect(tokens).toContain("--sui-radius-card: var(--sui-radius-lg);");
    expect(tokens).toContain("--sui-radius-dialog: var(--sui-radius-xl);");
    expect(tokens).toContain("--sui-radius-sheet: var(--sui-radius-xl);");
    expect(tokens).toContain("--sui-radius-control: var(--sui-radius-md);");
    expect(tokens).toContain("--sui-motion-fast: 120ms;");
    expect(tokens).toContain("--sui-motion-base: 180ms;");
    expect(tokens).toContain("--sui-motion-slow: 240ms;");
  });

  it("layout и base: переполнение, safe-area, RTL, утилиты", () => {
    const layout = readText("src", "layout", "layout.css");
    const base = readText("src", "styles", "base.css");
    expect(layout).toContain("min-inline-size: 0");
    expect(layout).toContain("env(safe-area-inset-left");
    expect(layout).toContain("env(safe-area-inset-right");
    expect(layout).toContain(".sui-container:dir(rtl)");
    expect(layout).toContain("inline-size: 100%");

    expect(base).toContain("overflow-wrap: break-word");
    expect(base).toContain("text-wrap: pretty");
    expect(base).toContain("text-wrap: balance");
    expect(base).toContain("var(--sui-color-accent)");
    expect(base).toContain("var(--sui-focus-ring-color)");
    for (const utility of [
      ".sui-truncate",
      ".sui-clamp-2",
      ".sui-clamp-3",
      ".sui-scroll-x",
      ".sui-break-words",
      ".sui-measure",
      ".sui-measure-narrow",
    ]) {
      expect(base, utility).toContain(utility);
    }
  });
});

describe("брейкпоинты", () => {
  it("JSON — источник истины для TS", () => {
    const json = JSON.parse(readText("src", "tokens", "breakpoints.json")) as {
      baseFontSize: number;
      values: Record<string, number>;
    };
    expect(json.baseFontSize).toBe(baseFontSize);
    expect(Object.keys(json.values)).toEqual([...breakpointOrder]);
    for (const name of breakpointOrder) {
      expect(breakpoints[name], name).toBe(json.values[name]);
    }
  });

  it("em считается от baseFontSize", () => {
    for (const name of breakpointOrder) {
      const expected = breakpoints[name] / baseFontSize;
      const actual = Number.parseFloat(breakpointEm[name].replace("em", ""));
      expect(actual, name).toBe(expected);
    }
  });

  it("CSS-переменные и media-литералы совпадают с TS", () => {
    const tokensCss = readText("src", "tokens", "tokens.css");
    const layoutCss = readText("src", "layout", "layout.css");
    for (const name of breakpointOrder) {
      expect(tokensCss, `--sui-breakpoint-${name}`).toContain(
        `--sui-breakpoint-${name}: ${breakpointEm[name]};`,
      );
      if (name === "xs") continue;
      expect(layoutCss, `@media ${breakpointEm[name]}`).toContain(
        `@media (min-width: ${breakpointEm[name]})`,
      );
    }
  });

  it("таблица в docs/guides/ui.md синхронна с JSON", () => {
    const doc = readFileSync(join(repoRoot, "docs", "guides", "ui.md"), "utf8");
    for (const name of breakpointOrder) {
      const row = doc
        .split(/\r?\n/u)
        .find((line) => line.startsWith(`| \`${name}\` |`));
      expect(row, `строка ${name} в docs/guides/ui.md`).toBeDefined();
      expect(row).toContain(`| ${breakpoints[name]} |`);
      expect(row).toContain(`| ${breakpointEm[name]} |`);
    }
  });

  it("mediaUp/mediaDown строят mobile-first условия", () => {
    expect(mediaUp("xs")).toBeNull();
    expect(mediaUp("sm")).toBe("(min-width: 22.5em)");
    expect(mediaUp("6xl")).toBe("(min-width: 240em)");
    expect(mediaDown("xs")).toBeNull();
    expect(mediaDown("sm")).toBe("(max-width: 22.4375em)");
    expect(mediaDown("6xl")).toBe("(max-width: 239.9375em)");
  });
});
