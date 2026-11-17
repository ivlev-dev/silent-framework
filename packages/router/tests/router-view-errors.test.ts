// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setServerMode } from "@ivlev-dev/silent-core";
import {
  Router,
  RouterNavigationError,
  RouterView,
  createTestRouter,
  type RouteRecord,
} from "../src/index";
import { leaf, render, tick, type Rendered } from "./support";

const routers: Router[] = [];
const rendered: Rendered[] = [];

function track(router: Router): Router {
  routers.push(router);
  return router;
}

function mount(factory: () => Node): Rendered {
  const result = render(factory);
  rendered.push(result);
  return result;
}

function messageSlot(label: string): (error: unknown) => HTMLElement {
  return (error: unknown): HTMLElement => {
    const element = document.createElement("p");
    element.dataset.view = label;
    element.textContent = error instanceof Error ? error.message : String(error);
    return element;
  };
}

afterEach(() => {
  while (rendered.length > 0) {
    rendered.pop()?.dispose();
  }
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  setServerMode(false);
  document.body.replaceChildren();
});

const routes: readonly RouteRecord[] = [
  { path: "/", name: "home", component: leaf("home") },
  { path: "/ok", name: "ok", component: leaf("ok") },
  {
    path: "/broken",
    name: "broken",
    load: () => {
      throw new Error("boom");
    },
  },
];

async function setup(initial = "/"): Promise<Router> {
  const router = track(createTestRouter({ routes, initial }));
  await router.start();
  return router;
}

describe("RouterView: ошибки навигации", () => {
  it("показывает error-слот при падении загрузчика и убирает его после успешной навигации", async () => {
    const router = await setup();
    const { host } = mount(() => RouterView({ router, error: messageSlot("error") }));
    expect(host.querySelector("[data-view=home]")).not.toBeNull();

    await expect(router.push("/broken")).rejects.toBeInstanceOf(RouterNavigationError);
    await tick();

    expect(host.querySelector("[data-view=home]")).toBeNull();
    expect(host.querySelector("[data-view=error]")?.textContent).toContain(
      "Загрузчик маршрута broken завершился ошибкой",
    );

    await router.push("/ok");
    await tick();

    expect(host.querySelector("[data-view=error]")).toBeNull();
    expect(host.querySelector("[data-view=ok]")).not.toBeNull();
  });

  it("не оставляет прежний компонент при ошибке навигации", async () => {
    const router = await setup();
    const { host } = mount(() => RouterView({ router, error: messageSlot("error") }));
    expect(host.querySelector("[data-view=home]")).not.toBeNull();

    expect(await router.navigate("/broken")).toBe(false);
    await tick();

    expect(host.querySelector("[data-view=home]")).toBeNull();
    expect(host.querySelector("[data-view=error]")).not.toBeNull();
  });

  it("показывает notFound-слот для no-match", async () => {
    const router = await setup();
    const { host } = mount(() => RouterView({
      router,
      notFound: messageSlot("not-found"),
      error: messageSlot("error"),
    }));
    expect(host.querySelector("[data-view=home]")).not.toBeNull();

    expect(await router.navigate("/missing")).toBe(false);
    await tick();

    expect(host.querySelector("[data-view=not-found]")?.textContent).toContain(
      "Маршрут не найден",
    );
    expect(host.querySelector("[data-view=error]")).toBeNull();
  });

  it("использует error-слот для no-match при отсутствии notFound", async () => {
    const router = await setup();
    const { host } = mount(() => RouterView({ router, error: messageSlot("error") }));

    expect(await router.navigate("/missing")).toBe(false);
    await tick();

    expect(host.querySelector("[data-view=error]")?.textContent).toContain(
      "Маршрут не найден",
    );
  });

  it("показывает дефолтный текст для no-match без слотов", async () => {
    const router = await setup();
    const { host } = mount(() => RouterView({ router }));

    expect(await router.navigate("/missing")).toBe(false);
    await tick();

    expect(host.textContent).toContain("Error:");
    expect(host.textContent).toContain("Маршрут не найден");
  });

  it("показывает сообщение ошибки по умолчанию", async () => {
    const router = await setup();
    const { host } = mount(() => RouterView({ router }));

    expect(await router.navigate("/broken")).toBe(false);
    await tick();

    expect(host.textContent).toContain("Error:");
    expect(host.textContent).toContain("Загрузчик маршрута broken завершился ошибкой");
  });

  it("рендерит error-слот на SSR", async () => {
    setServerMode(true);
    const router = await setup();
    expect(await router.navigate("/broken")).toBe(false);

    const host = document.createElement("div");
    host.appendChild(RouterView({ router, error: messageSlot("error") }));

    expect(host.querySelector("[data-view=error]")?.textContent).toContain(
      "Загрузчик маршрута broken завершился ошибкой",
    );
  });
});
