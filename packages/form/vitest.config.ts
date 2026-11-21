import { defineConfig } from "vitest/config";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  // Тесты используют stage-3 декораторы; Oxc их не опускает, поэтому
  // файлы тестов компилируются тем же SWC-плагином, что и в остальных пакетах.
  plugins: [silent({ hmr: false, include: /tests[\\/].*\.test\.ts$/ })],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "html"],
      // Пороги на 1–2% ниже фактического покрытия: ловят падение, но не
      // ломают CI из-за незначительных правок. Пересматривать при росте.
      thresholds: {
        lines: 78,
        statements: 77,
        branches: 71,
        functions: 68,
      },
    },
  },
});
