import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";

export interface RenderProps {
  title: string;
}

export function render(
  props: RenderProps,
): Promise<{ html: string; head: string }> {
  return renderToString(App, { props: { title: props.title } });
}
