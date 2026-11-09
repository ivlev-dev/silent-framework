import { defineConfig } from "vite";
import { silent } from "@silent/vite";

export default defineConfig({
  plugins: [silent()],
  ssr: {
    external: ["@silent/core", "@silent/di", "@silent/reactivity", "@silent/server"],
  },
});
