import { getCenter, getClientRect } from "../core/geometry.js";
import type { ClientRect, Coordinates } from "../core/types.js";
import { collectScrollableAncestors } from "./dom.js";
import {
  AutoScrollActivator,
  type AutoScrollOptions,
} from "./types.js";

export interface AutoScrollContext {
  readonly getActiveNode: () => HTMLElement | null;
  readonly getPointer: () => Coordinates | null;
  readonly getActiveRect: () => ClientRect | null;
  readonly getOptions: () => boolean | AutoScrollOptions | undefined;
}

export interface AutoScrollHandle {
  start(): void;
  stop(): void;
  dispose(): void;
}

const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_ACCELERATION = 10;

function normalizeOptions(
  value: boolean | AutoScrollOptions | undefined,
): Required<Pick<AutoScrollOptions, "enabled" | "activator" | "threshold" | "acceleration">> {
  if (value === false) {
    return {
      enabled: false,
      activator: AutoScrollActivator.Pointer,
      threshold: DEFAULT_THRESHOLD,
      acceleration: DEFAULT_ACCELERATION,
    };
  }
  const options = value === true || value === undefined ? {} : value;
  return {
    enabled: options.enabled !== false,
    activator: options.activator ?? AutoScrollActivator.Pointer,
    threshold: options.threshold ?? DEFAULT_THRESHOLD,
    acceleration: options.acceleration ?? DEFAULT_ACCELERATION,
  };
}

interface ScrollTarget {
  readonly element: Element;
  readonly rect: ClientRect;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly maxTop: number;
  readonly maxLeft: number;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function scaleOf(element: Element): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : (element.clientWidth || 0),
    height: rect.height > 0 ? rect.height : (element.clientHeight || 0),
  };
}

function collectTargets(node: HTMLElement | null): ScrollTarget[] {
  if (node === null) {
    return [];
  }
  const result: ScrollTarget[] = [];
  for (const element of collectScrollableAncestors(node)) {
    const target = element as Element & {
      scrollTop?: number;
      scrollLeft?: number;
      scrollHeight?: number;
      scrollWidth?: number;
      clientHeight?: number;
      clientWidth?: number;
    };
    const maxTop = readNumber(target.scrollHeight) - readNumber(target.clientHeight);
    const maxLeft = readNumber(target.scrollWidth) - readNumber(target.clientWidth);
    if (maxTop <= 0 && maxLeft <= 0) {
      continue;
    }
    const rect = element === document.scrollingElement
      ? viewportRect()
      : element.getBoundingClientRect();
    result.push({
      element,
      rect,
      scrollTop: readNumber(target.scrollTop),
      scrollLeft: readNumber(target.scrollLeft),
      maxTop: Math.max(0, maxTop),
      maxLeft: Math.max(0, maxLeft),
    });
  }
  return result;
}

function viewportRect(): ClientRect {
  return getClientRect({
    top: 0,
    left: 0,
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  });
}

function axisSpeed(
  position: number,
  start: number,
  end: number,
  thresholdRatio: number,
  acceleration: number,
): number {
  const size = end - start;
  if (size <= 0) {
    return 0;
  }
  const zone = Math.max(1, Math.min(size * thresholdRatio, size / 2));
  if (position < start + zone) {
    const strength = (start + zone - position) / zone;
    return -Math.min(1, Math.max(0, strength)) * acceleration;
  }
  if (position > end - zone) {
    const strength = (position - (end - zone)) / zone;
    return Math.min(1, Math.max(0, strength)) * acceleration;
  }
  return 0;
}

/**
 * rAF-цикл автоскролла для прокручиваемых предков активного узла.
 *
 * Ручного `requestAnimationFrame` в тестах достаточно: цикл не опирается на
 * таймеры и полностью останавливается через `stop()`/`onCleanup`.
 */
export function createAutoScroll(context: AutoScrollContext): AutoScrollHandle {
  let frame: number | null = null;
  let running = false;
  let disposed = false;

  const stop = (): void => {
    running = false;
    if (frame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frame);
    }
    frame = null;
  };

  const scrollStep = (): void => {
    if (disposed) {
      return;
    }
    const options = normalizeOptions(context.getOptions());
    if (!options.enabled) {
      return;
    }
    const activeRect = context.getActiveRect();
    const pointer = context.getPointer();
    const point = options.activator === AutoScrollActivator.Pointer
      ? pointer
      : activeRect === null
        ? pointer
        : getCenter(activeRect);
    if (point === null) {
      return;
    }
    for (const target of collectTargets(context.getActiveNode())) {
      const vertical = axisSpeed(
        point.y,
        target.rect.top,
        target.rect.bottom,
        options.threshold,
        options.acceleration,
      );
      const horizontal = axisSpeed(
        point.x,
        target.rect.left,
        target.rect.right,
        options.threshold,
        options.acceleration,
      );
      if (vertical === 0 && horizontal === 0) {
        continue;
      }
      const nextTop = Math.min(
        target.maxTop,
        Math.max(0, target.scrollTop + vertical),
      );
      const nextLeft = Math.min(
        target.maxLeft,
        Math.max(0, target.scrollLeft + horizontal),
      );
      const scrollTarget = target.element as Element & {
        scrollTop?: number;
        scrollLeft?: number;
      };
      if (vertical !== 0) {
        scrollTarget.scrollTop = nextTop;
      }
      if (horizontal !== 0) {
        scrollTarget.scrollLeft = nextLeft;
      }
    }
  };

  const tick = (): void => {
    frame = null;
    if (!running || disposed) {
      return;
    }
    scrollStep();
    if (!running || disposed) {
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(tick);
    } else {
      running = false;
    }
  };

  return {
    start(): void {
      if (running || disposed) {
        return;
      }
      const options = normalizeOptions(context.getOptions());
      if (!options.enabled) {
        return;
      }
      running = true;
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(tick);
      } else {
        // Без rAF остаётся синхронный шаг: SSR/тестовые окружения без кадров
        // всё равно получают предсказуемое поведение.
        scrollStep();
        running = false;
      }
    },
    stop,
    dispose(): void {
      disposed = true;
      stop();
    },
  };
}
