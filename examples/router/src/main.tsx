import "./style.css";
import { hydrate } from "@ivlev-dev/silent-core";
import { App } from "./app";
import { appServices } from "./container";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

const { container, router } = appServices();
await router.start();

const state = globalThis as typeof globalThis & { __silentReady?: boolean };
void hydrate(root, App, {
  container,
  props: { title: "Silent Router" },
}).then((handle) =>
  handle.ready.then(() => {
    state.__silentReady = true;
  }),
);
