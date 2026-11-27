import "@ivlev-dev/silent-ui/styles.css";
import "./style.css";
import { mount } from "@ivlev-dev/silent-core";
import { applyTheme, readStoredTheme } from "@ivlev-dev/silent-ui";
import { App } from "./app";

applyTheme({ theme: readStoredTheme() ?? "auto" });

const root = document.querySelector("#app");
if (root === null) throw new Error("#app not found");
void mount(root, App);
