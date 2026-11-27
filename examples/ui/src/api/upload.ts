import { decode } from "@ivlev-dev/silent-protocol";
import type {
  FileUploadContext,
  FileUploadHandler,
  FileUploadResult,
} from "@ivlev-dev/silent-ui";
import { ApiError } from "./client.js";
import { ApiErrorBody, CONTENT_TYPE, UploadResult } from "./types.js";

function bytesOf(xhr: XMLHttpRequest): Uint8Array {
  const response: unknown = xhr.response;
  if (response instanceof ArrayBuffer) return new Uint8Array(response);
  return new Uint8Array();
}

function failure(status: number, bytes: Uint8Array): ApiError {
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

export function createProtocolUpload(url: string): FileUploadHandler {
  return (file: File, context: FileUploadContext) =>
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

      xhr.open("POST", url, true);
      xhr.responseType = "arraybuffer";
      xhr.setRequestHeader("Accept", CONTENT_TYPE);

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
        const bytes = bytesOf(xhr);
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(failure(xhr.status, bytes));
          return;
        }
        try {
          const result = decode(UploadResult, bytes);
          resolve({
            id: result.id,
            mime: result.mime,
            name: result.name,
            size: result.size,
            url: result.url,
          });
        } catch {
          reject(
            new ApiError(
              "invalid_response",
              "Сервер вернул некорректный ответ",
              xhr.status,
            ),
          );
        }
      });

      const form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    });
}
