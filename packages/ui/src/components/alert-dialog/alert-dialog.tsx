import type { Child, Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { bindNativeDialog } from "../../internal/native-dialog.js";
import { Button } from "../button/button.js";

export interface AlertDialogProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly title?: Children;
  readonly description?: Children;
  readonly children?: Children;
  readonly confirmLabel?: string | undefined;
  readonly cancelLabel?: string | undefined;
  readonly onConfirm?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
  /** Красная кнопка подтверждения для необратимых действий. */
  readonly destructive?: boolean | undefined;
  readonly hideCancel?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Подтверждающий диалог (`role="alertdialog"`): фокус на действиях,
 * не закрывается кликом по backdrop. Escape работает как отмена.
 */
export function AlertDialog(props: AlertDialogProps): Node {
  const id = useId("sui-alert-dialog");
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const hasTitle = props.title !== undefined && props.title !== null;
  const hasDescription = props.description !== undefined && props.description !== null;

  const dialog = bindNativeDialog({
    open: () => props.open,
    defaultOpen: () => props.defaultOpen === true,
    onOpenChange: props.onOpenChange,
    panelSelector: ".sui-alert-dialog__panel",
    onCancel: props.onCancel,
  });

  const cancel = (): void => {
    props.onCancel?.();
    dialog.requestOpen(false);
  };

  const confirm = (): void => {
    props.onConfirm?.();
    dialog.requestOpen(false);
  };

  return (
    <dialog
      {...props.attrs}
      ref={(node: Element | null) => {
        dialog.setRoot(node as HTMLDialogElement | null);
        props.ref?.(node);
      }}
      class={["sui-alert-dialog", props.class]}
      style={props.style}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={hasTitle ? titleId : undefined}
      aria-describedby={hasDescription ? descriptionId : undefined}
      data-destructive={props.destructive === true ? "" : undefined}
      tabindex="-1"
      open={dialog.isOpen()}
      data-fallback={dialog.fallback() ? "" : undefined}
      onClick={(event: MouseEvent) => dialog.handleBackdrop(event, false)}
      onKeyDown={(event: KeyboardEvent) => dialog.handleKeyDown(event)}
    >
      <div class="sui-alert-dialog__scrim" aria-hidden="true" />
      <div class="sui-alert-dialog__panel" role="document">
        <div class="sui-alert-dialog__content">
          {hasTitle ? (
            <h2 id={titleId} class="sui-alert-dialog__title">
              {props.title}
            </h2>
          ) : null}
          {hasDescription ? (
            <p id={descriptionId} class="sui-alert-dialog__description">
              {props.description}
            </p>
          ) : null}
          {props.children as Child}
        </div>
        <footer class="sui-alert-dialog__actions">
          {props.hideCancel === true ? null : (
            <Button variant="text" class="sui-alert-dialog__cancel" onClick={cancel}>
              {props.cancelLabel ?? "Отмена"}
            </Button>
          )}
          <Button
            variant="filled"
            class="sui-alert-dialog__confirm"
            attrs={{ "data-destructive": props.destructive === true ? "" : undefined }}
            onClick={confirm}
          >
            {props.confirmLabel ?? "Подтвердить"}
          </Button>
        </footer>
      </div>
    </dialog>
  );
}
