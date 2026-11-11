/** @jsxImportSource solid-js */

import { renderToString } from "solid-js/web";
import { App } from "./app";
import { TITLE } from "../../shared/app-data";

export interface ServerRenderResult {
  readonly html: string;
  readonly head: string;
}

export function render(): ServerRenderResult {
  return { html: renderToString(() => <App title={TITLE} />), head: "" };
}
