import { createEffect, createRoot } from "@ivlev-dev/silent-reactivity";
import type { Form } from "./form.js";

/** Подписка на изменения `isDirty`. Возвращает функцию остановки. */
export function onDirtyChange(
  form: Form,
  listener: (dirty: boolean) => void,
): () => void {
  let previous: boolean | undefined;
  const dispose = createRoot((disposeRoot) => {
    createEffect(() => {
      const dirty = form.isDirty;
      if (previous === dirty) {
        return;
      }
      previous = dirty;
      listener(dirty);
    });
    return disposeRoot;
  });
  return dispose;
}

export interface DirtyGuard {
  readonly isDirty: boolean;
  canLeave(): boolean;
  dispose(): void;
}

/**
 * Guard без DOM для роутера: `canLeave()` возвращает `!isDirty`.
 * `message` зарезервирован для будущих интеграций и не используется.
 */
export function createDirtyGuard(
  form: Form,
  options?: { readonly message?: string },
): DirtyGuard {
  void options?.message;
  let dirty = form.isDirty;
  let disposed = false;
  const stop = onDirtyChange(form, (next) => {
    dirty = next;
  });
  return {
    get isDirty() {
      return dirty;
    },
    canLeave() {
      return !dirty;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stop();
    },
  };
}

/**
 * `beforeunload`-защита только пока форма dirty. SSR-safe:
 * без `window` слушатель не устанавливается.
 */
export function beforeUnloadGuard(
  form: Form,
  options?: { readonly message?: string },
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const message = options?.message ?? "Есть несохранённые изменения";
  let attached = false;
  const handler = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
    event.returnValue = message;
  };
  const detach = (): void => {
    if (!attached) {
      return;
    }
    attached = false;
    window.removeEventListener("beforeunload", handler);
  };
  const dispose = createRoot((disposeRoot) => {
    createEffect(() => {
      if (form.isDirty) {
        if (!attached) {
          attached = true;
          window.addEventListener("beforeunload", handler);
        }
        return;
      }
      detach();
    });
    return disposeRoot;
  });
  return () => {
    detach();
    dispose();
  };
}
