import "@ivlev-dev/silent-ui/styles.css";
import "./style.css";
import { mount } from "@ivlev-dev/silent-core";
import { applyTheme, readStoredTheme } from "@ivlev-dev/silent-ui";
import { App } from "./app/index.js";
import { createAppRouter, normalizeLegacyHash } from "./app/router/index.js";

applyTheme({ theme: readStoredTheme() ?? "auto" });
normalizeLegacyHash();

const router = createAppRouter();
const root = document.querySelector("#app");
if (root === null) throw new Error("#app not found");

// Роутер стартует параллельно с монтированием оболочки: чанк маршрута
// запрашивается сразу, а не после первого кадра.
const routeReady = router.start();
const handle = await mount(root, App, { props: { router } });
void handle.ready.then(() => {
  performance.mark("silent:mounted");
});
void routeReady
  .then(() => {
    performance.mark("silent:route-ready");
  })
  .catch((error: unknown) => {
    console.error(error);
  });
