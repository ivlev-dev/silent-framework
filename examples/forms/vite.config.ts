import { defineConfig, type UserConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

const config: UserConfig = {
  plugins: [silent()],
};

export default defineConfig(config);
