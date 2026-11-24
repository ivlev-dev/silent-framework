import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { useUiConfig } from "../../theme/config.js";

export type TopAppBarVariant = "small" | "medium" | "large";

export interface TopAppBarProps {
  readonly title?: Children;
  /** Уровень заголовка для `role="heading"` (по умолчанию 1). */
  readonly titleLevel?: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  readonly variant?: TopAppBarVariant | undefined;
  /** Слот навигации/назад: обычно `IconButton` с обязательной подписью. */
  readonly leading?: Children;
  readonly actions?: Children;
  /** Доступное имя группы actions; по умолчанию — строка `actions`. */
  readonly actionsLabel?: string | undefined;
  /**
   * Приподнятое состояние при прокрутке: тень + тон `surface-container`.
   * Компонент не слушает `scroll` сам — состояние передаёт приложение.
   */
  readonly elevated?: boolean | undefined;
  /** Липкая шапка: `position: sticky` сверху. */
  readonly sticky?: boolean | undefined;
  /** Учитывать `safe-area-inset-top` (по умолчанию `true`). */
  readonly safeArea?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Верхняя панель приложения: small/medium/large, слоты leading/actions,
 * подъём при прокрутке, sticky и safe-area.
 */
export function TopAppBar(props: TopAppBarProps): Node {
  const config = useUiConfig();
  return (
    <header
      {...props.attrs}
      ref={props.ref}
      class={["sui-top-app-bar", props.class]}
      style={props.style}
      data-variant={props.variant ?? "small"}
      data-elevated={props.elevated === true ? "" : undefined}
      data-sticky={props.sticky === true ? "" : undefined}
      data-safe-area={props.safeArea === false ? undefined : ""}
    >
      <div class="sui-top-app-bar__bar">
        <div class="sui-top-app-bar__leading" data-slot="leading">
          {props.leading}
        </div>
        <div
          class="sui-top-app-bar__title"
          data-slot="title"
          role="heading"
          aria-level={props.titleLevel ?? 1}
        >
          {props.title}
        </div>
        <div
          class="sui-top-app-bar__actions"
          data-slot="actions"
          role="group"
          aria-label={props.actionsLabel ?? config.strings.actions}
          tabindex="0"
        >
          {props.actions}
        </div>
      </div>
    </header>
  );
}
