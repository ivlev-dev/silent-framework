import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { onCleanup } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { clientEffect } from "../../internal/overlay.js";
import { useUiConfig } from "../../theme/config.js";
import { CloseIcon } from "../../icons/close.js";
import { IconButton } from "../icon-button/icon-button.js";

export interface SnackbarProps {
  /** Controlled: показывать ли снекбар. */
  readonly open: boolean;
  readonly message?: Children;
  /** Действие справа от текста (кнопка «Отменить» и т. п.). */
  readonly action?: Children;
  readonly onClose?: (() => void) | undefined;
  /** Автоскрытие в мс; `0`/`null` — не скрывать. По умолчанию 5000. */
  readonly autoHideDuration?: number | null | undefined;
  /** Переопределяет RU-строку «Закрыть». */
  readonly closeLabel?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Controlled-снекбар: `role="status"`, таймер автоскрытия создаётся только
 * на клиенте и снимается в `onCleanup`/`dispose()`.
 */
export function Snackbar(props: SnackbarProps): Node {
  const config = useUiConfig();

  clientEffect(() => {
    if (!props.open) return;
    const duration = props.autoHideDuration === undefined ? 5000 : props.autoHideDuration;
    if (duration === null || duration <= 0) return;
    const timer = setTimeout(() => {
      props.onClose?.();
    }, duration);
    onCleanup(() => {
      clearTimeout(timer);
    });
  });

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-snackbar", props.class]}
      style={props.style}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-open={props.open ? "" : undefined}
      hidden={!props.open}
    >
      <span class="sui-snackbar__message">{props.message}</span>
      {props.action === undefined || props.action === null ? null : (
        <span class="sui-snackbar__action">{props.action}</span>
      )}
      <IconButton
        class="sui-snackbar__close"
        label={props.closeLabel ?? config.strings.close}
        size="sm"
        variant="standard"
        onClick={() => props.onClose?.()}
      >
        <CloseIcon />
      </IconButton>
    </div>
  );
}
