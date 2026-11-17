import "./style.css";
import { hydrate } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";
import { Router, createBrowserHistory } from "@ivlev-dev/silent-router";
import { App } from "./app";
import { routes } from "./routes";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

const container = new Container("router-example");
const router = new Router({
  routes,
  history: createBrowserHistory(),
  container,
});
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
