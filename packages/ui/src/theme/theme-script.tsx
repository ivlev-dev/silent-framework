import type { ClassNameValue } from "@ivlev-dev/silent-core";
import type { Attrs } from "../internal/props.js";
import { THEME_STORAGE_KEY, type ThemeMode } from "./apply-theme.js";

export interface ThemeScriptProps {
  /** Nonce для CSP: `<script nonce>`. */
  readonly nonce?: string | undefined;
  readonly defaultTheme?: ThemeMode | undefined;
  readonly storageKey?: string | undefined;
  readonly class?: ClassNameValue;
  readonly attrs?: Attrs;
}

/**
 * Инлайн-скрипт темы: ставит `data-theme` до первой отрисовки, чтобы не было
 * вспышки светлой темы. Вставляйте в `<head>` SSR-документа.
 */
export function themeScriptSource(
  defaultTheme: ThemeMode = "auto",
  storageKey: string = THEME_STORAGE_KEY,
): string {
  const fallback = JSON.stringify(defaultTheme);
  const key = JSON.stringify(storageKey);
  return (
    "(function(){try{"
    + `var k=${key};var s=null;try{s=localStorage.getItem(k)}catch(e){}`
    + `var t=(s==="light"||s==="dark"||s==="auto")?s:${fallback};`
    + "document.documentElement.setAttribute(\"data-theme\",t);"
    + "}catch(e){}})();"
  );
}

/** `<script>` с кодом темы. Единственный компонент, который пишет в DOM скрипт. */
export function ThemeScript(props: ThemeScriptProps): Node {
  return (
    <script
      {...props.attrs}
      class={props.class}
      nonce={props.nonce}
      data-sui-theme-script=""
    >{themeScriptSource(props.defaultTheme ?? "auto", props.storageKey ?? THEME_STORAGE_KEY)}</script>
  );
}
