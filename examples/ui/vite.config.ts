import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Тяжёлые контролы не должны попадать в начальный чанк: они живут в отдельных
 * vendor-чанках и грузятся только на своём маршруте. Плагин проверяет это на
 * этапе сборки, а не после деплоя.
 */
const HEAVY_MODULE_PATTERNS: readonly RegExp[] = [
  /\/packages\/ui\/(?:src|dist)\/components\/data-table\//u,
  /\/packages\/ui\/(?:src|dist)\/components\/date-picker\//u,
  /\/packages\/ui\/(?:src|dist)\/components\/date-range-picker\//u,
  /\/packages\/ui\/(?:src|dist)\/components\/color-picker\//u,
  /\/packages\/ui\/(?:src|dist)\/components\/file-upload\//u,
  /\/packages\/ui\/(?:src|dist)\/components\/rich-text-editor\//u,
  /\/packages\/ui\/(?:src|dist)\/form\/tree-select\//u,
  /\/packages\/virtual\//u,
  /\/packages\/dnd\//u,
];

function bundleGuard(): Plugin {
  return {
    name: "silent-example-bundle-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      const initial = new Set<string>();
      const queue = Object.values(bundle)
        .filter((item) => item.type === "chunk" && item.isEntry)
        .map((item) => item.fileName);
      while (queue.length > 0) {
        const fileName = queue.pop();
        if (fileName === undefined || initial.has(fileName)) continue;
        initial.add(fileName);
        const chunk = bundle[fileName];
        if (chunk === undefined || chunk.type !== "chunk") continue;
        for (const imported of chunk.imports) queue.push(imported);
      }
      const violations: string[] = [];
      for (const fileName of initial) {
        const chunk = bundle[fileName];
        if (chunk === undefined || chunk.type !== "chunk") continue;
        for (const moduleId of Object.keys(chunk.modules)) {
          if (HEAVY_MODULE_PATTERNS.some((pattern) => pattern.test(moduleId))) {
            violations.push(`${moduleId} → ${fileName}`);
          }
        }
      }
      if (violations.length > 0) {
        this.warn(`Тяжёлые модули попали в начальный бандл:\n${violations.join("\n")}`);
      }
    },
  };
}

const UI_BASE = new Set([
  "alert",
  "avatar",
  "button",
  "card",
  "heading",
  "icon",
  "icon-button",
  "inline",
  "navigation-bar",
  "navigation-rail",
  "skeleton",
  "snackbar",
  "stack",
  "text",
  "top-app-bar",
]);

const UI_DATA_TABLE = new Set([
  "alert-dialog",
  "data-table",
  "dialog",
  "pagination",
  "sheet",
]);

const UI_TABLE = new Set(["empty-state", "progress", "table"]);

function manualChunks(id: string): string | undefined {
  const path = id.replaceAll("\\", "/");
  if (path.includes("/packages/protocol/")) return "vendor-protocol";
  if (path.includes("/packages/router/")) return "vendor-router";
  if (path.includes("/packages/form/")) return "vendor-form";
  if (
    path.includes("/packages/reactivity/") ||
    path.includes("/packages/core/") ||
    path.includes("/packages/di/")
  ) {
    return "vendor-core";
  }
  const match = /\/packages\/ui\/(?:src|dist)\/components\/([^/]+)\//u.exec(path);
  const component = match?.[1];
  if (component !== undefined && UI_BASE.has(component)) return "vendor-ui";
  if (component !== undefined && UI_DATA_TABLE.has(component)) {
    return "vendor-ui-data-table";
  }
  if (component !== undefined && UI_TABLE.has(component)) {
    return "vendor-ui-table";
  }
  if (path.includes("/packages/virtual/") || path.includes("/packages/dnd/")) {
    return "vendor-virtual";
  }
  if (
    path.includes("/packages/ui/src/icons/") ||
    path.includes("/packages/ui/dist/icons/")
  ) {
    return "vendor-ui-icons";
  }
  return undefined;
}

export default defineConfig({
  plugins: [silent({ view: false, hydrate: false }), bundleGuard()],
  build: {
    target: "es2022",
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 120,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@ivlev-dev\/silent-protocol$/u,
        replacement: resolve(repoRoot, "packages/protocol/src/index.ts"),
      },
    ],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": "http://127.0.0.1:6108",
    },
  },
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:6108",
    },
  },
});
