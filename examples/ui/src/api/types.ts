import { defineProtocol } from "@ivlev-dev/silent-protocol";

export const CONTENT_TYPE = "application/x-silent-protocol";

export const PROJECT_STATUSES = ["active", "review", "done", "paused"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export class Project {
  public budget = 0;
  public createdAt = new Date(0);
  public id = 0;
  public name = "";
  public owner = "";
  public status: ProjectStatus = "active";
  public tags: string[] = [];
}

defineProtocol(Project, {
  fields: [
    { name: "budget", type: "float64" },
    { name: "createdAt", type: "date" },
    { name: "id", type: "uint32" },
    { name: "name", type: "string" },
    { name: "owner", type: "string" },
    { name: "status", type: ["enum", PROJECT_STATUSES] },
    { name: "tags", type: ["array", "string"] },
  ],
});

export interface ProjectQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly sort: string;
  readonly order: "asc" | "desc";
  readonly q?: string | undefined;
  readonly status?: ProjectStatus | undefined;
  readonly owner?: string | undefined;
  readonly tag?: string | undefined;
  readonly budgetMin?: number | undefined;
  readonly budgetMax?: number | undefined;
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
}

export class ProjectPage {
  public items: Project[] = [];
  public page = 0;
  public pageSize = 0;
  public total = 0;
}

defineProtocol(ProjectPage, {
  fields: [
    { name: "items", type: ["array", ["class", () => Project]] },
    { name: "page", type: "uint32" },
    { name: "pageSize", type: "uint32" },
    { name: "total", type: "uint32" },
  ],
});

export class ProjectMeta {
  public owners: string[] = [];
  public statuses: ProjectStatus[] = [];
  public tags: string[] = [];
}

defineProtocol(ProjectMeta, {
  fields: [
    { name: "owners", type: ["array", "string"] },
    { name: "statuses", type: ["array", ["enum", PROJECT_STATUSES]] },
    { name: "tags", type: ["array", "string"] },
  ],
});

export class ProjectInput {
  public budget = 0;
  public name = "";
  public owner = "";
  public status: ProjectStatus = "active";
  public tags: string[] = [];
}

defineProtocol(ProjectInput, {
  fields: [
    { name: "budget", type: "float64" },
    { name: "name", type: "string" },
    { name: "owner", type: "string" },
    { name: "status", type: ["enum", PROJECT_STATUSES] },
    { name: "tags", type: ["array", "string"] },
  ],
});

export class ProjectPatch {
  public budget: number | undefined = undefined;
  public name: string | undefined = undefined;
  public owner: string | undefined = undefined;
  public status: ProjectStatus | undefined = undefined;
  public tags: string[] | undefined = undefined;
}

defineProtocol(ProjectPatch, {
  fields: [
    { name: "budget", type: "float64", optional: true },
    { name: "name", type: "string", optional: true },
    { name: "owner", type: "string", optional: true },
    { name: "status", type: ["enum", PROJECT_STATUSES], optional: true },
    { name: "tags", type: ["array", "string"], optional: true },
  ],
});

export class UploadResult {
  public id = "";
  public mime = "";
  public name = "";
  public size = 0;
  public url = "";
}

defineProtocol(UploadResult, {
  fields: [
    { name: "id", type: "string" },
    { name: "mime", type: "string" },
    { name: "name", type: "string" },
    { name: "size", type: "uint32" },
    { name: "url", type: "string" },
  ],
});

export class ApiErrorBody {
  public code = "";
  public message = "";
}

defineProtocol(ApiErrorBody, {
  fields: [
    { name: "code", type: "string" },
    { name: "message", type: "string" },
  ],
});

export class Health {
  public ok = false;
}

defineProtocol(Health, {
  fields: [{ name: "ok", type: "bool" }],
});
