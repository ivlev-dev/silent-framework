import "./style.css";
import { Container } from "@ivlev-dev/silent-di";
import { mount } from "@ivlev-dev/silent-core";
import { App } from "./app";
import { AppVM } from "./app.vm";

const root = document.querySelector("#app");
if (root === null) {
  throw new Error("#app not found");
}

// Явный биндинг ViewModel — без предупреждения DI о неявной зависимости.
const container = new Container("forms-example", undefined, {
  implicitBindings: "error",
});
container.bind(AppVM, AppVM).inTransientScope();

void mount(root, App, { container });
