import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";
import { TITLE } from "../../shared/app-data";

export interface ServerRenderResult {
  readonly html: string;
  readonly head: string;
}

export function render(): Promise<ServerRenderResult> {
  return renderToString(App, { props: { title: TITLE } });
}
