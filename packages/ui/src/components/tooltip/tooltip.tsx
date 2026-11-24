import type { Child, Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { createSignal, onCleanup, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { useMounted } from "../../internal/overlay.js";

export type TooltipPlacement = "top" | "bottom" | "start" | "end";

export interface TooltipProps {
  readonly content: Children;
  readonly children?: Children;
  readonly placement?: TooltipPlacement | undefined;
  /** Задержка показа в мс. По умолчанию 500. */
  readonly delay?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Тултип на hover/focus. На сервере не всплывает (панель отсутствует),
 * на touch не показывается. `aria-describedby` ставится только на видимую
 * подсказку, чтобы скринридер не читал скрытый текст.
 */
export function Tooltip(props: TooltipProps): Node {
  const id = useId("sui-tooltip");
  const panelId = `${id}-panel`;
  const placement: TooltipPlacement = props.placement ?? "top";
  const mounted = useMounted();
  const [open, setOpen] = createSignal(false);
  const visible = (): boolean => mounted() && open();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPointer = "mouse";

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const show = (duration: number): void => {
    if (props.disabled === true) return;
    clearTimer();
    if (duration <= 0) {
      setOpen(true);
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      setOpen(true);
    }, duration);
  };

  const hide = (): void => {
    clearTimer();
    setOpen(false);
  };

  onCleanup(clearTimer);

  const delay = (): number => props.delay ?? 500;

  return (
    <span
      {...props.attrs}
      ref={props.ref}
      class={["sui-tooltip", props.class]}
      style={props.style}
      data-placement={placement}
      aria-describedby={visible() ? panelId : undefined}
      onPointerEnter={(event: PointerEvent) => {
        lastPointer = event.pointerType;
        if (event.pointerType === "touch") return;
        show(delay());
      }}
      onPointerLeave={() => {
        hide();
      }}
      onPointerDown={(event: PointerEvent) => {
        lastPointer = event.pointerType;
        if (event.pointerType === "touch") hide();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        lastPointer = "keyboard";
        if (event.key === "Escape") hide();
      }}
      onFocusIn={() => {
        if (lastPointer === "touch") return;
        show(delay());
      }}
      onFocusOut={() => {
        hide();
      }}
    >
      {props.children as Child}
      <span
        id={panelId}
        class="sui-tooltip__panel"
        role="tooltip"
        hidden={!visible()}
      >
        {props.content as Child}
      </span>
    </span>
  );
}
