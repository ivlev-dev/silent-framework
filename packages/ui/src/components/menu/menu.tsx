import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { createSignal, onCleanup, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import {
  applyTriggerAria,
  bindOpenState,
  clientEffect,
  getActiveElement,
  restoreFocus,
  syncTriggerAria,
  useDismiss,
  useFloating,
  useMounted,
} from "../../internal/overlay.js";

const ALL_ITEMS = '[role="menuitem"]';
const ENABLED_ITEMS = '[role="menuitem"]:not([aria-disabled="true"]):not([disabled])';

export interface MenuProps {
  readonly trigger?: Children;
  readonly children?: Children;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /** Доступное имя меню. */
  readonly label?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

function enabledItems(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(ENABLED_ITEMS));
}

function setTabStop(panel: HTMLElement, target: HTMLElement | null): void {
  for (const item of Array.from(panel.querySelectorAll<HTMLElement>(ALL_ITEMS))) {
    item.tabIndex = item === target ? 0 : -1;
  }
}

/** Доступные пункты меню в DOM-порядке (для клавиатуры). */
function indexOfItem(items: readonly HTMLElement[], node: Element | null): number {
  if (node === null) return -1;
  for (let index = 0; index < items.length; index += 1) {
    if (items[index] === node) return index;
  }
  return -1;
}

/**
 * Меню с roving tabindex: `role="menu"`, стрелки/Home/End/Enter/Escape.
 * Панель inline (без Portal), на сервере закрыта и открывается после mount.
 */
export function Menu(props: MenuProps): Node {
  const id = useId("sui-menu");
  const panelId = `${id}-panel`;
  const mounted = useMounted();
  const state = bindOpenState({
    open: () => props.open,
    defaultOpen: () => props.defaultOpen === true,
    onOpenChange: props.onOpenChange,
  });
  const visible = (): boolean => mounted() && state.isOpen();
  const triggerIsInteractive = applyTriggerAria(props.trigger, panelId, "menu", visible());

  const [root, setRoot] = createSignal<HTMLElement | null>(null);
  const [panel, setPanel] = createSignal<HTMLElement | null>(null);
  const [focusRequested, setFocusRequested] = createSignal(false);
  const [restoreOnClose, setRestoreOnClose] = createSignal(true);
  const side = useFloating({
    anchor: root,
    panel,
    isOpen: visible,
    preferred: () => "bottom",
    topLayer: props.trigger !== undefined && props.trigger !== null,
  });

  const close = (restore: boolean): void => {
    setRestoreOnClose(restore);
    state.requestOpen(false);
  };

  useDismiss(root, visible, () => close(false), { escape: false });

  // Возврат фокуса на триггер при Escape/выборе, но не при клике вне.
  clientEffect(() => {
    if (!visible()) return;
    const previous = getActiveElement();
    onCleanup(() => {
      if (restoreOnClose()) restoreFocus(previous);
    });
  });

  // Roving tabindex и опциональный автофокус после явного открытия.
  clientEffect(() => {
    if (!visible()) return;
    const element = panel();
    if (element === null || !element.isConnected) return;
    const items = enabledItems(element);
    if (items.length === 0) return;
    const active = document.activeElement;
    const first = items[0];
    if (first === undefined) return;
    if (active === null || !items.includes(active as HTMLElement)) {
      setTabStop(element, first);
    }
    if (focusRequested()) {
      setFocusRequested(false);
      first.focus({ preventScroll: true });
    }
  });

  // aria-expanded/controls на самом триггере: обёртка без роли не несёт ARIA.
  clientEffect(() => {
    const element = root();
    if (element === null) return;
    syncTriggerAria(element, ".sui-menu__anchor", panelId, "menu", visible());
  });

  const open = (): void => {
    if (props.disabled === true) return;
    setRestoreOnClose(true);
    setFocusRequested(true);
    state.requestOpen(true);
  };

  const toggle = (): void => {
    if (props.disabled === true) return;
    if (visible()) {
      close(true);
      return;
    }
    open();
  };

  const handleKeyDown = (event: KeyboardEvent, element: HTMLElement): void => {
    const items = enabledItems(element);
    if (items.length === 0) return;
    const active = document.activeElement;
    let index = indexOfItem(items, active instanceof Element ? active : null);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (event.key === "Home") index = 0;
      else if (event.key === "End") index = items.length - 1;
      else if (event.key === "ArrowDown") index = index < 0 ? 0 : (index + 1) % items.length;
      else index = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
      const next = items[index];
      if (next !== undefined) {
        setTabStop(element, next);
        next.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const item = index >= 0 ? items[index] : items[0];
      if (item === undefined) return;
      event.preventDefault();
      item.click();
    }
  };

  return (
    <div
      {...props.attrs}
      ref={(node: Element | null) => {
        setRoot(node as HTMLElement | null);
        props.ref?.(node);
      }}
      class={["sui-menu", props.class]}
      style={props.style}
      data-anchored={props.trigger === undefined || props.trigger === null ? undefined : ""}
      data-open={visible() ? "" : undefined}
      data-side={side()}
    >
      {props.trigger === undefined || props.trigger === null ? null : (
        <span
          class="sui-menu__anchor"
          role={triggerIsInteractive ? undefined : "button"}
          tabindex={triggerIsInteractive ? undefined : "0"}
          aria-haspopup={triggerIsInteractive ? undefined : "menu"}
          aria-expanded={triggerIsInteractive ? undefined : visible() ? "true" : "false"}
          aria-controls={triggerIsInteractive ? undefined : panelId}
          onClick={toggle}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              open();
              return;
            }
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            open();
          }}
        >
          {props.trigger}
        </span>
      )}
      <div
        ref={(node: Element | null) => {
          setPanel(node as HTMLElement | null);
        }}
        id={panelId}
        class="sui-menu__panel"
        role="menu"
        aria-label={props.label}
        data-side={side()}
        tabindex="-1"
        hidden={!visible()}
        onKeyDown={(event: KeyboardEvent) => {
          const element = panel();
          if (element !== null) handleKeyDown(event, element);
        }}
        onFocusIn={(event: FocusEvent) => {
          const element = panel();
          if (element === null) return;
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (target.getAttribute("role") !== "menuitem") return;
          if (enabledItems(element).includes(target)) setTabStop(element, target);
        }}
        onClick={(event: MouseEvent) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const item = target.closest('[role="menuitem"]');
          if (item === null) return;
          if (item.getAttribute("aria-disabled") === "true") return;
          close(true);
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

export interface MenuItemProps {
  readonly disabled?: boolean | undefined;
  readonly leading?: Children;
  readonly trailing?: Children;
  readonly onSelect?: (() => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/** Пункт меню: `role="menuitem"`, roving tabindex, disabled. */
export function MenuItem(props: MenuItemProps): Node {
  const [element, setElement] = createSignal<HTMLElement | null>(null);

  // Вне меню пункт должен быть доступен с клавиатуры сам по себе.
  clientEffect(() => {
    const node = element();
    if (node === null) return;
    if (node.closest('[role="menu"]') !== null) return;
    node.tabIndex = 0;
  });

  return (
    <button
      {...props.attrs}
      ref={(node: Element | null) => {
        setElement(node as HTMLElement | null);
        props.ref?.(node);
      }}
      class={["sui-menu__item", props.class]}
      style={props.style}
      type="button"
      role="menuitem"
      tabindex="-1"
      disabled={props.disabled === true}
      aria-disabled={props.disabled === true ? "true" : undefined}
      data-disabled={props.disabled === true ? "" : undefined}
      onClick={() => {
        if (props.disabled === true) return;
        props.onSelect?.();
      }}
    >
      <span class="sui-menu__leading" data-slot="leading" aria-hidden="true">
        {props.leading}
      </span>
      <span class="sui-menu__label">{props.children}</span>
      <span class="sui-menu__trailing" data-slot="trailing" aria-hidden="true">
        {props.trailing}
      </span>
    </button>
  );
}

export interface MenuSeparatorProps {
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

/** Разделитель пунктов меню. */
export function MenuSeparator(props: MenuSeparatorProps): Node {
  return (
    <hr
      {...props.attrs}
      class={["sui-menu__separator", props.class]}
      style={props.style}
      role="separator"
      aria-orientation="horizontal"
    />
  );
}
