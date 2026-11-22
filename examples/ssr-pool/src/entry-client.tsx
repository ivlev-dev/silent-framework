import { hydrate } from "@ivlev-dev/silent-core";
import { Page } from "./app";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

const params = new URLSearchParams(window.location.search);
const state = globalThis as typeof globalThis & { __silentReady?: boolean };

// Клиент всегда гидрирует готовую панель без задержки и без late:
// delay/fail — это серверные сценарии примера с пулом.
void hydrate(root, Page, {
  props: {
    title: params.get("title") ?? "Silent SSR Pool",
    req: params.get("req") ?? "main",
    delayMs: 0,
    late: false,
    fail: false,
  },
}).then((handle) =>
  handle.ready.then(() => {
    state.__silentReady = true;
  }),
);
