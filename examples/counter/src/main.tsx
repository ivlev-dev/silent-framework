import "./style.css";
import { hydrate } from "@ivlev-dev/silent-core";
import { App } from "./app";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

const state = globalThis as typeof globalThis & { __silentReady?: boolean };
void hydrate(root, App, { props: { title: "Silent Framework" } }).then((handle) =>
  handle.ready.then(() => {
    state.__silentReady = true;
  }),
);
