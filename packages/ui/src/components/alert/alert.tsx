import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { CloseIcon } from "../../icons/close.js";
import { ErrorIcon } from "../../icons/error.js";
import { InfoIcon } from "../../icons/info.js";
import { SuccessIcon } from "../../icons/success.js";
import { WarningIcon } from "../../icons/warning.js";
import { useUiConfig } from "../../theme/config.js";

export type AlertVariant = "info" | "success" | "warning" | "error";
export type AlertRole = "status" | "alert";

/** Иконка по умолчанию: смысл несёт вариант, иконка — визуальный якорь. */
function defaultIcon(variant: AlertVariant): Node {
  if (variant === "success") return <SuccessIcon />;
  if (variant === "warning") return <WarningIcon />;
  if (variant === "error") return <ErrorIcon />;
  return <InfoIcon />;
}

/** `warning`/`error` прерывают скринридер, `info`/`success` — вежливое объявление. */
const ALERT_ROLE: Readonly<Record<AlertVariant, AlertRole>> = {
  info: "status",
  success: "status",
  warning: "alert",
  error: "alert",
};

export interface AlertProps {
  readonly variant?: AlertVariant | undefined;
  readonly title?: Children;
  /** Иконка слева от текста. Декоративная: смысл несёт `variant`. */
  readonly icon?: Children;
  /** Действия под сообщением (кнопки/ссылки). */
  readonly actions?: Children;
  readonly dismissible?: boolean | undefined;
  readonly onClose?: ((event: MouseEvent) => void) | undefined;
  /** Переопределяет строку `close` из `UiConfigProvider`. */
  readonly closeLabel?: string | undefined;
  /** Ручное переопределение роли; по умолчанию выводится из `variant`. */
  readonly role?: AlertRole | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Уведомление. Один корень, вариант — `data-variant`, роль объявления
 * выводится из варианта. Закрытие — кнопка с RU-подписью (`Закрыть`).
 */
export function Alert(props: AlertProps): Node {
  const config = useUiConfig();
  const variant = props.variant ?? "info";
  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-alert", props.class]}
      style={props.style}
      role={props.role ?? ALERT_ROLE[variant]}
      data-variant={variant}
      data-dismissible={props.dismissible === true ? "" : undefined}
    >
      <span class="sui-alert__icon" data-slot="icon" aria-hidden="true">
        {props.icon !== undefined ? props.icon : defaultIcon(variant)}
      </span>
      <div class="sui-alert__content">
        <Show when={props.title !== undefined && props.title !== null}>
          <p class="sui-alert__title">{props.title}</p>
        </Show>
        <div class="sui-alert__message">{props.children}</div>
        <Show when={props.actions !== undefined && props.actions !== null}>
          <div class="sui-alert__actions">{props.actions}</div>
        </Show>
      </div>
      <Show when={props.dismissible === true}>
        <button
          class="sui-alert__close"
          type="button"
          aria-label={props.closeLabel ?? config.strings.close}
          onClick={(event) => {
            props.onClose?.(event);
          }}
        >
          <CloseIcon size="sm" />
        </button>
      </Show>
    </div>
  );
}
