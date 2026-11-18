import { defineConfig } from "vitest/config";
import { silent } from "@ivlev-dev/silent-vite";
import { validation } from "./src/vite.js";

export default defineConfig({
  plugins: [
    validation(),
    silent({ hmr: false, include: /tests-typed[\\/].*\.ts$/ }),
  ],
  test: {
    environment: "node",
    include: ["tests-typed/**/*.test.ts"],
  },
});
