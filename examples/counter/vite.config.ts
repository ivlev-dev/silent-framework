import { defineConfig } from "vite";
import { silent } from "@ivlev98/silent-vite";

export default defineConfig({
  plugins: [silent()],
  ssr: {
    external: ["@ivlev98/silent-core", "@ivlev98/silent-di", "@ivlev98/silent-reactivity", "@ivlev98/silent-server"],
  },
});
