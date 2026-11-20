import { createMemoryHistory } from "@ivlev-dev/silent-router";
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";
import { createAppServices } from "./container";

export async function render(
  url: string,
  title = "Silent Router",
): Promise<{ html: string; head: string }> {
  const { container, router } = createAppServices({
    history: createMemoryHistory(url),
  });
  try {
    await router.start();
    return await renderToString(App, {
      container,
      props: { title },
    });
  } finally {
    router.dispose();
    container.dispose();
  }
}
