import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent({ view: false })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
