import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { createSignal, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import {
  bindOpenState,
  clientEffect,
  focusFirst,
  trapTab,
  useDismiss,
  useFocusRestore,
  useModalLayer,
} from "../../internal/overlay.js";
import { useUiConfig } from "../../theme/config.js";
import { CloseIcon } from "../../icons/close.js";
import { IconButton } from "../icon-button/icon-button.js";

export type SheetSide = "top" | "right" | "bottom" | "left";

export interface SheetProps {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly side?: SheetSide | undefined;
  /** Модальный лист блокирует фон (`inert` + `aria-hidden`) и focus trap. */
  readonly modal?: boolean | undefined;
  readonly title?: Children;
  readonly description?: Children;
  readonly children?: Children;
  readonly actions?: Children;
  readonly closeLabel?: string | undefined;
  readonly hideClose?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Боковая/нижняя панель. В v1 — без drag-жеста: ручка отрисована как
 * affordance, но перетаскивание не реализовано. SSR рендерит inline-разметку
 * с `data-open`; закрытый лист скрыт `visibility: hidden`.
 */
export function Sheet(props: SheetProps): Node {
  const config = useUiConfig();
  const id = useId("sui-sheet");
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const side: SheetSide = props.side ?? "right";
  const modal = props.modal !== false;
  const hasTitle = props.title !== undefined && props.title !== null;
  const hasDescription = props.description !== undefined && props.description !== null;

  const state = bindOpenState({
    open: () => props.open,
    defaultOpen: () => props.defaultOpen === true,
    onOpenChange: props.onOpenChange,
  });

  const [root, setRoot] = createSignal<HTMLElement | null>(null);
  const [panel, setPanel] = createSignal<HTMLElement | null>(null);

  const close = (): void => {
    state.requestOpen(false);
  };

  useFocusRestore(state.isOpen);
  useModalLayer(root, () => modal && state.isOpen());
  useDismiss(root, state.isOpen, close, { outside: true, escape: true });

  clientEffect(() => {
    if (!state.isOpen()) return;
    const element = panel();
    if (element === null) return;
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (active !== null && element.contains(active)) return;
    focusFirst(element);
  });

  return (
    <div
      {...props.attrs}
      ref={(node: Element | null) => {
        setRoot(node as HTMLElement | null);
        props.ref?.(node);
      }}
      class={["sui-sheet", props.class]}
      style={props.style}
      data-side={side}
      data-open={state.isOpen() ? "" : undefined}
      data-modal={modal ? "" : undefined}
      aria-hidden={state.isOpen() ? undefined : "true"}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Tab") return;
        const element = panel();
        if (element !== null) trapTab(element, event);
      }}
    >
      {modal ? (
        <div
          class="sui-sheet__scrim"
          aria-hidden="true"
          onClick={close}
        />
      ) : null}
      <section
        ref={(node: Element | null) => {
          setPanel(node as HTMLElement | null);
        }}
        class="sui-sheet__panel"
        role="dialog"
        aria-modal={modal ? "true" : undefined}
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-describedby={hasDescription ? descriptionId : undefined}
        tabindex="-1"
      >
        <div class="sui-sheet__handle" data-drag-handle aria-hidden="true" />
        <header class="sui-sheet__header">
          {hasTitle ? (
            <h2 id={titleId} class="sui-sheet__title">
              {props.title}
            </h2>
          ) : (
            <span />
          )}
          {props.hideClose === true ? null : (
            <IconButton
              class="sui-sheet__close"
              label={props.closeLabel ?? config.strings.close}
              size="sm"
              variant="standard"
              onClick={close}
            >
              <CloseIcon />
            </IconButton>
          )}
        </header>
        {hasDescription ? (
          <p id={descriptionId} class="sui-sheet__description">
            {props.description}
          </p>
        ) : null}
        <div class="sui-sheet__body" tabindex="0">{props.children}</div>
        {props.actions === undefined || props.actions === null ? null : (
          <footer class="sui-sheet__actions">{props.actions}</footer>
        )}
      </section>
    </div>
  );
}
