import type { SemanticColors } from "../tokens/tokens.js";

export type ThemeMode = "light" | "dark" | "auto";

/** Ключ localStorage, который читает `ThemeScript`. */
export const THEME_STORAGE_KEY = "sui-theme";

/** Частичная палитра: переопределяет только переданные роли. */
export type ThemePalette = Partial<SemanticColors>;

export interface ApplyThemeOptions {
  readonly theme: ThemeMode;
  /** Переопределение цветовых ролей: `{ primary: "#…" }`. */
  readonly palette?: ThemePalette | undefined;
  /** Корень, на который ставится `data-theme`. По умолчанию `<html>`. */
  readonly root?: HTMLElement | null | undefined;
  /** Сохранить выбор в localStorage (только явные `light`/`dark`/`auto`). */
  readonly persist?: boolean | undefined;
  readonly storageKey?: string | undefined;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "auto";
}

/** Прочитанное сохранённое значение темы или `null`. SSR-safe. */
export function readStoredTheme(storageKey: string = THEME_STORAGE_KEY): ThemeMode | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(storageKey);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Ставит `data-theme` на документ и, если передан `palette`, — inline
 * CSS-переменные ролей. Ничего не делает без DOM, поэтому безопасен в SSR.
 */
export function applyTheme(options: ApplyThemeOptions): void {
  if (typeof document === "undefined") return;
  const root = options.root ?? document.documentElement;
  if (root === null) return;

  root.setAttribute("data-theme", options.theme);

  const palette = options.palette;
  if (palette !== undefined) {
    for (const [role, value] of Object.entries(palette)) {
      if (typeof value !== "string" || value.trim() === "") continue;
      root.style.setProperty(`--sui-color-${role}`, value);
    }
  }

  if (options.persist === true && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(options.storageKey ?? THEME_STORAGE_KEY, options.theme);
    } catch {
      // Приватный режим/запрет storage: тема всё равно применена.
    }
  }
}

/** Снимает inline-переопределения палитры. */
export function resetThemePalette(root?: HTMLElement | null): void {
  if (typeof document === "undefined") return;
  const target = root ?? document.documentElement;
  if (target === null) return;
  const style = target.style;
  const properties: string[] = [];
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    if (name.startsWith("--sui-color-")) properties.push(name);
  }
  for (const name of properties) {
    style.removeProperty(name);
  }
}
