import "./style.css";
import { hydrate } from "@ivlev-dev/silent-core";
import { App } from "./app";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

void hydrate(root, App, { props: { title: "Silent Framework" } });
