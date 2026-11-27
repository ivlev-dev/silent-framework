export type ProjectStatus = "active" | "review" | "done" | "paused";

export interface Project {
  readonly id: number;
  readonly name: string;
  readonly owner: string;
  readonly status: ProjectStatus;
  readonly tags: readonly string[];
  readonly budget: number;
  readonly createdAt: string;
}

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

export interface ProjectPage {
  readonly items: readonly Project[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ProjectMeta {
  readonly statuses: readonly ProjectStatus[];
  readonly owners: readonly string[];
  readonly tags: readonly string[];
}

export interface ProjectInput {
  readonly name: string;
  readonly owner: string;
  readonly status: ProjectStatus;
  readonly tags: readonly string[];
  readonly budget: number;
}

export interface UploadResult {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  readonly url: string;
}

export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}
