import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show, createSignal, onCleanup } from "@ivlev-dev/silent-core";
import { CloseIcon } from "../../icons/close.js";
import { ErrorIcon } from "../../icons/error.js";
import { RefreshIcon } from "../../icons/refresh.js";
import { SuccessIcon } from "../../icons/success.js";
import { UploadIcon } from "../../icons/upload.js";
import type { Attrs } from "../../internal/props.js";
import { clientEffect } from "../../internal/overlay.js";
import { useUiConfig } from "../../theme/config.js";
import { Field } from "../../form/field/field.js";
import {
  type ControlSize,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../../form/internal/control.js";
import type {
  FileUploadItem,
  FileUploadProps,
  FileUploadRejection,
  FileUploadResult,
  FileUploadStatus,
} from "./types.js";

export type {
  FileUploadContext,
  FileUploadHandler,
  FileUploadItem,
  FileUploadProps,
  FileUploadRejection,
  FileUploadRejectionReason,
  FileUploadResult,
  FileUploadStatus,
  FileUploadVariant,
} from "./types.js";
export { createXhrUpload, type XhrUploadOptions } from "./xhr.js";

const SIZE_UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"] as const;

/** Человекочитаемый размер файла. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${SIZE_UNITS[0]}`;
  const power = Math.min(
    SIZE_UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** power;
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: value >= 10 || power === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${SIZE_UNITS[power]}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "FILE";
  return name.slice(dot + 1).toUpperCase().slice(0, 5);
}

/** Совпадение файла с `accept`: MIME, `image/*` или расширение `.pdf`. */
export function matchesAccept(file: File, accept: string | undefined): boolean {
  const raw = accept?.trim() ?? "";
  if (raw === "") return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== "")
    .some((token) => {
      if (token.startsWith(".")) return name.endsWith(token);
      if (token.endsWith("/*")) {
        return type.startsWith(token.slice(0, token.length - 1));
      }
      return type === token;
    });
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  return "Не удалось загрузить файл";
}

let idCounter = 0;

function createItemId(): string {
  const cryptoApi = globalThis.crypto;
  if (
    cryptoApi !== undefined
    && typeof cryptoApi.randomUUID === "function"
  ) {
    return cryptoApi.randomUUID();
  }
  idCounter += 1;
  return `file-upload-${String(Date.now())}-${String(idCounter)}`;
}

function itemSignature(items: readonly FileUploadItem[] | undefined): string {
  if (items === undefined) return "";
  return items
    .map((item) =>
      [
        item.id,
        item.name,
        item.size,
        item.status,
        item.progress,
        item.error ?? "",
        item.url ?? "",
        item.previewUrl ?? "",
      ].join(":"),
    )
    .join("|");
}

function normalizeInitial(
  items: readonly FileUploadItem[] | undefined,
): readonly FileUploadItem[] {
  return items === undefined ? [] : [...items];
}

function previewFor(file: File, owned: Set<string>): string | undefined {
  if (!file.type.startsWith("image/")) return undefined;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return undefined;
  }
  const url = URL.createObjectURL(file);
  owned.add(url);
  return url;
}

function statusText(item: FileUploadItem): string {
  if (item.status === "queued") return "Ожидает загрузки";
  if (item.status === "uploading") return `${Math.round(item.progress)}%`;
  if (item.status === "success") return "Загружено";
  if (item.status === "cancelled") return "Отменено";
  return item.error ?? "Ошибка";
}

/**
 * Загрузка файлов: drag&drop и выбор, лимиты, прогресс и отмена.
 *
 * `upload` получает файл и `{ onProgress, signal }`: прогресс в процентах,
 * `signal` отменяется кнопкой «Отменить» или размонтированием. Для загрузки
 * с прогрессом без зависимостей есть `createXhrUpload` на `XMLHttpRequest`.
 */
export function FileUpload(props: FileUploadProps): Node {
  const config = useUiConfig();
  const id = resolveControlId(
    props.id,
    props.name,
    "file-upload",
  );
  const multiple = (): boolean => props.multiple === true;
  const disabled = (): boolean => props.disabled === true;
  const readOnly = (): boolean => props.readOnly === true;
  const interactive = (): boolean => !disabled() && !readOnly();

  const labelOf = (): Children => props.label;
  const hintOf = (): Children => props.hint;
  const errorOf = (): Children => props.error;
  const requiredOf = (): boolean => props.required === true;
  const invalidOf = (): boolean => hasContent(errorOf());
  const described = (): string | undefined =>
    describedBy(
      hasContent(hintOf()) ? hintIdFor(id) : undefined,
      hasContent(errorOf()) ? errorIdFor(id) : undefined,
    );

  const [items, setItems] = createSignal<readonly FileUploadItem[]>(
    normalizeInitial(props.files ?? props.defaultFiles),
  );
  const [dragging, setDragging] = createSignal(false);
  const [rejections, setRejections] = createSignal<
    readonly FileUploadRejection[]
  >([]);
  const ownedUrls = new Set<string>();
  const controllers = new Map<string, AbortController>();
  let lastExternal = itemSignature(props.files);
  let inputElement: HTMLInputElement | null = null;

  const commit = (next: readonly FileUploadItem[]): void => {
    setItems(next);
    lastExternal = itemSignature(next);
    props.onFilesChange?.(next);
  };

  clientEffect(() => {
    const external = props.files;
    if (external === undefined) return;
    const signature = itemSignature(external);
    if (signature === lastExternal) return;
    lastExternal = signature;
    setItems(external);
  });

  const updateItem = (
    itemId: string,
    patch: Partial<FileUploadItem>,
  ): void => {
    const current = items();
    if (!current.some((item) => item.id === itemId)) return;
    commit(
      current.map((item) =>
        item.id === itemId ? { ...item, ...patch } : item,
      ),
    );
  };

  const revokePreview = (item: FileUploadItem): void => {
    const url = item.previewUrl;
    if (url === undefined || !ownedUrls.has(url)) return;
    ownedUrls.delete(url);
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
    }
  };

  const startUpload = (itemId: string): void => {
    const handler = props.upload;
    if (handler === undefined || disabled() || readOnly()) return;
    const item = items().find((entry) => entry.id === itemId);
    if (item === undefined || item.file === undefined) return;
    controllers.get(itemId)?.abort();
    const controller = new AbortController();
    controllers.set(itemId, controller);
    updateItem(itemId, {
      status: "uploading",
      progress: 0,
      error: undefined,
    });
    void handler(item.file, {
      onProgress: (percent) => {
        if (controller.signal.aborted) return;
        const progress = Math.round(Math.min(100, Math.max(0, percent)));
        updateItem(itemId, { status: "uploading", progress });
      },
      signal: controller.signal,
    })
      .then((result: FileUploadResult) => {
        if (controller.signal.aborted) return;
        updateItem(itemId, {
          status: "success",
          progress: 100,
          url: result.url ?? item.url,
          response: result,
          error: undefined,
        });
      })
      .catch((error: unknown) => {
        const aborted =
          controller.signal.aborted
          || (error instanceof DOMException && error.name === "AbortError");
        if (aborted) {
          updateItem(itemId, {
            status: "cancelled",
            error: "Загрузка отменена",
          });
          return;
        }
        updateItem(itemId, { status: "error", error: messageOf(error) });
        if (item.file !== undefined) {
          props.onUploadError?.(error, item.file);
        }
      })
      .finally(() => {
        if (controllers.get(itemId) === controller) {
          controllers.delete(itemId);
        }
      });
  };

  const validateFile = (
    file: File,
    current: readonly FileUploadItem[],
    accepted: readonly FileUploadItem[],
  ): FileUploadRejection | FileUploadItem => {
    if (!multiple() && (current.length > 0 || accepted.length > 0)) {
      return {
        file,
        reason: "max-files",
        message: "Можно выбрать только один файл",
      };
    }
    const maxFiles = multiple() ? props.maxFiles : 1;
    if (
      maxFiles !== undefined
      && maxFiles > 0
      && current.length + accepted.length >= maxFiles
    ) {
      return {
        file,
        reason: "max-files",
        message: `Можно выбрать не более ${String(maxFiles)} файлов`,
      };
    }
    if (!matchesAccept(file, props.accept)) {
      return {
        file,
        reason: "accept",
        message: `Недопустимый тип файла: ${file.name}`,
      };
    }
    if (props.maxSize !== undefined && props.maxSize > 0 && file.size > props.maxSize) {
      return {
        file,
        reason: "max-size",
        message: `Файл «${file.name}» больше ${formatFileSize(props.maxSize)}`,
      };
    }
    const duplicate = [...current, ...accepted].some(
      (item) =>
        item.name === file.name
        && item.size === file.size
        && item.file?.lastModified === file.lastModified,
    );
    if (duplicate) {
      return {
        file,
        reason: "duplicate",
        message: `Файл «${file.name}» уже добавлен`,
      };
    }
    return {
      id: createItemId(),
      name: file.name,
      size: file.size,
      type: file.type,
      status: "queued",
      progress: 0,
      file,
      previewUrl: previewFor(file, ownedUrls),
    };
  };

  const addFiles = (files: readonly File[]): void => {
    if (!interactive() || files.length === 0) return;
    const current = multiple() ? items() : [];
    if (!multiple()) {
      for (const item of items()) {
        const controller = controllers.get(item.id);
        controller?.abort();
        controllers.delete(item.id);
        revokePreview(item);
      }
    }
    const accepted: FileUploadItem[] = [];
    const rejected: FileUploadRejection[] = [];
    for (const file of files) {
      const result = validateFile(file, current, accepted);
      if ("reason" in result) {
        rejected.push(result);
        if (!multiple()) break;
      } else {
        accepted.push(result);
        if (!multiple()) break;
      }
    }
    setRejections(rejected);
    if (rejected.length > 0) props.onReject?.(rejected);
    if (accepted.length > 0) {
      commit([...current, ...accepted]);
      if (props.autoUpload !== false) {
        for (const item of accepted) startUpload(item.id);
      }
    }
    if (inputElement !== null) inputElement.value = "";
  };

  const cancelItem = (itemId: string): void => {
    if (!interactive()) return;
    const controller = controllers.get(itemId);
    if (controller === undefined) {
      updateItem(itemId, { status: "cancelled", error: "Загрузка отменена" });
      return;
    }
    controller.abort();
    controllers.delete(itemId);
    updateItem(itemId, { status: "cancelled", error: "Загрузка отменена" });
  };

  const retryItem = (itemId: string): void => {
    if (!interactive()) return;
    updateItem(itemId, { status: "queued", progress: 0, error: undefined });
    startUpload(itemId);
  };

  const removeItem = (itemId: string): void => {
    if (!interactive()) return;
    const item = items().find((entry) => entry.id === itemId);
    controllers.get(itemId)?.abort();
    controllers.delete(itemId);
    if (item !== undefined) revokePreview(item);
    commit(items().filter((entry) => entry.id !== itemId));
  };

  onCleanup(() => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    for (const url of ownedUrls) {
      if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(url);
      }
    }
    ownedUrls.clear();
  });

  const limits = (): string => {
    const parts: string[] = [];
    if (props.accept !== undefined && props.accept.trim() !== "") {
      parts.push(props.accept);
    }
    if (props.maxSize !== undefined && props.maxSize > 0) {
      parts.push(`до ${formatFileSize(props.maxSize)}`);
    }
    if (multiple() && props.maxFiles !== undefined && props.maxFiles > 0) {
      parts.push(`до ${String(props.maxFiles)} файлов`);
    }
    return parts.join(" · ");
  };

  const dropLabel = (): string =>
    props.dropLabel ?? "Перетащите файлы сюда или нажмите";

  const statusIcon = (item: FileUploadItem): Node | null => {
    if (item.status === "success") {
      return <SuccessIcon size="sm" title="Загружено" />;
    }
    if (item.status === "error" || item.status === "cancelled") {
      return <ErrorIcon size="sm" title="Ошибка" />;
    }
    return null;
  };

  return (
    <Field
      id={id}
      htmlFor={id}
      label={labelOf()}
      hint={hintOf()}
      error={errorOf()}
      required={requiredOf()}
      invalid={invalidOf()}
      disabled={disabled()}
      class={props.class}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        class="sui-file-upload"
        data-variant={props.variant ?? "zone"}
        data-size={props.size ?? "md"}
        data-invalid={invalidOf() ? "" : undefined}
        data-disabled={disabled() ? "" : undefined}
        data-readonly={readOnly() ? "" : undefined}
        data-dragging={dragging() ? "" : undefined}
        data-has-files={items().length > 0 ? "" : undefined}
      >
        <input
          ref={(node: Element | null) => {
            if (node instanceof HTMLInputElement) inputElement = node;
          }}
          id={id}
          class="sui-file-upload__input"
          type="file"
          name={props.name ?? id}
          accept={props.accept}
          multiple={multiple()}
          disabled={disabled() || readOnly()}
          required={requiredOf()}
          aria-required={requiredOf() ? "true" : undefined}
          aria-invalid={invalidOf() ? "true" : undefined}
          aria-describedby={described()}
          onChange={(event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLInputElement)) return;
            const files = target.files === null ? [] : Array.from(target.files);
            addFiles(files);
          }}
          onBlur={(event) => {
            props.onBlur?.(event);
          }}
          onFocus={(event) => {
            props.onFocus?.(event);
          }}
        />
        <button
          type="button"
          class="sui-file-upload__zone"
          disabled={!interactive()}
          aria-describedby={described()}
          aria-invalid={invalidOf() ? "true" : undefined}
          onClick={() => {
            inputElement?.click();
          }}
          onDragOver={(event: DragEvent) => {
            if (!interactive()) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            setDragging(false);
            const transfer = event.dataTransfer;
            const files =
              transfer === null ? [] : Array.from(transfer.files);
            addFiles(files);
          }}
        >
          <span class="sui-file-upload__zone-icon" aria-hidden="true">
            <UploadIcon size="lg" />
          </span>
          <span class="sui-file-upload__zone-text">
            <span class="sui-file-upload__zone-title">
              {props.chooseLabel ?? config.strings.chooseFile}
            </span>
            <span class="sui-file-upload__zone-hint">{dropLabel()}</span>
            <Show when={limits() !== ""}>
              <span class="sui-file-upload__zone-limits">{limits()}</span>
            </Show>
          </span>
        </button>

        <Show when={rejections().length > 0}>
          <ul class="sui-file-upload__rejections" role="alert">
            <For each={rejections()} keyOf={(item) => `${item.file.name}:${item.reason}`}>
              {(rejection) => (
                <li class="sui-file-upload__rejection" data-reason={rejection.reason}>
                  {rejection.message}
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={items().length > 0}>
          <ul
            class="sui-file-upload__list"
            aria-label={props.listLabel ?? "Выбранные файлы"}
          >
            <For each={items()} keyOf={(item) => item.id}>
              {(item) => (
                <li class="sui-file-upload__item" data-status={item.status}>
                  <span class="sui-file-upload__preview" aria-hidden="true">
                    <Show
                      when={
                        props.showPreview !== false && item.previewUrl !== undefined
                      }
                      fallback={
                        <span class="sui-file-upload__ext">
                          {extensionOf(item.name)}
                        </span>
                      }
                    >
                      <img
                        class="sui-file-upload__image"
                        src={item.previewUrl ?? ""}
                        alt=""
                        loading="lazy"
                      />
                    </Show>
                  </span>
                  <span class="sui-file-upload__info">
                    <span class="sui-file-upload__name" title={item.name}>
                      {item.name}
                    </span>
                    <span class="sui-file-upload__meta">
                      {formatFileSize(item.size)}
                      {item.type === "" ? "" : ` · ${item.type}`}
                    </span>
                    <Show when={item.status === "uploading"}>
                      <progress
                        class="sui-file-upload__progress"
                        value={item.progress}
                        max={100}
                        aria-label={`${item.name}: ${String(Math.round(item.progress))}%`}
                      />
                    </Show>
                    <span
                      class="sui-file-upload__status"
                      data-status={item.status}
                      aria-live="polite"
                    >
                      {statusIcon(item)}
                      <span>{statusText(item)}</span>
                    </span>
                  </span>
                  <span class="sui-file-upload__actions">
                    <Show when={item.status === "uploading"}>
                      <button
                        type="button"
                        class="sui-file-upload__action"
                        disabled={!interactive()}
                        aria-label={`Отменить загрузку: ${item.name}`}
                        title="Отменить"
                        onClick={() => {
                          cancelItem(item.id);
                        }}
                      >
                        <CloseIcon size="sm" />
                      </button>
                    </Show>
                    <Show when={item.status === "error" || item.status === "cancelled"}>
                      <button
                        type="button"
                        class="sui-file-upload__action"
                        disabled={!interactive() || item.file === undefined}
                        aria-label={`Повторить загрузку: ${item.name}`}
                        title="Повторить"
                        onClick={() => {
                          retryItem(item.id);
                        }}
                      >
                        <RefreshIcon size="sm" />
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="sui-file-upload__action"
                      disabled={!interactive()}
                      aria-label={`${config.strings.removeItem}: ${item.name}`}
                      title={config.strings.removeItem}
                      onClick={() => {
                        removeItem(item.id);
                      }}
                    >
                      <CloseIcon size="sm" />
                    </button>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Field>
  );
}

export type { ControlSize };
