import { decode, encode } from "@ivlev-dev/silent-protocol";
import {
  ApiErrorBody,
  CONTENT_TYPE,
  Project,
  ProjectInput,
  ProjectMeta,
  ProjectPage,
  ProjectPatch,
  type ProjectQuery,
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

interface RequestOptions {
  readonly method?: string | undefined;
  readonly body?: object | undefined;
  readonly signal?: AbortSignal | undefined;
}

interface RawResponse {
  readonly status: number;
  readonly bytes: Uint8Array;
}

function decodeError(bytes: Uint8Array, status: number): ApiError {
  if (bytes.length > 0) {
    try {
      const body = decode(ApiErrorBody, bytes);
      return new ApiError(body.code, body.message, status);
    } catch {
      return new ApiError(
        `http_${String(status)}`,
        `Сервер вернул некорректную ошибку (${String(status)})`,
        status,
      );
    }
  }
  return new ApiError(
    `http_${String(status)}`,
    `Сервер ответил ${String(status)}`,
    status,
  );
}

async function send(path: string, options: RequestOptions = {}): Promise<RawResponse> {
  const headers: Record<string, string> = {
    Accept: CONTENT_TYPE,
  };
  const body = options.body;
  if (body !== undefined) headers["Content-Type"] = CONTENT_TYPE;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(body !== undefined ? { body: toArrayBuffer(encode(body)) } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return { status: response.status, bytes: new Uint8Array() };

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw decodeError(bytes, response.status);
  return { status: response.status, bytes };
}

async function request<T extends object>(
  path: string,
  model: new () => T,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(path, options);
  if (response.bytes.length === 0) {
    throw new ApiError(
      "invalid_response",
      "Сервер вернул пустой ответ",
      response.status,
    );
  }
  try {
    return decode(model, response.bytes);
  } catch {
    throw new ApiError(
      "invalid_response",
      "Сервер вернул некорректный ответ",
      response.status,
    );
  }
}

async function requestVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await send(path, options);
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
  return request(`/projects?${params.toString()}`, ProjectPage, {
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function getMeta(signal?: AbortSignal): Promise<ProjectMeta> {
  return request("/meta", ProjectMeta, {
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function createProject(
  input: ProjectInput,
  signal?: AbortSignal,
): Promise<Project> {
  return request("/projects", Project, {
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
  const patch = new ProjectPatch();
  patch.name = input.name;
  patch.owner = input.owner;
  patch.status = input.status;
  patch.tags = [...input.tags];
  patch.budget = input.budget;
  return request(`/projects/${String(id)}`, Project, {
    method: "PATCH",
    body: patch,
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function deleteProject(id: number, signal?: AbortSignal): Promise<void> {
  return requestVoid(`/projects/${String(id)}`, {
    method: "DELETE",
    ...(signal !== undefined ? { signal } : {}),
  });
}
