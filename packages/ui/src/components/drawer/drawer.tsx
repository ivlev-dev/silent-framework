import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createEffect, isServerMode, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { CloseIcon } from "../../icons/close.js";
import { IconButton } from "../icon-button/icon-button.js";
import { useUiConfig } from "../../theme/config.js";

export type DrawerVariant = "modal" | "standard";
export type DrawerSide = "start" | "end";

export interface DrawerProps {
  readonly open: boolean;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /** `modal` — оверлей со скримом и focus trap, `standard` — часть раскладки. */
  readonly variant?: DrawerVariant | undefined;
  readonly side?: DrawerSide | undefined;
  readonly header?: Children;
  readonly footer?: Children;
  /** Доступное имя панели, если нет заголовка. */
  readonly label?: string | undefined;
  /** Внешний id заголовка вместо встроенного. */
  readonly labelledBy?: string | undefined;
  /** Кнопка закрытия в шапке (RU-подпись `Закрыть`). */
  readonly showCloseButton?: boolean | undefined;
  /** Закрывать модальную панель кликом по скриму (по умолчанию `true`). */
  readonly closeOnScrimClick?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(FOCUSABLE);
  const result: HTMLElement[] = [];
  for (const node of nodes) {
    if (node.getAttribute("aria-hidden") === "true") continue;
    result.push(node);
  }
  return result;
}

/**
 * Боковая панель. `modal` рендерит скрим, `role="dialog"` и `aria-modal`,
 * запирает фокус и возвращает его на триггер при закрытии. Escape закрывает
 * панель через `onOpenChange(false)`. В SSR панель рендерится inline.
 */
export function Drawer(props: DrawerProps): Node {
  const config = useUiConfig();
  const modal = (props.variant ?? "modal") === "modal";
  const side = props.side ?? "start";
  const generatedId = useId("sui-drawer");
  const headerId = `${generatedId}-header`;
  const hasHeaderContent = props.header !== undefined && props.header !== null;
  const showCloseButton = props.showCloseButton === true;
  const showHeader = hasHeaderContent || showCloseButton;
  const labelledBy =
    props.labelledBy
    ?? (props.label === undefined && hasHeaderContent ? headerId : undefined);

  let panel: HTMLElement | null = null;
  let restoreTarget: HTMLElement | null = null;

  const isOpen = (): boolean => props.open === true;

  const focusPanel = (): void => {
    const node = panel;
    if (node === null || !isOpen()) return;
    const first = focusableIn(node)[0];
    (first ?? node).focus();
  };

  let wasOpen = false;
  createEffect(() => {
    const open = isOpen();
    if (open === wasOpen) return;
    wasOpen = open;
    if (isServerMode() || typeof document === "undefined") return;
    if (open) {
      const active = document.activeElement;
      restoreTarget =
        active instanceof HTMLElement && active !== document.body ? active : null;
      focusPanel();
      return;
    }
    const target = restoreTarget;
    restoreTarget = null;
    if (target !== null && target.isConnected) target.focus();
  });

  const requestClose = (): void => {
    props.onOpenChange?.(false);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (!modal || event.key !== "Tab") return;
    const node = panel;
    if (node === null) return;
    const focusables = focusableIn(node);
    if (focusables.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === node) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      {...props.attrs}
      ref={props.ref}
      class={["sui-drawer", props.class]}
      style={props.style}
      data-variant={props.variant ?? "modal"}
      data-side={side}
      data-open={isOpen() ? "" : undefined}
      onKeyDown={handleKeyDown}
    >
      <Show when={modal && isOpen()}>
        <div
          class="sui-drawer__scrim"
          aria-hidden="true"
          onClick={() => {
            if (props.closeOnScrimClick === false) return;
            requestClose();
          }}
        />
      </Show>
      <aside
        ref={(node: Element | null) => {
          panel = node instanceof HTMLElement ? node : null;
        }}
        class="sui-drawer__panel"
        tabindex={-1}
        role={modal ? "dialog" : undefined}
        aria-modal={modal && isOpen() ? "true" : undefined}
        aria-label={labelledBy === undefined ? props.label : undefined}
        aria-labelledby={labelledBy}
        hidden={!isOpen()}
      >
        <Show when={showHeader}>
          <div class="sui-drawer__header" id={headerId}>
            <div class="sui-drawer__header-content">{props.header}</div>
            <Show when={showCloseButton}>
              <IconButton
                class="sui-drawer__close"
                label={config.strings.close}
                size="sm"
                onClick={() => {
                  requestClose();
                }}
              >
                <CloseIcon />
              </IconButton>
            </Show>
          </div>
        </Show>
        <div class="sui-drawer__content" tabindex="0">{props.children}</div>
        <Show when={props.footer !== undefined && props.footer !== null}>
          <div class="sui-drawer__footer">{props.footer}</div>
        </Show>
      </aside>
    </div>
  );
}
