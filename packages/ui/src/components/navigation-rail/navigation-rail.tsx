import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createSignal } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { KeyedList } from "../../internal/keyed-list.js";
import { resolveSlot } from "../../internal/slot.js";
import { useUiConfig } from "../../theme/config.js";

export interface NavigationRailItemData {
  readonly key: string;
  readonly label: Children;
  /** Ленивый слот для SSR: `icon: () => <MenuIcon />`. */
  readonly icon?: Children;
  /** Счётчик/точка в углу иконки; для JSX используйте `() => …`. */
  readonly badge?: Children;
  readonly badgeLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly href?: string | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
}

export interface NavigationRailItemProps {
  readonly label: Children;
  readonly icon?: Children;
  readonly selected?: boolean | undefined;
  readonly badge?: Children;
  readonly badgeLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly href?: string | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Пункт боковой навигации. Подпись всегда в DOM; в свёрнутом рейле её
 * визуально скрывает CSS, поэтому скринридер читает пункт одинаково.
 */
export function NavigationRailItem(props: NavigationRailItemProps): Node {
  const selected = props.selected === true;
  const disabled = props.disabled === true;

  const activate = (event: MouseEvent): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    props.onClick?.(event);
  };

  if (props.href !== undefined) {
    return (
      <li
        {...props.attrs}
        ref={props.ref}
        class={["sui-navigation-rail__item", props.class]}
        style={props.style}
        data-selected={selected ? "" : undefined}
        data-disabled={disabled ? "" : undefined}
      >
        <a
          class="sui-navigation-rail__link"
          href={props.href}
          data-selected={selected ? "" : undefined}
          aria-current={selected ? "page" : undefined}
          aria-disabled={disabled ? "true" : undefined}
          tabindex={disabled ? -1 : undefined}
          onClick={activate}
        >
          <span class="sui-navigation-rail__icon">
            <span class="sui-navigation-rail__icon-glyph" aria-hidden="true">
              {resolveSlot(props.icon)}
            </span>
            {props.badge !== undefined && props.badge !== null ? (
              <span class="sui-navigation-rail__badge" aria-label={props.badgeLabel}>
                {resolveSlot(props.badge)}
              </span>
            ) : null}
          </span>
          <span class="sui-navigation-rail__label">{resolveSlot(props.label)}</span>
        </a>
      </li>
    );
  }

  return (
    <li
      {...props.attrs}
      ref={props.ref}
      class={["sui-navigation-rail__item", props.class]}
      style={props.style}
      data-selected={selected ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
    >
      <button
        class="sui-navigation-rail__button"
        type="button"
        data-selected={selected ? "" : undefined}
        aria-current={selected ? "page" : undefined}
        disabled={disabled}
        onClick={activate}
      >
        <span class="sui-navigation-rail__icon">
          <span class="sui-navigation-rail__icon-glyph" aria-hidden="true">
            {resolveSlot(props.icon)}
          </span>
          {props.badge !== undefined && props.badge !== null ? (
            <span class="sui-navigation-rail__badge" aria-label={props.badgeLabel}>
              {resolveSlot(props.badge)}
            </span>
          ) : null}
        </span>
        <span class="sui-navigation-rail__label">{resolveSlot(props.label)}</span>
      </button>
    </li>
  );
}

export interface NavigationRailProps {
  readonly items: readonly NavigationRailItemData[];
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  /** Развёрнутый рейл с подписями; по умолчанию свёрнут. */
  readonly expanded?: boolean | undefined;
  /** Слот FAB вверху рейла. */
  readonly fab?: Children;
  /** Доступное имя навигации. По умолчанию — `Основная навигация`. */
  readonly label?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Боковая навигация планшета/десктопа: свёрнутая (иконки) и развёрнутая
 * (иконки + подписи), слот FAB, `aria-current` у выбранного пункта.
 */
export function NavigationRail(props: NavigationRailProps): Node {
  const config = useUiConfig();
  const [internalValue, setInternalValue] = createSignal<string | undefined>(
    props.defaultValue,
  );

  const currentKey = (): string | undefined => props.value ?? internalValue();

  const select = (key: string): void => {
    if (key === currentKey()) return;
    if (props.value === undefined) setInternalValue(key);
    props.onValueChange?.(key);
  };

  return (
    <nav
      {...props.attrs}
      ref={props.ref}
      class={["sui-navigation-rail", props.class]}
      style={props.style}
      aria-label={props.label ?? config.strings.navigation}
      data-expanded={props.expanded === true ? "" : undefined}
    >
      <Show when={props.fab !== undefined && props.fab !== null}>
        <div class="sui-navigation-rail__fab" data-slot="fab">
          {props.fab}
        </div>
      </Show>
      <ul class="sui-navigation-rail__list">
        <KeyedList each={props.items} keyOf={(item) => item.key}>
          {(item) => (
            <NavigationRailItem
              label={item.label}
              icon={item.icon}
              badge={item.badge}
              badgeLabel={item.badgeLabel}
              disabled={item.disabled}
              href={item.href}
              selected={currentKey() === item.key}
              onClick={(event) => {
                select(item.key);
                item.onClick?.(event);
              }}
            />
          )}
        </KeyedList>
      </ul>
    </nav>
  );
}
