import { describe, expect, it } from "vitest";
import { Router, createMemoryHistory } from "@ivlev-dev/silent-router";
import {
  ROUTE_PATHS,
  isSectionKey,
  routes,
  sectionFromPath,
} from "../src/app/router/routes.js";

function resolve(url: string) {
  const router = new Router({
    routes,
    history: createMemoryHistory(url),
  });
  return router.resolve(url);
}

describe("маршруты приложения", () => {
  it("распознаёт разделы и пути", () => {
    expect(isSectionKey("projects")).toBe(true);
    expect(isSectionKey("unknown")).toBe(false);
    expect(sectionFromPath(ROUTE_PATHS.dashboard)).toBe("dashboard");
    expect(sectionFromPath("/projects")).toBe("projects");
    expect(sectionFromPath("/team")).toBe("team");
    expect(sectionFromPath("/settings")).toBe("settings");
    expect(sectionFromPath("/missing")).toBe("dashboard");
  });

  it("разбирает deep link с фильтрами проектов", () => {
    const location = resolve(
      "/projects?q=api&status=active&page=2&pageSize=20&sort=name&order=asc",
    );
    expect(location.name).toBe("projects");
    expect(location.query.q).toBe("api");
    expect(location.query.status).toBe("active");
    expect(location.query.page).toBe(2);
    expect(location.query.pageSize).toBe(20);
    expect(location.query.sort).toBe("name");
    expect(location.query.order).toBe("asc");
  });

  it("отбрасывает невалидные значения фильтров", () => {
    const location = resolve(
      "/projects?status=broken&page=0&pageSize=-1&order=sideways&budgetMin=-5",
    );
    expect(location.query.status).toBeUndefined();
    expect(location.query.page).toBeUndefined();
    expect(location.query.pageSize).toBeUndefined();
    expect(location.query.order).toBeUndefined();
    expect(location.query.budgetMin).toBeUndefined();
  });

  it("перенаправляет неизвестный маршрут на dashboard", () => {
    const router = new Router({
      routes,
      history: createMemoryHistory("/missing"),
    });
    const location = router.resolve("/missing");
    expect(location.name).toBe("not-found");
    expect(router.href("/missing")).toContain("/missing");
  });
});
