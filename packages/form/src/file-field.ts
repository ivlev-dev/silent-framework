import type { Form } from "./form.js";
import type { FieldProps } from "./types.js";

export interface UploadContext {
  readonly signal: AbortSignal | undefined;
  readonly onProgress: (progress: number) => void;
}

export interface UploadOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((progress: number) => void) | undefined;
}

/**
 * Простой file-helper: помечает поле неготовым на время загрузки,
 * передаёт результат загрузчика в `setValue` и снова помечает готовым.
 * Для отмены используйте `options.signal`; для прогресса — `onProgress`.
 */
export async function uploadField<T>(
  form: Form,
  path: string,
  file: File,
  uploader: (file: File, context: UploadContext) => Promise<T>,
  options?: UploadOptions,
): Promise<T> {
  const field = form.getFieldProps(path as never) as FieldProps<unknown>;
  field.setReady(false);
  try {
    const result = await uploader(file, {
      signal: options?.signal,
      onProgress: (progress) => options?.onProgress?.(progress),
    });
    field.setValue(result as never);
    return result;
  } finally {
    field.setReady(true);
  }
}
