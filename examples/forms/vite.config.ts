import { defineConfig, type UserConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";

const config: UserConfig = {
  plugins: [silent()],
  build: {
    outDir: "dist/client",
  },
  ssr: {
    // Рантайм и пакеты формы/валидации должны оставаться внешними:
    // иначе Vite встроит вторую копию silent-core в серверный граф.
    external: [
      "@ivlev-dev/silent-core",
      "@ivlev-dev/silent-di",
      "@ivlev-dev/silent-form",
      "@ivlev-dev/silent-reactivity",
      "@ivlev-dev/silent-server",
      "@ivlev-dev/silent-validation",
    ],
  },
};

export default defineConfig(config);
