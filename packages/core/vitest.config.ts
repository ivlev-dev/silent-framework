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
  },
});
