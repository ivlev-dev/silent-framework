import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Тесты генератора создают TypeScript Program и под параллельной нагрузкой
    // выходят за дефолтные 5 с (наблюдались ложные падения в полном прогоне).
    testTimeout: 30_000,
  },
});
