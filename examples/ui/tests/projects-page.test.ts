// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { encode } from "@ivlev-dev/silent-protocol";
import { Router, createMemoryHistory, type RouterHistory } from "@ivlev-dev/silent-router";
import { mount } from "@ivlev-dev/silent-core";
import type { AnyComponent } from "@ivlev-dev/silent-core";
import { Project, ProjectMeta, ProjectPage } from "../src/api/types.js";
import { ProjectsPage } from "../src/features/projects/projects-page.js";
import { routes } from "../src/app/router/routes.js";
import { resetProjectMeta } from "../src/app/data.js";

function projectFixture(): Project {
  const project = new Project();
  project.budget = 12000;
  project.createdAt = new Date("2026-01-15T00:00:00Z");
  project.id = 1;
  project.name = "API Platform";
  project.owner = "Ада";
  project.status = "active";
  project.tags = ["api"];
  return project;
}

function protocolResponse(body: object): Response {
  return new Response(encode(body), {
    status: 200,
    headers: { "Content-Type": "application/x-silent-protocol" },
  });
}

const fetchCalls: string[] = [];

function stubFetch(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    const url = String(input);
    if (url.includes("/api/meta")) {
      const meta = new ProjectMeta();
      meta.owners = ["Ада"];
      meta.statuses = ["active"];
      meta.tags = ["api"];
      return protocolResponse(meta);
    }
    if (url.includes("/api/projects")) {
      const page = new ProjectPage();
      page.items = [projectFixture()];
      page.page = 1;
      page.pageSize = 10;
      page.total = 1;
      return protocolResponse(page);
    }
    return new Response(null, { status: 404 });
  });
}

afterEach(() => {
  fetchCalls.length = 0;
  vi.unstubAllGlobals();
  resetProjectMeta();
  document.body.replaceChildren();
});

describe("страница проектов", () => {
  it("монтируется с фильтрами из URL без зависания и без лишних запросов", async () => {
    stubFetch();
    const history: RouterHistory = createMemoryHistory(
      "/projects?q=api&status=active&page=2",
    );
    const router = new Router({ routes, history });
    const target = document.createElement("div");
    document.body.appendChild(target);

    const started = performance.now();
    const handle = await mount(target, ProjectsPage as unknown as AnyComponent, {
      props: {
        router,
        query: { q: "api", status: "active", page: 2, pageSize: 10 },
        route: { path: "/projects", fullPath: "/projects", query: {} },
        params: {},
        hash: "",
        meta: {},
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(2000);
    expect(target.textContent).toContain("Проекты");
    const table = target.querySelector(".sui-data-table");
    expect(table).not.toBeNull();
    expect(table?.hasAttribute("data-loaded")).toBe(true);
    expect(table?.hasAttribute("data-loading")).toBe(false);
    expect(target.textContent).toContain("API Platform");
    expect(fetchCalls.length).toBeLessThanOrEqual(2);
    const projectRequest = fetchCalls.find((url) => url.includes("/api/projects"));
    expect(projectRequest).toContain("q=api");
    expect(projectRequest).toContain("status=active");
    expect(projectRequest).toContain("page=2");

    handle.dispose();
  });
});
