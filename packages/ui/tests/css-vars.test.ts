import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, "..", "src");

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...walk(absolute));
    else files.push(absolute);
  }
  return files;
}

const cssFiles = walk(sourceRoot).filter((file) => file.endsWith(".css"));
const sources = new Map<string, string>(
  cssFiles.map((file) => [relative(sourceRoot, file).split("\\").join("/"), readFileSync(file, "utf8")]),
);

/** Все `--sui-*`, которые где-либо объявлены. */
function defined(): Set<string> {
  const names = new Set<string>();
  for (const css of sources.values()) {
    for (const match of css.matchAll(/(--sui-[a-z0-9-]+)\s*:/gu)) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }
  return names;
}

/** Все `var(--sui-*)`, на которые ссылаются стили. */
function referenced(): Map<string, string> {
  const used = new Map<string, string>();
  for (const [file, css] of sources) {
    for (const match of css.matchAll(/var\(\s*(--sui-[a-z0-9-]+)/gu)) {
      const name = match[1];
      if (name !== undefined && !used.has(name)) used.set(name, file);
    }
  }
  return used;
}

describe("CSS-переменные", () => {
  it("каждая var(--sui-*) объявлена", () => {
    const known = defined();
    const missing: string[] = [];
    for (const [name, file] of referenced()) {
      if (!known.has(name)) missing.push(`${file}: ${name}`);
    }
    expect(missing).toEqual([]);
  });

  it("компоненты не объявляют цвета напрямую — только через токены", () => {
    const offenders: string[] = [];
    for (const [file, css] of sources) {
      if (!file.startsWith("components/")) continue;
      const stripped = css
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/--sui-[a-z0-9-]+\s*:[^;]+;/gu, "");
      if (/#[0-9a-fA-F]{3,8}\b/u.test(stripped) || /\brgba?\(/u.test(stripped)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("state layers объявлены и используются компонентами", () => {
    const tokens = sources.get("tokens/tokens.css") ?? "";
    for (const name of ["--sui-state-hover", "--sui-state-pressed", "--sui-state-disabled"]) {
      expect(tokens).toContain(`${name}:`);
    }
    const button = sources.get("components/button/button.css") ?? "";
    expect(button).toContain("var(--sui-state-hover)");
    expect(button).toContain("var(--sui-state-disabled)");
    // Reduced motion централизован в base.css (transition-duration → 0.01ms).
    expect(sources.get("styles/base.css") ?? "").toContain("prefers-reduced-motion");
    const spinner = sources.get("components/spinner/spinner.css") ?? "";
    expect(spinner).toContain("prefers-reduced-motion");
  });
});
