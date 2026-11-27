import type { FileUploadHandler, FileUploadResult } from "./types.js";

export interface XhrUploadOptions {
  readonly method?: string | undefined;
  readonly fieldName?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly withCredentials?: boolean | undefined;
  readonly responseType?: XMLHttpRequestResponseType | undefined;
  readonly parse?:
    | ((xhr: XMLHttpRequest, file: File) => FileUploadResult)
    | undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function responseOf(xhr: XMLHttpRequest): FileUploadResult {
  const body: unknown = xhr.response;
  if (isRecord(body)) return body as FileUploadResult;
  if (typeof body === "string" && body !== "") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed)) return parsed as FileUploadResult;
      return { response: parsed };
    } catch {
      return { response: body };
    }
  }
  return { response: body };
}

/**
 * Загрузчик на `XMLHttpRequest`: в отличие от `fetch`, он отдаёт прогресс
 * отправки (`xhr.upload.onprogress`) и поддерживает `AbortSignal`.
 */
export function createXhrUpload(
  url: string,
  options: XhrUploadOptions = {},
): FileUploadHandler {
  return (file, context) =>
    new Promise<FileUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = (): void => {
        xhr.abort();
      };
      if (context.signal.aborted) {
        reject(new DOMException("Загрузка отменена", "AbortError"));
        return;
      }
      context.signal.addEventListener("abort", abort, { once: true });
      const settle = (): void => {
        context.signal.removeEventListener("abort", abort);
      };

      xhr.open(options.method ?? "POST", url, true);
      xhr.withCredentials = options.withCredentials === true;
      if (options.responseType !== undefined) {
        xhr.responseType = options.responseType;
      }
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        xhr.setRequestHeader(name, value);
      }

      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable || event.total <= 0) return;
        context.onProgress(
          Math.min(100, Math.max(0, (event.loaded / event.total) * 100)),
        );
      });
      xhr.addEventListener("error", () => {
        settle();
        reject(new Error("Сетевая ошибка при загрузке файла"));
      });
      xhr.addEventListener("abort", () => {
        settle();
        reject(new DOMException("Загрузка отменена", "AbortError"));
      });
      xhr.addEventListener("load", () => {
        settle();
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(
            new Error(
              xhr.statusText === ""
                ? `Сервер ответил ${xhr.status}`
                : `${xhr.statusText} (${xhr.status})`,
            ),
          );
          return;
        }
        resolve(
          options.parse === undefined
            ? responseOf(xhr)
            : options.parse(xhr, file),
        );
      });

      const form = new FormData();
      form.append(options.fieldName ?? "file", file, file.name);
      xhr.send(form);
    });
}
