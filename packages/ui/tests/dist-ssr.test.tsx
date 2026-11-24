// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  Button,
  CloseIcon,
  Heading,
  IconButton,
  Stack,
  Text,
  ThemeScript,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = join(here, "..", "dist");

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...walk(absolute));
    } else {
      files.push(absolute);
    }
  }
  return files;
}

const distFiles = walk(distRoot).map((file) => relative(distRoot, file).split("\\").join("/"));

/** Пакет поставляется precompiled: в JS нет JSX-вызовов и CSS-импортов. */
describe("precompiled dist", () => {
  it("содержит barrel, CSS-агрегаты и декларации", () => {
    for (const expected of [
      "index.js",
      "index.d.ts",
      "layout/index.js",
      "theme/index.js",
      "tokens/index.js",
      "icons/close.js",
      "components/button/index.js",
      "styles.css",
      "base.css",
      "tokens.css",
      "themes.css",
      "layout.css",
      "reset.css",
    ]) {
      expect(distFiles, expected).toContain(expected);
    }
  });

  it("не содержит jsx()/jsxs() и React.createElement()", () => {
    const offenders: string[] = [];
    for (const file of distFiles) {
      if (!file.endsWith(".js")) continue;
      const code = readFileSync(join(distRoot, file), "utf8");
      if (/\b(?:jsxs?|jsxDEV)\s*\(/u.test(code) || /\bcreateElement\s*\(/u.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("компоненты скомпилированы в шаблонный runtime", () => {
    const button = readFileSync(join(distRoot, "components", "button", "button.js"), "utf8");
    expect(button).toContain("templateHoles(");
    expect(button).toContain("component(");
    const box = readFileSync(join(distRoot, "layout", "box.js"), "utf8");
    expect(box).toContain("templateHoles(");
  });

  it("JS не импортирует CSS и использует явные .js-спецификаторы", () => {
    const problems: string[] = [];
    for (const file of distFiles) {
      if (!file.endsWith(".js")) continue;
      const code = readFileSync(join(distRoot, file), "utf8");
      if (/\.css["']/u.test(code)) problems.push(`${file}: импорт CSS из JS`);
      const specifiers = code.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/gu);
      for (const match of specifiers) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        if (!specifier.endsWith(".js") && !specifier.endsWith(".json")) {
          problems.push(`${file}: спецификатор без расширения: ${specifier}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("агрегат styles.css объявляет порядок слоёв и не содержит @import", () => {
    const css = readFileSync(join(distRoot, "styles.css"), "utf8");
    expect(css.startsWith("@layer sui.reset, sui.tokens, sui.base, sui.layout, sui.components, sui.overrides;")).toBe(true);
    expect(css).not.toContain("@import");
    const order = [
      "/* styles/reset.css */",
      "/* tokens/tokens.css */",
      "/* styles/themes.css */",
      "/* styles/base.css */",
      "/* layout/layout.css */",
      "/* components/button/button.css */",
      "/* components/text/text.css */",
    ];
    let previous = -1;
    for (const marker of order) {
      const index = css.indexOf(marker);
      expect(index, marker).toBeGreaterThan(previous);
      previous = index;
    }
  });
});

describe("SSR из dist", () => {
  function Page() {
    return (
      <Stack gap={3} attrs={{ "data-testid": "page" }}>
        <Heading level={1}>Заголовок</Heading>
        <Text tone="muted">Описание</Text>
        <Button variant="filled" leading={<CloseIcon />} attrs={{ "data-testid": "cta" }}>
          Отправить
        </Button>
        <IconButton label="Закрыть">
          <CloseIcon />
        </IconButton>
        <ThemeScript nonce="nonce-value" defaultTheme="dark" />
      </Stack>
    );
  }

  it("рендерит разметку без document на входе", async () => {
    expect(typeof document).toBe("undefined");
    const { html } = await renderToString(Page);
    expect(html).toContain('data-testid="page"');
    expect(html).toContain("<h1");
    expect(html).toContain('class="sui-button"');
    expect(html).toContain('data-variant="filled"');
    expect(html).toContain('aria-label="Закрыть"');
    expect(html).toContain("Отправить");
    expect(html).toContain("<script");
    expect(html).toContain('nonce="nonce-value"');
    expect(html).toContain("data-theme");
    expect(html).not.toContain("undefined");
  });
});
