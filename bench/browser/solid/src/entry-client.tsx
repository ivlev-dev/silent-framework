/** @jsxImportSource solid-js */

import "./style.css";
import { sharedConfig } from "solid-js";
import { hydrate } from "solid-js/web";
import { App } from "./app";
import { TITLE } from "../../shared/app-data";
import type { HydrationApi } from "../../shared/hydration-api";

interface SolidHydrationState {
  done?: boolean;
  events: unknown[];
  completed: WeakSet<Node>;
  r: Record<string, unknown>;
}

const hydrationState = globalThis as { _$HY?: SolidHydrationState };

const api: HydrationApi = {
  prepare() {
    sharedConfig.done = false;
    const state = hydrationState._$HY;
    if (state !== undefined) {
      state.done = false;
      state.events = [];
      state.completed = new WeakSet<Node>();
      state.r = {};
    }
  },
  async hydrate(container) {
    return hydrate(() => <App title={TITLE} />, container);
  },
};

window.__hydrateBench = api;
