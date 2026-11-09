import "./style.css";
import { mount } from "@silent/core";
import { App } from "./app";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

void mount(root, App, { props: { title: "Silent Framework" } });
