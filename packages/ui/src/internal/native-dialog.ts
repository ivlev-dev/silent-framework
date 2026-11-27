import { createSignal, onCleanup } from "@ivlev-dev/silent-core";
import {
  clientEffect,
  focusFirst,
  trapTab,
  useFocusRestore,
  useModalLayer,
} from "./overlay.js";

/**
 * Состояние и поведение нативного `<dialog>`: controlled/uncontrolled `open`,
 * `showModal()` после монтирования, fallback на `open` + focus trap, если
 * платформа не умеет `showModal()` (jsdom, старые WebView).
 */
export interface NativeDialogOptions {
  readonly open: () => boolean | undefined;
  readonly defaultOpen: () => boolean;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /** Селектор панели внутри `<dialog>` для автофокуса. */
  readonly panelSelector: string;
  /** Escape/нативная отмена: вызывается до закрытия. */
  readonly onCancel?: (() => void) | undefined;
}

export interface NativeDialogBinding {
  /** Текущее состояние: controlled prop имеет приоритет. */
  isOpen(): boolean;
  /** Платформа без `showModal()`: включён fallback-режим. */
  fallback(): boolean;
  /** Запрос открытия/закрытия: обновляет uncontrolled и зовёт callback. */
  requestOpen(open: boolean): void;
  /** Ref-колбэк корневого `<dialog>`. */
  setRoot(node: HTMLDialogElement | null): void;
  /** Escape: в fallback закрываем сами, нативно — через `cancel`. */
  handleKeyDown(event: KeyboardEvent): void;
  /** Клик по backdrop (target === dialog). */
  handleBackdrop(event: MouseEvent, closeOnBackdrop: boolean): void;
  /** Корневой `<dialog>`. */
  root(): HTMLDialogElement | null;
}

export function bindNativeDialog(options: NativeDialogOptions): NativeDialogBinding {
  const [uncontrolled, setUncontrolled] = createSignal(options.defaultOpen());
  const [root, setRoot] = createSignal<HTMLDialogElement | null>(null);
  const [fallback, setFallback] = createSignal(false);

  const isOpen = (): boolean => {
    const explicit = options.open();
    return explicit === undefined ? uncontrolled() : explicit;
  };

  const requestOpen = (next: boolean): void => {
    if (isOpen() === next) return;
    if (options.open() === undefined) setUncontrolled(next);
    options.onOpenChange?.(next);
  };

  const handleNativeClose = (): void => {
    if (!isOpen()) return;
    if (options.open() === undefined) setUncontrolled(false);
    options.onOpenChange?.(false);
  };

  // Сохранение фокуса создаётся ДО showModal(): браузер сам переводит фокус
  // в диалог, и активный элемент нужно запомнить раньше.
  useFocusRestore(isOpen);

  // Открытие/закрытие нативного диалога. SSR рендерит атрибут `open` сам.
  clientEffect(() => {
    const element = root();
    if (element === null) return;
    if (isOpen()) {
      if (typeof element.showModal === "function") {
        let alreadyModal = false;
        try {
          alreadyModal = element.matches(":modal");
        } catch {
          alreadyModal = false;
        }
        if (!alreadyModal) {
          try {
            // SSR-разметка содержит `open`: убираем его, иначе showModal()
            // бросит InvalidStateError на уже открытом диалоге.
            element.removeAttribute("open");
            element.showModal();
            setFallback(false);
          } catch {
            setFallback(true);
            element.setAttribute("open", "");
          }
        }
      } else {
        setFallback(true);
        element.setAttribute("open", "");
      }
      return;
    }
    if (typeof element.close === "function") {
      try {
        // Рендер снимает атрибут `open` раньше эффекта, а close() на диалоге
        // без `open` выходит сразу и оставляет его в top layer (`:modal`).
        // Возвращаем атрибут, чтобы close() реально вывел диалог из top layer.
        if (!element.open) element.setAttribute("open", "");
        element.close();
      } catch {
        element.removeAttribute("open");
      }
    } else {
      element.removeAttribute("open");
    }
    setFallback(false);
  });

  useModalLayer(root, isOpen);

  // Автофокус при открытии, если фокус ещё не внутри диалога.
  clientEffect(() => {
    if (!isOpen()) return;
    const element = root();
    if (element === null) return;
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (active !== null && element.contains(active)) return;
    const panel = element.querySelector<HTMLElement>(options.panelSelector);
    if (panel !== null) {
      focusFirst(panel);
    } else {
      element.focus({ preventScroll: true });
    }
  });

  // `cancel`/`close` не входят в список известных JSX-событий — нативно.
  clientEffect(() => {
    const element = root();
    if (element === null) return;
    const onCancel = (event: Event): void => {
      event.preventDefault();
      options.onCancel?.();
      requestOpen(false);
    };
    const onClose = (): void => {
      handleNativeClose();
    };
    element.addEventListener("cancel", onCancel);
    element.addEventListener("close", onClose);
    onCleanup(() => {
      element.removeEventListener("cancel", onCancel);
      element.removeEventListener("close", onClose);
    });
  });

  return {
    isOpen,
    fallback,
    requestOpen,
    setRoot,
    root,
    handleKeyDown(event: KeyboardEvent): void {
      const element = root();
      if (element === null) return;
      if (event.key === "Escape") {
        // Нативный dialog сам присылает `cancel`; дублируем только fallback.
        if (fallback()) {
          event.preventDefault();
          options.onCancel?.();
          requestOpen(false);
        }
        return;
      }
      if (event.key === "Tab") trapTab(element, event);
    },
    handleBackdrop(event: MouseEvent, closeOnBackdrop: boolean): void {
      if (!closeOnBackdrop) return;
      const element = root();
      if (element === null) return;
      if (event.target !== element) return;
      event.preventDefault();
      requestOpen(false);
    },
  };
}
