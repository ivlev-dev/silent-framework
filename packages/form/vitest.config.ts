import { defineConfig } from "vitest/config";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  // Тесты используют stage-3 декораторы; Oxc их не опускает, поэтому
  // файлы тестов компилируются тем же SWC-плагином, что и в остальных пакетах.
  plugins: [silent({ hmr: false, include: /tests[\\/].*\.test\.ts$/ })],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
