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
 * Токен последней загрузки для поля. Поздние/отменённые результаты
 * предыдущих загрузок не должны перетирать новую и снимать её `isReady`.
 */
const uploadTokens = new WeakMap<Form, Map<string, number>>();

function nextUploadToken(form: Form, path: string): number {
  let tokens = uploadTokens.get(form);
  if (tokens === undefined) {
    tokens = new Map();
    uploadTokens.set(form, tokens);
  }
  const token = (tokens.get(path) ?? 0) + 1;
  tokens.set(path, token);
  return token;
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
  const token = nextUploadToken(form, path);
  const tokens = uploadTokens.get(form)!;
  const isLatest = (): boolean => tokens.get(path) === token;
  field.setReady(false);
  try {
    const result = await uploader(file, {
      signal: options?.signal,
      onProgress: (progress) => options?.onProgress?.(progress),
    });
    if (isLatest() && options?.signal?.aborted !== true) {
      field.setValue(result as never);
    }
    return result;
  } finally {
    if (isLatest()) {
      field.setReady(true);
    }
  }
}
