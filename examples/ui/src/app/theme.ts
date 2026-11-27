import { createSignal } from "@ivlev-dev/silent-core";
import { readStoredTheme } from "@ivlev-dev/silent-ui";
import type { ThemeMode } from "@ivlev-dev/silent-ui";

export type AppDensity = "standard" | "compact";

const DENSITY_STORAGE_KEY = "silent-ui-density";

function readDensity(): AppDensity {
  if (typeof localStorage === "undefined") return "standard";
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === "compact"
      ? "compact"
      : "standard";
  } catch {
    return "standard";
  }
}

const [themeValue, themeSetter] = createSignal<ThemeMode>(
  readStoredTheme() ?? "auto",
);
const [densityValue, densitySetter] = createSignal<AppDensity>(readDensity());

export const theme = themeValue;
export const setTheme = themeSetter;
export const density = densityValue;
export const setDensity = densitySetter;

export function persistDensity(value: AppDensity): void {
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, value);
  } catch {
    return;
  }
}
