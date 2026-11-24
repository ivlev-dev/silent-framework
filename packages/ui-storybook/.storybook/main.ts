import type { StorybookConfig } from "@storybook/html-vite";
import { silent } from "@ivlev-dev/silent-vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const uiSource = join(repoRoot, "packages", "ui", "src");

/**
 * Storybook компилирует `.tsx` stories плагином `silent()` (enforce: pre),
 * а не Oxc. `@ivlev-dev/silent-ui` алиасится на `src`, чтобы stories и
 * CSS-манифест работали без предварительной сборки пакета.
 */
const config: StorybookConfig = {
  // `.mdx` — standalone-страницы (Introduction) и ручные docs-шаблоны.
  stories: ["../src/**/*.stories.tsx", "../src/**/*.mdx"],
  addons: [
    "@storybook/addon-a11y",
    // Autodocs/args table для HTML-renderer'а: Storybook не выводит props из
    // JSDoc для HTML, поэтому таблица строится из явных `argTypes` в meta.
    "@storybook/addon-docs",
  ],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  docs: {
    // Docs-страница по умолчанию называется Docs и показывает autodocs.
    defaultName: "Docs",
  },
  core: {
    disableTelemetry: true,
  },
  async viteFinal(viteConfig) {
    viteConfig.plugins = [
      silent({ root: repoRoot, hmr: false }),
      ...(viteConfig.plugins ?? []),
    ];
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: [
        // CSS-манифест должен резолвиться раньше базового алиаса.
        { find: "@ivlev-dev/silent-ui/styles.css", replacement: join(uiSource, "styles.css") },
        // Глубокие входы (`…/text-field`, `…/form/text-field`) резолвятся до
        // общего префиксного алиаса; иначе Vite склеит `index.ts/<subpath>`.
        { find: /^@ivlev-dev\/silent-ui\/form$/, replacement: join(uiSource, "form", "index.ts") },
        {
          find: /^@ivlev-dev\/silent-ui\/form\/([^/]+)$/,
          replacement: join(uiSource, "form", "$1", "index.ts"),
        },
        { find: /^@ivlev-dev\/silent-ui\/(layout|theme|tokens)$/, replacement: join(uiSource, "$1", "index.ts") },
        {
          find: /^@ivlev-dev\/silent-ui\/([a-z0-9-]+)$/,
          replacement: join(uiSource, "components", "$1", "index.ts"),
        },
        { find: "@ivlev-dev/silent-ui", replacement: join(uiSource, "index.ts") },
        ...(Array.isArray(viteConfig.resolve?.alias) ? viteConfig.resolve.alias : []),
      ],
    };
    viteConfig.server = {
      ...viteConfig.server,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        ...viteConfig.server?.fs,
        allow: [...(viteConfig.server?.fs?.allow ?? []), repoRoot],
      },
    };
    return viteConfig;
  },
};

export default config;
