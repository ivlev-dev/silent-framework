import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text"],
      // Пороги на 2–3% ниже фактического покрытия на момент введения
      // (lines/statements −2, branches/functions −3): фиксируют текущий
      // уровень и ловят регрессии, не падая от небольших правок.
      thresholds: {
        lines: 92,
        statements: 92,
        branches: 85,
        functions: 92,
      },
    },
  },
});
