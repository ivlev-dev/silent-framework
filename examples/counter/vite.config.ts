import { defineConfig } from "vite";
import { silent } from "@silent/vite";

export default defineConfig({
  plugins: [silent()],
});
