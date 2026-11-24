import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createSignal, useId } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import {
  clientEffect,
  focusFirst,
  trapTab,
  useDismiss,
  useFocusRestore,
  useModalLayer,
} from "../../internal/overlay.js";
import { CloseIcon } from "../../icons/close.js";
import { IconButton } from "../icon-button/icon-button.js";
import { useUiConfig } from "../../theme/config.js";

export type DrawerVariant = "modal" | "standard";
export type DrawerSide = "start" | "end";

export interface DrawerProps {
  readonly open: boolean;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  /** `modal` — оверлей со скримом, `inert`-фоном и focus trap, `standard` — часть раскладки. */
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

/**
 * Боковая панель. `modal` рендерит скрим, `role="dialog"`,
 * `aria-modal`, блокирует фон (`inert`/`aria-hidden`) и прокрутку `body`,
 * запирает фокус и возвращает его на триггер при закрытии. Escape закрывает
 * панель через `onOpenChange(false)`. `standard` — часть раскладки: фон и
 * прокрутка не блокируются. В SSR панель рендерится inline.
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

  const [root, setRoot] = createSignal<HTMLElement | null>(null);
  const [panel, setPanel] = createSignal<HTMLElement | null>(null);

  const isOpen = (): boolean => props.open === true;

  const requestClose = (): void => {
    props.onOpenChange?.(false);
  };

  useFocusRestore(isOpen);
  useModalLayer(root, () => modal && isOpen());

  // Модальная панель закрывается кликом вне окна и Escape; standard остаётся
  // частью раскладки и не перехватывает клики по странице.
  useDismiss(
    root,
    () => modal && isOpen(),
    requestClose,
    { outside: true, escape: true },
  );

  // Автофокус при открытии, если фокус ещё не внутри панели.
  clientEffect(() => {
    if (!isOpen()) return;
    const element = panel();
    if (element === null) return;
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (active !== null && element.contains(active)) return;
    focusFirst(element);
  });

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!isOpen()) return;
    // В modal Escape ловит `useDismiss` на документе; для standard закрываем
    // только когда событие пришло из самой панели.
    if (!modal && event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (!modal || event.key !== "Tab") return;
    const node = panel();
    if (node !== null) trapTab(node, event);
  };

  return (
    <div
      {...props.attrs}
      ref={(node: Element | null) => {
        setRoot(node as HTMLElement | null);
        props.ref?.(node);
      }}
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
          setPanel(node as HTMLElement | null);
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
