import { defineConfig } from "vitest/config";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent({ hmr: false, include: /tests[\\/].*\.test\.ts$/ })],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "html"],
      // Пороги на 1–2% ниже фактического покрытия: ловят падение, но не
      // ломают CI из-за незначительных правок. Пересматривать при росте.
      thresholds: {
        lines: 89,
        statements: 89,
        branches: 84,
        functions: 92,
      },
    },
  },
});
