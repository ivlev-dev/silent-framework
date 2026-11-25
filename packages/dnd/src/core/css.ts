import type { Transform } from "./types.js";

/**
 * Описание CSS-перехода в форме dnd-kit.
 *
 * `duration`/`delay` — в миллисекундах; `property` и `easing` подставляются
 * в итоговую строку как есть.
 */
export interface CSSTransition {
  readonly property: string;
  readonly duration: number;
  readonly easing: string;
  readonly delay?: number;
}

function transformToString(
  transform: Transform | null | undefined,
  withScale: boolean,
): string | undefined {
  if (transform === null || transform === undefined) {
    return undefined;
  }

  const translation = `translate3d(${transform.x}px, ${transform.y}px, 0)`;

  if (!withScale) {
    return translation;
  }

  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;

  return `${translation} scaleX(${scaleX}) scaleY(${scaleY})`;
}

function transitionToString(
  transition: CSSTransition | null | undefined,
): string | undefined {
  if (transition === null || transition === undefined) {
    return undefined;
  }

  const parts = [
    transition.property,
    `${transition.duration}ms`,
    transition.easing,
  ];

  if (transition.delay !== undefined && transition.delay !== 0) {
    parts.push(`${transition.delay}ms`);
  }

  const value = parts.filter((part) => part.length > 0).join(" ");

  return value.length > 0 ? value : undefined;
}

/**
 * Утилиты сериализации transform/transition в CSS-строки.
 *
 * Повторяет форму `CSS` из `@dnd-kit/utilities`: `CSS.Transform.toString`,
 * `CSS.Translate.toString` и `CSS.Transition.toString`. Для `null`/`undefined`
 * возвращается `undefined`, чтобы значение можно было безопасно передать в
 * `style` без лишней строки.
 */
export const CSS = {
  Transform: {
    toString: (transform: Transform | null | undefined): string | undefined =>
      transformToString(transform, true),
  },
  Translate: {
    toString: (transform: Transform | null | undefined): string | undefined =>
      transformToString(transform, false),
  },
  Transition: {
    toString: (
      transition: CSSTransition | null | undefined,
    ): string | undefined => transitionToString(transition),
  },
} as const;
