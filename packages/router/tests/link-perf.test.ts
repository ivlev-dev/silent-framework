import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Link,
  Router,
  createMemoryHistory,
  type RouteRecord,
} from "../src/index";
import { leaf, render, tick, type Rendered } from "./support";

const ROUTE_COUNT = 50;
const LINK_COUNT = 10;
const NAVIGATIONS = 1000;
const SAMPLES = 5;

const rendered: Rendered[] = [];
const routers: Router[] = [];

function createRoutes(): RouteRecord[] {
  const routes: RouteRecord[] = [
    { path: "/", name: "home", component: leaf("home") },
    { path: "*", name: "fallback", component: leaf("fallback") },
  ];
  for (let index = 0; index < ROUTE_COUNT; index += 1) {
    routes.push({
      path: `/p${index}/:id`,
      name: `p${index}`,
      component: leaf(`p${index}`),
    });
  }
  return routes;
}

async function measureSample(routes: readonly RouteRecord[]): Promise<number> {
  const history = createMemoryHistory("/");
  const router = new Router({ routes, history });
  routers.push(router);
  await router.start();

  const page = render(() => {
    const host = document.createElement("div");
    for (let index = 0; index < LINK_COUNT; index += 1) {
      host.appendChild(Link({
        to: `/p${(index * 5) % ROUTE_COUNT}/link-${index}`,
        class: "link",
        activeClass: "active",
        exactActiveClass: "exact",
        children: `link-${index}`,
      }));
    }
    return host;
  });
  rendered.push(page);
  await tick();

  const started = performance.now();
  for (let index = 0; index < NAVIGATIONS; index += 1) {
    await router.push(`/p${(index * 7) % ROUTE_COUNT}/item-${index}`);
  }
  return performance.now() - started;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

afterEach(() => {
  while (rendered.length > 0) {
    rendered.pop()?.dispose();
  }
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  document.body.replaceChildren();
});

describe("производительность Link и сопоставления маршрутов", () => {
  it("1000 навигаций по 50 маршрутам с 10 Link укладываются в бюджет", async () => {
    const routes = createRoutes();
    const samples: number[] = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      samples.push(await measureSample(routes));
    }
    const result = median(samples);
    console.log(
      `[router-perf] медиана ${result.toFixed(1)} ms; прогоны: `
      + samples.map((value) => value.toFixed(1)).join(", "),
    );
    // Порог намеренно свободный: файл может выполняться параллельно с остальными
    // jsdom-тестами, поэтому абсолютное время шумит. Точную дельту фиксирует
    // отчёт по бенчмарку, а регрессию Link ловит тест на число resolve ниже.
    expect(result).toBeLessThan(15_000);
  }, 120_000);

  it("не пересчитывает ссылки на каждый pending-тик", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const router = new Router({
      routes: [
        { path: "/", name: "home", component: leaf("home") },
        {
          path: "/slow",
          name: "slow",
          component: leaf("slow"),
          beforeEnter: async () => {
            await gate;
            return true;
          },
        },
      ],
      history: createMemoryHistory("/"),
    });
    routers.push(router);
    await router.start();

    const page = render(() => {
      const host = document.createElement("div");
      for (let index = 0; index < LINK_COUNT; index += 1) {
        host.appendChild(Link({
          to: index === 0 ? "/slow" : `/slow?tab=${index}`,
          class: "link",
          activeClass: "active",
          exactActiveClass: "exact",
          children: `link-${index}`,
        }));
      }
      return host;
    });
    rendered.push(page);
    await tick();

    const resolve = vi.spyOn(router, "resolve");
    resolve.mockClear();

    const navigation = router.push("/slow");
    await tick();
    expect(resolve).not.toHaveBeenCalled();

    release();
    await navigation;
    await tick();
    expect(resolve).toHaveBeenCalledTimes(LINK_COUNT);
  }, 30_000);
});
