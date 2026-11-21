import "./style.css";
import { Container } from "@ivlev-dev/silent-di";
import { hydrate } from "@ivlev-dev/silent-core";
import { App } from "./app";
import { AppVM } from "./app.vm";

/**
 * Клиентский вход SSR-версии: адоптирует серверную разметку.
 *
 * `hydrate` переиспользует существующие узлы, а если `#app` пуст (обычный
 * `vite dev` без SSR), откатывается на клиентский рендер — поэтому один и тот
 * же вход работает и в dev, и после серверного рендера.
 */
export async function hydrateApp(): Promise<void> {
  const root = document.querySelector("#app");
  if (root === null) {
    throw new Error("#app not found");
  }

  const container = new Container("forms-example", undefined, {
    implicitBindings: "error",
  });
  container.bind(AppVM, AppVM).inTransientScope();

  await hydrate(root, App, {
    container,
    onMismatch: (error) => {
      console.warn(`[forms] гидрация: ${error.message}`);
    },
  });
}

const state = globalThis as typeof globalThis & { __silentReady?: boolean };

function start(): void {
  void hydrateApp().then(
    () => {
      state.__silentReady = true;
    },
    (error: unknown) => {
      console.error(error);
    },
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
