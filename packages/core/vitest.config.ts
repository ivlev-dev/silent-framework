import { defineConfig } from "vitest/config";
import { silent } from "@ivlev98/silent-vite";

export default defineConfig({
  plugins: [silent({ hmr: false })],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
