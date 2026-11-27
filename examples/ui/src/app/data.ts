import { createResource, createResourceCache } from "@ivlev-dev/silent-core";
import type { Resource } from "@ivlev-dev/silent-core";
import { getMeta, listProjects } from "../api/client.js";
import type { Project, ProjectMeta, ProjectPage, ProjectStatus } from "../api/types.js";

const META_KEY = "meta";
const DASHBOARD_KEY = "dashboard-stats";

export const appResourceCache = createResourceCache();

let metaResource: Resource<ProjectMeta> | null = null;

export function projectMeta(): Resource<ProjectMeta> {
  metaResource ??= createResource(({ signal }) => getMeta(signal), {
    key: META_KEY,
    cache: appResourceCache,
  });
  return metaResource;
}

export interface DashboardStats {
  readonly total: number;
  readonly counts: Readonly<Record<ProjectStatus, number>>;
  readonly recent: readonly Project[];
}

function page(status?: ProjectStatus): Promise<ProjectPage> {
  return listProjects({
    page: 1,
    pageSize: 10,
    sort: "createdAt",
    order: "desc",
    ...(status !== undefined ? { status } : {}),
  });
}

async function loadDashboardStats(): Promise<DashboardStats> {
  const [active, review, done, paused, recent] = await Promise.all([
    page("active"),
    page("review"),
    page("done"),
    page("paused"),
    page(),
  ]);
  return {
    total: active.total + review.total + done.total + paused.total,
    counts: {
      active: active.total,
      review: review.total,
      done: done.total,
      paused: paused.total,
    },
    recent: recent.items.slice(0, 5),
  };
}

let dashboardResource: Resource<DashboardStats> | null = null;

export function dashboardStats(): Resource<DashboardStats> {
  dashboardResource ??= createResource(loadDashboardStats, {
    key: DASHBOARD_KEY,
    cache: appResourceCache,
    cacheTime: 30_000,
  });
  return dashboardResource;
}

export function invalidateProjectData(): void {
  appResourceCache.clear();
}

export function invalidateProjectMeta(): void {
  appResourceCache.delete(META_KEY);
}

export function resetProjectMeta(): void {
  metaResource?.dispose();
  metaResource = null;
  dashboardResource?.dispose();
  dashboardResource = null;
  appResourceCache.clear();
}
