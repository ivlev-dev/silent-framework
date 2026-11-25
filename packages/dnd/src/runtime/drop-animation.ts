import type { Active } from "../core/types.js";
import type {
  DropAnimation,
  DropAnimationSideEffectElement,
  DropAnimationSideEffects,
  DropAnimationSideEffectsOptions,
} from "./types.js";

/**
 * Drop-анимация по умолчанию: 250 мс, кривая `ease`.
 *
 * Совпадает с dnd-kit; передаётся в `DragOverlay.dropAnimation`, если проп не
 * задан.
 */
export const defaultDropAnimation: DropAnimation = Object.freeze({
  duration: 250,
  easing: "ease",
});

function toCssProperty(property: string): string {
  if (property.startsWith("--")) {
    return property;
  }
  return property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function resolveNode(
  value: HTMLElement | DropAnimationSideEffectElement | null | undefined,
): HTMLElement | null {
  if (value === null || value === undefined) {
    return null;
  }

  const asElement = value as HTMLElement;
  if (
    typeof asElement.style === "object"
    && asElement.style !== null
    && typeof asElement.style.setProperty === "function"
  ) {
    return asElement;
  }

  const current = (value as DropAnimationSideEffectElement).current;
  return current ?? null;
}

/**
 * Фабрика побочных эффектов drop-анимации.
 *
 * Принимает набор стилей для активного элемента и оверлея, возвращает функцию
 * `({active, dragOverlay}) => cleanup`. Стили применяются на старте анимации,
 * исходные значения запоминаются и восстанавливаются функцией очистки.
 *
 * ```ts
 * const sideEffects = defaultDropAnimationSideEffects({
 *   styles: { active: { opacity: "0" } },
 * });
 * ```
 */
export function defaultDropAnimationSideEffects(
  options: DropAnimationSideEffectsOptions,
): DropAnimationSideEffects {
  const styles = options.styles ?? {};

  return ({ active, activeNode, dragOverlay }) => {
    const overlayNode = resolveNode(dragOverlay.node);
    const legacyActiveNode = (
      active as Active & {
        readonly node?: HTMLElement | DropAnimationSideEffectElement | null;
      }
    ).node;
    const activeElement = resolveNode(activeNode ?? legacyActiveNode);
    const originals: Array<{
      readonly element: HTMLElement;
      readonly property: string;
      readonly value: string;
      readonly priority: string;
    }> = [];

    const apply = (
      element: HTMLElement | null,
      declarations: Readonly<Record<string, string>> | undefined,
    ): void => {
      if (element === null || declarations === undefined) {
        return;
      }
      for (const [property, value] of Object.entries(declarations)) {
        if (value === undefined) {
          continue;
        }
        const cssProperty = toCssProperty(property);
        originals.push({
          element,
          property: cssProperty,
          value: element.style.getPropertyValue(cssProperty),
          priority: element.style.getPropertyPriority(cssProperty),
        });
        element.style.setProperty(cssProperty, value);
      }
    };

    apply(activeElement, styles.active);
    apply(overlayNode, styles.dragOverlay);

    return () => {
      for (const original of originals.reverse()) {
        if (original.value === "") {
          original.element.style.removeProperty(original.property);
          continue;
        }
        original.element.style.setProperty(
          original.property,
          original.value,
          original.priority,
        );
      }
    };
  };
}
