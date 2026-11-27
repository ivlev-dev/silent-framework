import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import type { ControlSize } from "../../form/internal/control.js";

export type FileUploadStatus =
  | "queued"
  | "uploading"
  | "success"
  | "error"
  | "cancelled";

export type FileUploadVariant = "zone" | "compact";

/** Ответ загрузчика: id/url и любые метаданные сервера. */
export interface FileUploadResult {
  readonly id?: string | number | undefined;
  readonly url?: string | undefined;
  readonly [key: string]: unknown;
}

/** Прогресс в процентах 0–100 и сигнал отмены конкретного файла. */
export interface FileUploadContext {
  readonly onProgress: (percent: number) => void;
  readonly signal: AbortSignal;
}

export type FileUploadHandler = (
  file: File,
  context: FileUploadContext,
) => Promise<FileUploadResult>;

export interface FileUploadItem {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly status: FileUploadStatus;
  /** Прогресс в процентах 0–100. */
  readonly progress: number;
  readonly file?: File | undefined;
  readonly error?: string | undefined;
  readonly url?: string | undefined;
  readonly previewUrl?: string | undefined;
  readonly response?: FileUploadResult | undefined;
}

export type FileUploadRejectionReason =
  | "accept"
  | "max-size"
  | "max-files"
  | "duplicate";

export interface FileUploadRejection {
  readonly file: File;
  readonly reason: FileUploadRejectionReason;
  readonly message: string;
}

export interface FileUploadProps {
  /** Controlled-подобный список: внешние изменения синхронизируются. */
  readonly files?: readonly FileUploadItem[] | undefined;
  readonly defaultFiles?: readonly FileUploadItem[] | undefined;
  readonly onFilesChange?:
    | ((files: readonly FileUploadItem[]) => void)
    | undefined;
  readonly multiple?: boolean | undefined;
  /** `accept` в формате нативного input: MIME, `image/*`, `.pdf`. */
  readonly accept?: string | undefined;
  /** Максимальный размер одного файла в байтах. */
  readonly maxSize?: number | undefined;
  /** Максимум файлов; для одиночного режима всегда 1. */
  readonly maxFiles?: number | undefined;
  readonly upload?: FileUploadHandler | undefined;
  /** Запускать `upload` сразу после добавления. По умолчанию `true`. */
  readonly autoUpload?: boolean | undefined;
  readonly variant?: FileUploadVariant | undefined;
  readonly size?: ControlSize | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly chooseLabel?: string | undefined;
  readonly dropLabel?: string | undefined;
  readonly listLabel?: string | undefined;
  readonly showPreview?: boolean | undefined;
  readonly onReject?:
    | ((rejections: readonly FileUploadRejection[]) => void)
    | undefined;
  readonly onUploadError?: ((error: unknown, file: File) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}
