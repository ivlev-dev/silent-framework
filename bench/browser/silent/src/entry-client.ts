import "./style.css";
import { hydrate } from "@ivlev-dev/silent-core";
import { App } from "./app";
import { TITLE } from "../../shared/app-data";
import type { HydrationApi } from "../../shared/hydration-api";

const api: HydrationApi = {
  async hydrate(container) {
    const handle = await hydrate(container, App, {
      props: { title: TITLE },
      onMismatch: (error) => {
        throw error;
      },
    });
    return () => handle.dispose();
  },
};

window.__hydrateBench = api;
