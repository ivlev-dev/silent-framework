import "./style.css";
import { mount } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";
import { Router } from "@ivlev-dev/silent-router";
import { App } from "./app";
import { routes } from "./routes";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

const container = new Container("router-example");
const router = new Router({ routes, container });
await router.start();

void mount(root, App, {
  container,
  props: { title: "Silent Router" },
});
