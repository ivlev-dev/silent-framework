import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { Heading, type HeadingLevel } from "../heading/heading.js";

export interface EmptyStateProps {
  /** Декоративная иконка в круге. */
  readonly icon?: Children;
  /** Иллюстрация вместо иконки; ответственность за alt — на потребителе. */
  readonly illustration?: Children;
  readonly title: Children;
  readonly description?: Children;
  /** Кнопки/ссылки под описанием. */
  readonly actions?: Children;
  /** Компактный вариант для встраивания в таблицу или панель. */
  readonly compact?: boolean | undefined;
  /** Уровень заголовка; по умолчанию `3`. */
  readonly titleLevel?: HeadingLevel | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Пустое состояние: слот иконки/иллюстрации, заголовок, описание и действия.
 * Иконка декоративна, поэтому скринридер читает только текст.
 */
export function EmptyState(props: EmptyStateProps): Node {
  const hasMedia =
    (props.illustration !== undefined && props.illustration !== null)
    || (props.icon !== undefined && props.icon !== null);

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-empty-state", props.class]}
      style={props.style}
      data-compact={props.compact === true ? "" : undefined}
    >
      <Show when={hasMedia}>
        <div class="sui-empty-state__media" data-slot="media">
          <Show
            when={props.illustration !== undefined && props.illustration !== null}
            fallback={
              <span class="sui-empty-state__icon" aria-hidden="true">
                {props.icon}
              </span>
            }
          >
            <span class="sui-empty-state__illustration">{props.illustration}</span>
          </Show>
        </div>
      </Show>
      <Heading
        class="sui-empty-state__title"
        level={props.titleLevel ?? 3}
        variant={props.compact === true ? "title-small" : "title-large"}
      >
        {props.title}
      </Heading>
      <Show when={props.description !== undefined && props.description !== null}>
        <p class="sui-empty-state__description">{props.description}</p>
      </Show>
      <Show when={props.actions !== undefined && props.actions !== null}>
        <div class="sui-empty-state__actions">{props.actions}</div>
      </Show>
    </div>
  );
}
