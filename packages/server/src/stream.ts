import type { AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString, type RenderOptions } from "./render.js";

export interface StreamOptions extends RenderOptions {
  readonly chunkSize?: number;
  readonly onHead?: (head: string) => void;
}

const DEFAULT_CHUNK_SIZE = 16 * 1024;

export function renderToStream(
  app: AnyComponent,
  options: StreamOptions = {},
): ReadableStream<string> {
  const chunkSize =
    options.chunkSize !== undefined && options.chunkSize > 0
      ? options.chunkSize
      : DEFAULT_CHUNK_SIZE;
  const onHead = options.onHead;
  const renderOptions: RenderOptions = {
    ...(options.props !== undefined ? { props: options.props } : {}),
    ...(options.container !== undefined ? { container: options.container } : {}),
    ...(options.preloader !== undefined ? { preloader: options.preloader } : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  };

  return new ReadableStream<string>({
    async start(controller): Promise<void> {
      try {
        const { html, head } = await renderToString(app, renderOptions);
        onHead?.(head);
        for (let index = 0; index < html.length; index += chunkSize) {
          controller.enqueue(html.slice(index, index + chunkSize));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
