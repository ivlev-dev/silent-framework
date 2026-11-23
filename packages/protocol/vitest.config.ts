import { defineConfig } from "vitest/config";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent({ hmr: false, include: /tests[\\/].*\.test\.ts$/ })],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
