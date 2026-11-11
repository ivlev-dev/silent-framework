import "./style.css";
import { render } from "solid-js/web";
import { App } from "./app";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

render(() => <App title="Build bench" />, root);
