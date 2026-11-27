import { Route, type QueryInput, type RouteInput } from "@ivlev-dev/silent-router";
import type { ProjectStatus } from "../../api/types.js";
import { isProjectStatus } from "../../lib/format.js";

export interface ProjectsRouteQuery {
  readonly [key: string]: QueryInput;
  readonly q?: string;
  readonly status?: ProjectStatus;
  readonly owner?: string;
  readonly tag?: string;
  readonly budgetMin?: number;
  readonly budgetMax?: number;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly sort?: string;
  readonly order?: "asc" | "desc";
}

export const ROUTE_PATHS = {
  dashboard: "/",
  projects: "/projects",
  team: "/team",
  settings: "/settings",
} as const;

export type SectionKey = keyof typeof ROUTE_PATHS;

export function isSectionKey(value: string): value is SectionKey {
  return Object.prototype.hasOwnProperty.call(ROUTE_PATHS, value);
}

function sectionForPath(path: string): SectionKey {
  if (path === ROUTE_PATHS.projects) return "projects";
  if (path === ROUTE_PATHS.team) return "team";
  if (path === ROUTE_PATHS.settings) return "settings";
  return "dashboard";
}

export function sectionFromPath(path: string): SectionKey {
  return sectionForPath(path);
}

function parseString(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parsePositiveInt(value: string | string[] | undefined): number | undefined {
  const raw = parseString(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
}

function parseNonNegativeNumber(
  value: string | string[] | undefined,
): number | undefined {
  const raw = parseString(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function parseStatus(value: string | string[] | undefined): ProjectStatus | undefined {
  const raw = parseString(value);
  return raw !== undefined && isProjectStatus(raw) ? raw : undefined;
}

function parseOrder(value: string | string[] | undefined): "asc" | "desc" | undefined {
  const raw = parseString(value);
  return raw === "asc" || raw === "desc" ? raw : undefined;
}

export class DashboardRoute extends Route<"/"> {
  readonly path = ROUTE_PATHS.dashboard;
  readonly name = "dashboard" as const;
  readonly meta = { title: "Dashboard" };

  async load() {
    const module = await import("../../features/dashboard/dashboard-page.js");
    return module.default;
  }
}

export class ProjectsRoute extends Route<"/projects", ProjectsRouteQuery> {
  readonly path = ROUTE_PATHS.projects;
  readonly name = "projects" as const;
  readonly meta = { title: "Проекты" };
  readonly query = {
    q: "string" as const,
    status: parseStatus,
    owner: "string" as const,
    tag: "string" as const,
    budgetMin: parseNonNegativeNumber,
    budgetMax: parseNonNegativeNumber,
    createdFrom: "string" as const,
    createdTo: "string" as const,
    page: parsePositiveInt,
    pageSize: parsePositiveInt,
    sort: "string" as const,
    order: parseOrder,
  };

  async load() {
    const module = await import("../../features/projects/projects-page.js");
    return module.default;
  }
}

export class TeamRoute extends Route<"/team"> {
  readonly path = ROUTE_PATHS.team;
  readonly name = "team" as const;
  readonly meta = { title: "Команда" };

  async load() {
    const module = await import("../../features/team/team-page.js");
    return module.default;
  }
}

export class SettingsRoute extends Route<"/settings"> {
  readonly path = ROUTE_PATHS.settings;
  readonly name = "settings" as const;
  readonly meta = { title: "Настройки" };

  async load() {
    const module = await import("../../features/settings/settings-page.js");
    return module.default;
  }
}

export class NotFoundRoute extends Route<"*"> {
  readonly path = "*";
  readonly name = "not-found" as const;
  readonly redirect = ROUTE_PATHS.dashboard;
}

export const routes: readonly RouteInput[] = [
  DashboardRoute,
  ProjectsRoute,
  TeamRoute,
  SettingsRoute,
  NotFoundRoute,
];
