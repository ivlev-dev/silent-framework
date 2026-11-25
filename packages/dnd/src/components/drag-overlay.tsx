import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Portal, Show, dynamic, normalizeStyle } from "@ivlev-dev/silent-core";
import { createSignal, onCleanup } from "@ivlev-dev/silent-reactivity";
import { CSS } from "../core/css.js";
import { clientEffect } from "../runtime/dom.js";
import { defaultDropAnimation } from "../runtime/drop-animation.js";
import { useDndContext } from "../runtime/context.js";
import type { Transform } from "../core/types.js";
import type {
  DropAnimation,
  DragOverlayProps,
  DragOverlaySource,
  DragResult,
} from "../runtime/types.js";

function resolveAnimation(
  option: DragOverlayProps["dropAnimation"],
  result: DragResult,
): DropAnimation | null {
  if (option === undefined) {
    return defaultDropAnimation;
  }
  if (option === null) {
    return null;
  }
  if (typeof option === "function") {
    return option({ active: result.active, over: result.over });
  }
  return option;
}

function resolveDropTransform(result: DragResult): Transform | null {
  const activeRect = result.active.rect;
  const overRect = result.over?.rect ?? null;
  if (activeRect === null || overRect === null) {
    return null;
  }
  return {
    x: overRect.left - activeRect.left,
    y: overRect.top - activeRect.top,
  };
}

interface DropState {
  readonly target: Transform | null;
  readonly duration: number;
  readonly easing: string;
}

function supportsWebAnimations(): boolean {
  return (
    typeof HTMLElement !== "undefined"
    && typeof HTMLElement.prototype.animate === "function"
  );
}

/**
 * «Летящая» копия перетаскиваемого элемента.
 *
 * Рендерится через `Portal` в `document.body`/`container`, не перехватывает
 * указатель и скрыта от скринридеров. На сервере `Show` остаётся закрытым,
 * поэтому оверлей в разметку не попадает.
 *
 * При завершении drag оверлей перемещается из позиции активного элемента в
 * прямоугольник цели (`over`) за `duration` с кривой `easing`. Если браузер не
 * поддерживает Web Animations API (например, jsdom), конечное состояние
 * применяется сразу, а оверлей удаляется по таймеру.
 */
export function DragOverlay(props: DragOverlayProps): Node {
  const controller = useDndContext();
  const [dropping, setDropping] = createSignal(false);
  const [dropState, setDropState] = createSignal<DropState | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastResult: DragResult | null = null;
  let overlayElement: HTMLElement | null = null;
  let overlayAnimation: Animation | null = null;
  let sideEffectCleanup: (() => void) | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const cancelOverlayAnimation = (): void => {
    if (overlayAnimation !== null) {
      overlayAnimation.cancel();
      overlayAnimation = null;
    }
  };

  const runSideEffectCleanup = (): void => {
    const cleanup = sideEffectCleanup;
    sideEffectCleanup = null;
    cleanup?.();
  };

  const finishDrop = (): void => {
    timer = null;
    cancelOverlayAnimation();
    runSideEffectCleanup();
    setDropping(false);
    setDropState(null);
    controller.hideOverlay();
  };

  clientEffect(() => {
    const result = controller.dragResult();
    if (result === null) {
      lastResult = null;
      return;
    }
    if (lastResult === result) {
      return;
    }
    lastResult = result;
    clearTimer();
    cancelOverlayAnimation();
    runSideEffectCleanup();
    setDropState(null);
    if (result.cancelled) {
      setDropping(false);
      return;
    }
    const animation = resolveAnimation(props.dropAnimation, result);
    if (animation === null) {
      setDropping(false);
      controller.hideOverlay();
      return;
    }
    const duration = animation.duration ?? 250;
    const easing = animation.easing ?? "ease";
    const target = resolveDropTransform(result);
    const overlayRect = result.over?.rect ?? result.active.rect;
    const cleanup = animation.sideEffects?.({
      active: result.active,
      activeNode: controller.getDraggableNode(result.active.id),
      dragOverlay: {
        node: { current: overlayElement },
        rect: overlayRect,
      },
    });
    if (typeof cleanup === "function") {
      sideEffectCleanup = cleanup;
    }
    if (duration <= 0) {
      finishDrop();
      return;
    }

    setDropping(true);
    setDropState({
      target: target ?? controller.overlayTransform(),
      duration,
      easing,
    });

    if (
      target !== null
      && overlayElement !== null
      && typeof overlayElement.animate === "function"
    ) {
      const initial = CSS.Transform.toString(controller.overlayTransform());
      const final = CSS.Transform.toString(target);
      if (initial !== undefined && final !== undefined) {
        overlayAnimation = overlayElement.animate(
          [
            { transform: initial, opacity: "1" },
            { transform: final, opacity: "0" },
          ],
          { duration, easing, fill: "forwards" },
        );
      }
    }

    timer = setTimeout(finishDrop, duration);
  });

  onCleanup(() => {
    clearTimer();
    cancelOverlayAnimation();
    runSideEffectCleanup();
  });

  const source = (): DragOverlaySource | null =>
    controller.overlayVisible() && props.disabled !== true
      ? controller.overlaySource()
      : null;

  const children = (): Children => {
    const current = controller.overlaySource();
    if (current === null) {
      return null;
    }
    if (typeof props.children === "function") {
      return (props.children as (value: DragOverlaySource) => Children)(current);
    }
    return props.children ?? null;
  };

  const overlayStyle = (): StyleInput => {
    const current = controller.overlaySource();
    const state = dropping() ? dropState() : null;
    const transform = state?.target ?? controller.overlayTransform();
    const rect = current?.rect ?? null;
    const effects = props.sideEffects ?? {};
    const opacity = dropping() ? 0 : (effects.opacity ?? 1);
    const scale = effects.scale ?? 1;
    const transition = state !== null && !supportsWebAnimations()
      ? `transform ${state.duration}ms ${state.easing}, opacity ${state.duration}ms ${state.easing}`
      : "none";
    return normalizeStyle(props.style, {
      position: "fixed",
      top: rect === null ? "0px" : `${rect.top}px`,
      left: rect === null ? "0px" : `${rect.left}px`,
      width: rect === null ? "auto" : `${rect.width}px`,
      height: rect === null ? "auto" : `${rect.height}px`,
      margin: 0,
      boxSizing: "border-box",
      pointerEvents: "none",
      zIndex: 9999,
      transformOrigin: "0 0",
      transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${scale})`,
      opacity,
      transition,
    });
  };

  const setOverlayElement = (node: Element | null): void => {
    overlayElement = (node as HTMLElement | null) ?? null;
  };

  return (
    <span style={{ display: "contents" }}>
      <Show when={source}>
        {() =>
          <Portal target={props.container ?? (() => document.body)}>
            {dynamic(() => props.tag ?? "div", {
              ref: setOverlayElement,
              class: ["dnd-drag-overlay", props.class as ClassNameValue],
              style: overlayStyle,
              "aria-hidden": "true",
              "data-dnd-overlay": "",
              children,
            })}
          </Portal>}
      </Show>
    </span>
  );
}
