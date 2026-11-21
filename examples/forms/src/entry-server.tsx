import { Container } from "@ivlev-dev/silent-di";
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";
import { AppVM } from "./app.vm";

/**
 * Рендерит страницу формы для одного HTTP-запроса.
 *
 * `renderToString` создаёт собственный request scope, а `AppVM` привязан как
 * transient: на каждый вызов появляется новый `AppVM` и новый `ProfileForm`.
 * Это важно для SSR — состояние формы не должно перетекать между запросами.
 *
 * `url` пока не влияет на разметку (в примере один маршрут), но сохранён в
 * сигнатуре, чтобы сервер мог передать его при добавлении роутинга.
 */
export async function render(
  url = "/",
): Promise<{ html: string; head: string }> {
  void url;
  const container = new Container("forms-ssr", undefined, {
    implicitBindings: "error",
  });
  container.bind(AppVM, AppVM).inTransientScope();
  try {
    return await renderToString(App, { container });
  } finally {
    container.dispose();
  }
}
