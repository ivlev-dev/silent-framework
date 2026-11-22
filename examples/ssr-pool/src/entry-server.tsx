import {
  renderToStream,
  renderToString,
  type RenderStreamHandlers,
} from "@ivlev-dev/silent-server";
import { Page } from "./app";
import type { RenderArgs } from "./app.vm";

export type { RenderArgs } from "./app.vm";

export function render(
  args: RenderArgs,
): Promise<{ html: string; head: string }> {
  return renderToString(Page, { props: args });
}

/**
 * Контракт worker pool: `renderStream(...args, handlers)`, обработчики
 * всегда последним аргументом.
 */
export function renderStream(
  args: RenderArgs,
  handlers: RenderStreamHandlers,
): ReadableStream<string> {
  return renderToStream(Page, {
    props: args,
    signal: handlers.signal,
    onHead(head, info) {
      handlers.onHead(head, info);
    },
    onShell(html) {
      handlers.onShell?.(html);
    },
  });
}
