import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "@ivlev-dev/silent-core";
import {
  FileUpload,
  createXhrUpload,
  formatFileSize,
  matchesAccept,
  type FileUploadContext,
  type FileUploadItem,
  type FileUploadRejection,
  type FileUploadResult,
} from "../src/components/file-upload/index.js";
import {
  mount,
  query,
  rootOf,
  type TestHandles,
} from "./form-test-utils.js";

const handles: TestHandles = { items: [] };

afterEach(() => {
  for (const handle of handles.items.splice(0)) handle.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function flush(): void {
  flushSync();
  flushSync();
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  flush();
}

function click(element: Element): void {
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  flush();
}

function selectFile(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  flush();
}

function fileInput(root: Element): HTMLInputElement {
  return query<HTMLInputElement>(root, 'input[type="file"]');
}

function itemsOf(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".sui-file-upload__item"));
}

describe("FileUpload: выбор и валидация", () => {
  it("drag&drop и input добавляют файлы, сообщают onFilesChange", () => {
    const changes: Array<readonly FileUploadItem[]> = [];
    const root = rootOf(
      mount(handles, FileUpload, {
        id: "files",
        multiple: true,
        accept: "image/*",
        onFilesChange: (items: readonly FileUploadItem[]) => changes.push(items),
      }),
    );
    const zone = query<HTMLElement>(root, ".sui-file-upload__zone");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    zone.dispatchEvent(event);
    flush();
    expect(changes.at(-1)?.map((item) => item.name)).toEqual(["a.png"]);
    expect(itemsOf(root)).toHaveLength(1);
    expect(root.textContent).toContain("Ожидает загрузки");

    selectFile(fileInput(root), [
      new File(["y"], "b.png", { type: "image/png" }),
    ]);
    expect(changes.at(-1)?.map((item) => item.name)).toEqual([
      "a.png",
      "b.png",
    ]);
    expect(itemsOf(root)).toHaveLength(2);
  });

  it("accept, maxSize и maxFiles отклоняют файлы с понятными сообщениями", () => {
    const rejected: string[] = [];
    const root = rootOf(
      mount(handles, FileUpload, {
        id: "files",
        multiple: true,
        accept: "image/*",
        maxSize: 10,
        maxFiles: 1,
        onReject: (list: readonly FileUploadRejection[]) =>
          rejected.push(...list.map((item) => item.reason)),
      }),
    );
    selectFile(fileInput(root), [
      new File(["x".repeat(20)], "big.png", { type: "image/png" }),
      new File(["x"], "note.txt", { type: "text/plain" }),
      new File(["x"], "a.png", { type: "image/png" }),
      new File(["x"], "b.png", { type: "image/png" }),
    ]);
    expect(itemsOf(root).map((item) => item.textContent)).toEqual([
      expect.stringContaining("a.png"),
    ]);
    expect(rejected).toEqual(["max-size", "accept", "max-files"]);
    const text = query<HTMLElement>(root, ".sui-file-upload__rejections").textContent ?? "";
    expect(text).toContain("больше");
    expect(text).toContain("Недопустимый тип");
    expect(text).toContain("не более 1");
  });

  it("одиночный режим заменяет предыдущий файл", () => {
    const root = rootOf(mount(handles, FileUpload, { id: "single" }));
    selectFile(fileInput(root), [
      new File(["a"], "first.txt", { type: "text/plain" }),
    ]);
    selectFile(fileInput(root), [
      new File(["b"], "second.txt", { type: "text/plain" }),
    ]);
    expect(itemsOf(root)).toHaveLength(1);
    expect(itemsOf(root)[0]?.textContent).toContain("second.txt");
  });
});

describe("FileUpload: загрузка", () => {
  it("прогресс и успешный результат обновляют статус", async () => {
    let context: FileUploadContext | undefined;
    let resolveUpload: ((result: FileUploadResult) => void) | undefined;
    const root = rootOf(
      mount(handles, FileUpload, {
        id: "files",
        upload: (file: File, uploadContext: FileUploadContext) =>
          new Promise<FileUploadResult>((resolve) => {
            expect(file.name).toBe("photo.png");
            context = uploadContext;
            resolveUpload = resolve;
          }),
      }),
    );
    selectFile(fileInput(root), [
      new File(["x"], "photo.png", { type: "image/png" }),
    ]);
    expect(root.querySelector(".sui-file-upload__item")?.getAttribute("data-status")).toBe(
      "uploading",
    );
    expect(context).toBeDefined();
    context?.onProgress(42);
    flush();
    const progress = query<HTMLProgressElement>(root, "progress");
    expect(progress.value).toBe(42);
    expect(root.textContent).toContain("42%");

    resolveUpload?.({ id: "m1", url: "/media/m1.png" });
    await settle();
    expect(root.querySelector(".sui-file-upload__item")?.getAttribute("data-status")).toBe(
      "success",
    );
    expect(root.textContent).toContain("Загружено");
  });

  it("отмена прерывает AbortSignal и показывает retry", () => {
    let signal: AbortSignal | undefined;
    const root = rootOf(
      mount(handles, FileUpload, {
        id: "files",
        upload: (_file: File, context: FileUploadContext) =>
          new Promise<FileUploadResult>((_resolve, reject) => {
            signal = context.signal;
            context.signal.addEventListener("abort", () => {
              reject(new DOMException("Отменено", "AbortError"));
            });
          }),
      }),
    );
    selectFile(fileInput(root), [
      new File(["x"], "cancel.txt", { type: "text/plain" }),
    ]);
    click(query<HTMLElement>(root, 'button[aria-label^="Отменить загрузку"]'));
    expect(signal?.aborted).toBe(true);
    expect(root.querySelector(".sui-file-upload__item")?.getAttribute("data-status")).toBe(
      "cancelled",
    );
    expect(root.querySelector('button[aria-label^="Повторить загрузку"]')).not.toBeNull();
  });

  it("retry повторно вызывает upload", async () => {
    let calls = 0;
    const root = rootOf(
      mount(handles, FileUpload, {
        id: "files",
        upload: async () => {
          calls += 1;
          if (calls === 1) throw new Error("Сбой сети");
          return { id: "m2", url: "/m2" };
        },
      }),
    );
    selectFile(fileInput(root), [
      new File(["x"], "retry.txt", { type: "text/plain" }),
    ]);
    await settle();
    expect(root.querySelector(".sui-file-upload__item")?.getAttribute("data-status")).toBe(
      "error",
    );
    expect(root.textContent).toContain("Сбой сети");
    click(query<HTMLElement>(root, 'button[aria-label^="Повторить загрузку"]'));
    await settle();
    expect(calls).toBe(2);
    expect(root.querySelector(".sui-file-upload__item")?.getAttribute("data-status")).toBe(
      "success",
    );
  });

  it("autoUpload=false оставляет файл в очереди", () => {
    const root = rootOf(
      mount(handles, FileUpload, {
        id: "files",
        autoUpload: false,
        upload: async () => ({ id: "x" }),
      }),
    );
    selectFile(fileInput(root), [
      new File(["x"], "queued.txt", { type: "text/plain" }),
    ]);
    expect(root.querySelector(".sui-file-upload__item")?.getAttribute("data-status")).toBe(
      "queued",
    );
  });
});

describe("FileUpload: утилиты", () => {
  it("formatFileSize и matchesAccept", () => {
    expect(formatFileSize(0)).toBe("0 Б");
    expect(formatFileSize(1536)).toBe("1,5 КБ");
    expect(matchesAccept(new File(["x"], "a.PDF", { type: "application/pdf" }), ".pdf")).toBe(true);
    expect(matchesAccept(new File(["x"], "a.png", { type: "image/png" }), "image/*")).toBe(true);
    expect(matchesAccept(new File(["x"], "a.txt", { type: "text/plain" }), "image/*")).toBe(false);
  });

  it("createXhrUpload передаёт прогресс и парсит ответ", async () => {
    class FakeTarget {
      private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

      addEventListener(type: string, listener: (event: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }

      emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    class FakeXhr {
      static readonly instances: FakeXhr[] = [];
      readonly upload = new FakeTarget();
      private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
      readonly headers: Array<[string, string]> = [];
      method = "";
      url = "";
      status = 200;
      statusText = "OK";
      response: unknown = null;
      withCredentials = false;
      responseType = "";
      body: FormData | null = null;

      constructor() {
        FakeXhr.instances.push(this);
      }

      open(method: string, url: string): void {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(name: string, value: string): void {
        this.headers.push([name, value]);
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }

      emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }

      send(body: FormData): void {
        this.body = body;
      }

      abort(): void {
        this.emit("abort", {});
      }
    }

    vi.stubGlobal("XMLHttpRequest", FakeXhr as unknown as typeof XMLHttpRequest);
    const progress: number[] = [];
    const handler = createXhrUpload("/api/upload", {
      headers: { "X-Token": "test" },
    });
    const promise = handler(
      new File(["x"], "photo.png", { type: "image/png" }),
      {
        onProgress: (percent) => progress.push(percent),
        signal: new AbortController().signal,
      },
    );
    const xhr = FakeXhr.instances[0];
    expect(xhr).toBeDefined();
    expect(xhr?.url).toBe("/api/upload");
    expect(xhr?.headers).toEqual([["X-Token", "test"]]);
    xhr?.upload.emit("progress", {
      lengthComputable: true,
      loaded: 25,
      total: 100,
    });
    expect(progress).toEqual([25]);

    xhr!.status = 201;
    xhr!.response = { id: "m3", url: "/m3.png" };
    xhr!.emit("load", {});
    await expect(promise).resolves.toEqual({ id: "m3", url: "/m3.png" });
  });
});
