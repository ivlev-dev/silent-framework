import { defineConfig } from "vitest/config";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent({ hmr: false })],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Фаззинг гидратации списков при параллельном прогоне не укладывается
    // в дефолтные 5 с (наблюдались ложные падения по таймауту).
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text"],
      // Пороги на 2–3% ниже фактического покрытия на момент введения
      // (lines/statements −2, branches/functions −3): фиксируют текущий
      // уровень и ловят регрессии, не падая от небольших правок.
      thresholds: {
        lines: 83,
        statements: 83,
        branches: 74,
        functions: 85,
      },
    },
  },
});
