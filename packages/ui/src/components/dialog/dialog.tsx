import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { bindNativeDialog } from "../../internal/native-dialog.js";
import { useUiConfig } from "../../theme/config.js";
import { CloseIcon } from "../../icons/close.js";
import { IconButton } from "../icon-button/icon-button.js";

export interface DialogProps {
  /** Controlled-состояние. Без пропса диалог живёт на `defaultOpen`. */
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly title?: Children;
  readonly description?: Children;
  readonly children?: Children;
  readonly actions?: Children;
  /** Переопределяет RU-строку «Закрыть» из `UiConfigProvider`. */
  readonly closeLabel?: string | undefined;
  /** Скрыть крестик (например, когда закрытие только кнопкой в `actions`). */
  readonly hideClose?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Модальный диалог на нативном `<dialog>`: `showModal()` после монтирования,
 * Escape/backdrop, focus trap и возврат фокуса. SSR рендерит inline
 * `<dialog open>` без Portal — гидрация не теряет контекст и не даёт mismatch.
 */
export function Dialog(props: DialogProps): Node {
  const config = useUiConfig();
  const id = useId("sui-dialog");
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const hasDescription = props.description !== undefined && props.description !== null;
  const hasTitle = props.title !== undefined && props.title !== null;

  const dialog = bindNativeDialog({
    open: () => props.open,
    defaultOpen: () => props.defaultOpen === true,
    onOpenChange: props.onOpenChange,
    panelSelector: ".sui-dialog__panel",
  });

  const requestClose = (): void => {
    dialog.requestOpen(false);
  };

  return (
    <dialog
      {...props.attrs}
      ref={(node: Element | null) => {
        dialog.setRoot(node as HTMLDialogElement | null);
        props.ref?.(node);
      }}
      class={["sui-dialog", props.class]}
      style={props.style}
      role="dialog"
      aria-modal="true"
      aria-labelledby={hasTitle ? titleId : undefined}
      aria-describedby={hasDescription ? descriptionId : undefined}
      tabindex="-1"
      open={dialog.isOpen()}
      data-fallback={dialog.fallback() ? "" : undefined}
      onClick={(event: MouseEvent) => dialog.handleBackdrop(event, true)}
      onKeyDown={(event: KeyboardEvent) => dialog.handleKeyDown(event)}
    >
      <div class="sui-dialog__scrim" aria-hidden="true" onClick={requestClose} />
      <div class="sui-dialog__panel" role="document">
        <header class="sui-dialog__header">
          {hasTitle ? (
            <h2 id={titleId} class="sui-dialog__title">
              {props.title}
            </h2>
          ) : (
            <span />
          )}
          {props.hideClose === true ? null : (
            <IconButton
              class="sui-dialog__close"
              label={props.closeLabel ?? config.strings.close}
              size="sm"
              variant="standard"
              onClick={requestClose}
            >
              <CloseIcon />
            </IconButton>
          )}
        </header>
        {hasDescription ? (
          <p id={descriptionId} class="sui-dialog__description">
            {props.description}
          </p>
        ) : null}
        <div class="sui-dialog__body" tabindex="0">{props.children}</div>
        {props.actions === undefined || props.actions === null ? null : (
          <footer class="sui-dialog__actions">{props.actions}</footer>
        )}
      </div>
    </dialog>
  );
}
