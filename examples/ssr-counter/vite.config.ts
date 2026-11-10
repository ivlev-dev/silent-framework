import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
  build: {
    outDir: "dist/client",
  },
  ssr: {
    external: [
      "@ivlev-dev/silent-core",
      "@ivlev-dev/silent-di",
      "@ivlev-dev/silent-reactivity",
      "@ivlev-dev/silent-server",
    ],
  },
});
