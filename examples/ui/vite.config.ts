import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

export default defineConfig({
  plugins: [silent()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:6108",
    },
  },
});
