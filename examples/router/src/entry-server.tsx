import { Container } from "@ivlev-dev/silent-di";
import { Router, createMemoryHistory } from "@ivlev-dev/silent-router";
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";
import { routes } from "./routes";

export async function render(
  url: string,
  title = "Silent Router",
): Promise<{ html: string; head: string }> {
  const container = new Container("router-request");
  const router = new Router({
    routes,
    history: createMemoryHistory(url),
    container,
  });
  await router.start();
  return renderToString(App, {
    container,
    props: { title },
  });
}
