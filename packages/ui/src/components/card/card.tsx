import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs, SpaceStep } from "../../internal/props.js";

export type CardVariant = "elevated" | "filled" | "outlined";
export type CardMediaAspect = "auto" | "square" | "video" | "wide" | "portrait";

export interface CardProps {
  readonly variant?: CardVariant | undefined;
  /**
   * Интерактивная карточка: `role="button"`, `tabindex="0"` и активация
   * Enter/Space. Нативный `<button>` не используется, чтобы в слоты можно
   * было класть ссылки и другие кнопки без вложенной интерактивности.
   */
  readonly interactive?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly padding?: SpaceStep | undefined;
  /** Медиа сверху: изображение, видео, график. */
  readonly media?: Children;
  /** Пропорции медиа: `auto` (натуральные) или фиксированные. */
  readonly mediaAspect?: CardMediaAspect | undefined;
  /** Заголовок/подзаголовок над телом. */
  readonly header?: Children;
  /** Обрезка длинного заголовка по строкам (1–3). */
  readonly headerLines?: 1 | 2 | 3 | undefined;
  /** Действия внизу карточки. */
  readonly actions?: Children;
  /** Подвал отдельным слотом: служебные действия, метаданные, ссылки. */
  readonly footer?: Children;
  readonly onClick?: ((event: MouseEvent | KeyboardEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Карточка-контейнер. Вариант — `data-variant`, отступы — `data-padding`.
 * Интерактивность — ARIA-семантика кнопки на `div`, без ссылки.
 */
export function Card(props: CardProps): Node {
  const interactive = props.interactive === true;
  const disabled = props.disabled === true;
  const active = interactive && !disabled;

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-card", props.class]}
      style={props.style}
      data-variant={props.variant ?? "elevated"}
      data-padding={props.padding ?? 5}
      data-media-aspect={props.mediaAspect ?? "auto"}
      data-header-lines={props.headerLines}
      data-interactive={interactive ? "" : undefined}
      role={interactive ? "button" : undefined}
      tabindex={active ? 0 : undefined}
      aria-disabled={interactive ? (disabled ? "true" : undefined) : undefined}
      onClick={(event) => {
        if (!active) return;
        props.onClick?.(event);
      }}
      onKeyDown={(event) => {
        if (!active) return;
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          props.onClick?.(event);
        }
      }}
    >
      <Show when={props.media !== undefined && props.media !== null}>
        <div class="sui-card__media">{props.media}</div>
      </Show>
      <Show when={props.header !== undefined && props.header !== null}>
        <div class="sui-card__header">{props.header}</div>
      </Show>
      <div class="sui-card__body">{props.children}</div>
      <Show when={props.actions !== undefined && props.actions !== null}>
        <div class="sui-card__actions">{props.actions}</div>
      </Show>
      <Show when={props.footer !== undefined && props.footer !== null}>
        <div class="sui-card__footer">{props.footer}</div>
      </Show>
    </div>
  );
}
