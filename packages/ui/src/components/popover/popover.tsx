import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { createSignal, onCleanup, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import {
  applyTriggerAria,
  bindOpenState,
  clientEffect,
  focusFirst,
  getActiveElement,
  restoreFocus,
  syncTriggerAria,
  useDismiss,
  useFloating,
  useMounted,
} from "../../internal/overlay.js";

export type PopoverPlacement = "top" | "bottom" | "start" | "end";

export interface PopoverProps {
  readonly trigger: Children;
  readonly children?: Children;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly placement?: PopoverPlacement | undefined;
  /** Доступное имя панели (`role="dialog"`). */
  readonly label?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Inline-поповер: anchor-контейнер + абсолютная панель (без Portal, чтобы
 * SSR-контекст не терялся). На сервере закрыт; открывается после монтирования.
 * Закрытие — клик вне, Escape; фокус уходит в панель и возвращается на anchor.
 */
export function Popover(props: PopoverProps): Node {
  const id = useId("sui-popover");
  const panelId = `${id}-panel`;
  const placement: PopoverPlacement = props.placement ?? "bottom";
  const mounted = useMounted();
  const state = bindOpenState({
    open: () => props.open,
    defaultOpen: () => props.defaultOpen === true,
    onOpenChange: props.onOpenChange,
  });
  const visible = (): boolean => mounted() && state.isOpen();
  const triggerIsInteractive = applyTriggerAria(props.trigger, panelId, "dialog", visible());

  const [root, setRoot] = createSignal<HTMLElement | null>(null);
  const [panel, setPanel] = createSignal<HTMLElement | null>(null);
  const [restoreOnClose, setRestoreOnClose] = createSignal(true);
  const side = useFloating({
    anchor: root,
    panel,
    isOpen: visible,
    preferred: () => placement,
  });

  const close = (restore: boolean): void => {
    setRestoreOnClose(restore);
    state.requestOpen(false);
  };

  useDismiss(root, visible, () => close(false));

  // Фокус: при открытии — первый focusable панели, при закрытии
  // (Escape/повторный клик) — обратно на anchor. Клик вне фокус не крадёт.
  clientEffect(() => {
    if (!visible()) return;
    const element = panel();
    if (element === null) return;
    const previous = getActiveElement();
    focusFirst(element);
    onCleanup(() => {
      if (restoreOnClose()) restoreFocus(previous);
    });
  });

  // aria-expanded/controls на фактическом триггере: обёртка без роли не несёт ARIA.
  clientEffect(() => {
    const element = root();
    if (element === null) return;
    syncTriggerAria(element, ".sui-popover__anchor", panelId, "dialog", visible());
  });

  return (
    <span
      {...props.attrs}
      ref={(node: Element | null) => {
        setRoot(node as HTMLElement | null);
        props.ref?.(node);
      }}
      class={["sui-popover", props.class]}
      style={props.style}
      data-placement={placement}
      data-side={side()}
    >
      <span
        class="sui-popover__anchor"
        role={triggerIsInteractive ? undefined : "button"}
        tabindex={triggerIsInteractive ? undefined : "0"}
        aria-haspopup={triggerIsInteractive ? undefined : "dialog"}
        aria-expanded={triggerIsInteractive ? undefined : visible() ? "true" : "false"}
        aria-controls={triggerIsInteractive ? undefined : panelId}
        onClick={() => {
          if (props.disabled === true) return;
          if (visible()) {
            close(true);
            return;
          }
          setRestoreOnClose(true);
          state.requestOpen(true);
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (props.disabled === true) return;
          if (visible()) {
            close(true);
            return;
          }
          setRestoreOnClose(true);
          state.requestOpen(true);
        }}
      >
        {props.trigger}
      </span>
      <div
        ref={(node: Element | null) => {
          setPanel(node as HTMLElement | null);
        }}
        id={panelId}
        class="sui-popover__panel"
        role="dialog"
        aria-label={props.label}
        data-placement={placement}
        data-side={side()}
        tabindex="-1"
        hidden={!visible()}
      >
        {props.children}
      </div>
    </span>
  );
}
