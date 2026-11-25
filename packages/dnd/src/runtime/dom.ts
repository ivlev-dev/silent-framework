import { createEffect, onCleanup } from "@ivlev-dev/silent-reactivity";
import { isServerMode } from "@ivlev-dev/silent-core";
import { getClientRect } from "../core/geometry.js";
import type { ClientRect } from "../core/types.js";

/**
 * Эффект, который выполняется только на клиенте.
 *
 * На сервере DOM-наблюдатели и измерения бессмысленны, а побочные эффекты
 * запрещены; при гидрации эффект запускается обычным путём.
 */
export function clientEffect(fn: () => void): void {
  if (isServerMode()) {
    return;
  }
  createEffect(fn);
}

/** Измеряет элемент в координатах viewport; версия без измерения — `null`. */
export function measureElement(element: Element | null): ClientRect | null {
  if (element === null) {
    return null;
  }
  const measure = (element as { getBoundingClientRect?: unknown })
    .getBoundingClientRect;
  if (typeof measure !== "function") {
    return null;
  }
  const rect = (
    measure as () => {
      top: number;
      left: number;
      width: number;
      height: number;
    }
  ).call(element);
  if (
    rect === null
    || typeof rect !== "object"
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.left)
  ) {
    return null;
  }
  return getClientRect({
    top: rect.top,
    left: rect.left,
    width: Number.isFinite(rect.width) ? rect.width : 0,
    height: Number.isFinite(rect.height) ? rect.height : 0,
  });
}

/** Прямоугольник viewport; на сервере/без окна возвращает `null`. */
export function getWindowRect(): ClientRect | null {
  if (typeof window === "undefined") {
    return null;
  }
  const width = Number.isFinite(window.innerWidth) ? window.innerWidth : 0;
  const height = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
  return getClientRect({ top: 0, left: 0, width, height });
}

const SCROLLABLE_OVERFLOW = /(auto|scroll|overlay)/u;

/** Проверяет, что элемент действительно может прокручиваться. */
export function isScrollableElement(element: Element): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const target = element as {
    scrollHeight?: unknown;
    clientHeight?: unknown;
    scrollWidth?: unknown;
    clientWidth?: unknown;
  };
  const scrollHeight = typeof target.scrollHeight === "number" ? target.scrollHeight : 0;
  const clientHeight = typeof target.clientHeight === "number" ? target.clientHeight : 0;
  const scrollWidth = typeof target.scrollWidth === "number" ? target.scrollWidth : 0;
  const clientWidth = typeof target.clientWidth === "number" ? target.clientWidth : 0;
  const hasOverflow = scrollHeight > clientHeight || scrollWidth > clientWidth;
  if (!hasOverflow) {
    return false;
  }
  const style = typeof window.getComputedStyle === "function"
    ? window.getComputedStyle(element)
    : null;
  if (style === null) {
    return true;
  }
  return SCROLLABLE_OVERFLOW.test(style.overflowY) || SCROLLABLE_OVERFLOW.test(style.overflowX);
}

/** Ближайший (включая сам элемент) прокручиваемый предок. */
export function findScrollableAncestor(element: Element | null): Element | null {
  let current: Element | null = element;
  while (current !== null) {
    if (current === document.documentElement || current === document.body) {
      return document.scrollingElement ?? current;
    }
    if (isScrollableElement(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/** Все прокручиваемые предки от элемента до `document`. */
export function collectScrollableAncestors(element: Element | null): Element[] {
  const result: Element[] = [];
  let current: Element | null = element;
  while (current !== null) {
    if (isScrollableElement(current)) {
      result.push(current);
    }
    current = current.parentElement;
  }
  if (typeof document !== "undefined") {
    const root = document.scrollingElement ?? document.documentElement;
    if (root !== null && root !== undefined && !result.includes(root)) {
      result.push(root);
    }
  }
  return result;
}

function hasScrollableOverflow(style: CSSStyleDeclaration | null): boolean {
  if (style === null) {
    return false;
  }
  return (
    SCROLLABLE_OVERFLOW.test(style.overflowX)
    || SCROLLABLE_OVERFLOW.test(style.overflowY)
  );
}

/**
 * Прокручиваемые предки узла, от ближайшего к дальнему.
 *
 * Учитывается CSS `overflow` со значениями `auto`/`scroll`/`overlay` (сам узел
 * тоже включается, если прокручивается). Последним в массиве идёт
 * `document.scrollingElement`, поэтому результат пригоден для авто-скролла и
 * ограничения transform. Дубли исключены; на сервере возвращается пустой
 * массив. В отличие от {@link collectScrollableAncestors} проверяется только
 * стиль, без фактических размеров прокрутки — как в dnd-kit.
 */
export function getScrollableAncestors(element: Element | null): Element[] {
  if (
    element === null
    || typeof window === "undefined"
    || typeof document === "undefined"
  ) {
    return [];
  }

  const result: Element[] = [];
  const seen = new Set<Element>();
  const push = (node: Element): void => {
    if (!seen.has(node)) {
      seen.add(node);
      result.push(node);
    }
  };
  const root: Element = document.scrollingElement ?? document.documentElement;

  let current: Element | null = element;
  while (current !== null) {
    if (current === document.documentElement || current === document.body) {
      push(root);
      return result;
    }
    const style = typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(current)
      : null;
    if (hasScrollableOverflow(style)) {
      push(current);
    }
    const parent: Element | null = current.parentElement;
    if (parent === null) {
      if (element.isConnected) {
        push(root);
      }
      return result;
    }
    current = parent;
  }

  return result;
}

/**
 * Регистрирует очистку через `onCleanup` и возвращает идемпотентную функцию.
 * Нужно для случаев, когда ресурс освобождают и вручную, и при размонтировании.
 */
export function once(fn: () => void): () => void {
  let done = false;
  const run = (): void => {
    if (done) {
      return;
    }
    done = true;
    fn();
  };
  onCleanup(run);
  return run;
}

/** Безопасно приводит значение к `Data`. */
export function asData(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
