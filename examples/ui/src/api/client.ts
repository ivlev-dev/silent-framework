import type {
  ApiErrorBody,
  Project,
  ProjectInput,
  ProjectMeta,
  ProjectPage,
  ProjectQuery,
  UploadResult,
} from "./types.js";

export const API_BASE = "/api";
export const UPLOAD_URL = `${API_BASE}/uploads`;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}

export function errorMessage(value: unknown, fallback = "Не удалось выполнить запрос"): string {
  if (isApiError(value)) return value.message;
  if (value instanceof Error && value.message !== "") return value.message;
  if (typeof value === "string" && value !== "") return value;
  return fallback;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function parseErrorBody(value: unknown): ApiErrorBody["error"] | undefined {
  if (!isRecord(value)) return undefined;
  const body = value["error"];
  if (!isRecord(body)) return undefined;
  const code = body["code"];
  const message = body["message"];
  if (typeof code !== "string" || typeof message !== "string") return undefined;
  return { code, message };
}

interface RequestOptions {
  readonly method?: string | undefined;
  readonly body?: unknown;
  readonly signal?: AbortSignal | undefined;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const hasBody = options.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  if (text.trim() !== "") {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const parsed = parseErrorBody(payload);
    throw new ApiError(
      parsed?.code ?? `http_${String(response.status)}`,
      parsed?.message ?? `Сервер ответил ${String(response.status)}`,
      response.status,
    );
  }

  return payload as T;
}

function appendParam(
  params: URLSearchParams,
  key: string,
  value: string | number | undefined,
): void {
  if (value === undefined) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return;
    params.set(key, trimmed);
    return;
  }
  if (Number.isFinite(value)) params.set(key, String(value));
}

export function projectQueryParams(query: ProjectQuery): URLSearchParams {
  const params = new URLSearchParams();
  appendParam(params, "page", query.page);
  appendParam(params, "pageSize", query.pageSize);
  appendParam(params, "sort", query.sort);
  appendParam(params, "order", query.order);
  appendParam(params, "q", query.q);
  appendParam(params, "status", query.status);
  appendParam(params, "owner", query.owner);
  appendParam(params, "tag", query.tag);
  appendParam(params, "budgetMin", query.budgetMin);
  appendParam(params, "budgetMax", query.budgetMax);
  appendParam(params, "createdFrom", query.createdFrom);
  appendParam(params, "createdTo", query.createdTo);
  return params;
}

export function listProjects(
  query: ProjectQuery,
  signal?: AbortSignal,
): Promise<ProjectPage> {
  const params = projectQueryParams(query);
  return request<ProjectPage>(`/projects?${params.toString()}`, {
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function getMeta(signal?: AbortSignal): Promise<ProjectMeta> {
  return request<ProjectMeta>("/meta", {
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function createProject(
  input: ProjectInput,
  signal?: AbortSignal,
): Promise<Project> {
  return request<Project>("/projects", {
    method: "POST",
    body: input,
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function updateProject(
  id: number,
  input: ProjectInput,
  signal?: AbortSignal,
): Promise<Project> {
  return request<Project>(`/projects/${String(id)}`, {
    method: "PATCH",
    body: input,
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function deleteProject(id: number, signal?: AbortSignal): Promise<void> {
  return request<void>(`/projects/${String(id)}`, {
    method: "DELETE",
    ...(signal !== undefined ? { signal } : {}),
  });
}

export type { UploadResult };
