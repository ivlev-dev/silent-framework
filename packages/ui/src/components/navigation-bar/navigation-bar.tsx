import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { createSignal } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { KeyedList } from "../../internal/keyed-list.js";
import { resolveSlot } from "../../internal/slot.js";
import { useUiConfig } from "../../theme/config.js";

export interface NavigationBarItemData {
  readonly key: string;
  readonly label: Children;
  /** Ленивый слот для SSR: `icon: () => <MenuIcon />`. */
  readonly icon?: Children;
  /** Счётчик/точка в углу иконки; для JSX используйте `() => …`. */
  readonly badge?: Children;
  /** Доступное имя бейджа, если визуального текста недостаточно. */
  readonly badgeLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly href?: string | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
}

export interface NavigationBarItemProps {
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
 * Пункт мобильной навигации. Возвращает `<li>`: ссылка при `href`,
 * иначе кнопка. Выбранный пункт получает `aria-current="page"`.
 */
export function NavigationBarItem(props: NavigationBarItemProps): Node {
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
        class={["sui-navigation-bar__item", props.class]}
        style={props.style}
        data-selected={selected ? "" : undefined}
        data-disabled={disabled ? "" : undefined}
      >
        <a
          class="sui-navigation-bar__link"
          href={props.href}
          data-selected={selected ? "" : undefined}
          aria-current={selected ? "page" : undefined}
          aria-disabled={disabled ? "true" : undefined}
          tabindex={disabled ? -1 : undefined}
          onClick={activate}
        >
          <span class="sui-navigation-bar__icon">
            <span class="sui-navigation-bar__icon-glyph" aria-hidden="true">
              {resolveSlot(props.icon)}
            </span>
            {props.badge !== undefined && props.badge !== null ? (
              <span class="sui-navigation-bar__badge" aria-label={props.badgeLabel}>
                {resolveSlot(props.badge)}
              </span>
            ) : null}
          </span>
          <span class="sui-navigation-bar__label">{resolveSlot(props.label)}</span>
        </a>
      </li>
    );
  }

  return (
    <li
      {...props.attrs}
      ref={props.ref}
      class={["sui-navigation-bar__item", props.class]}
      style={props.style}
      data-selected={selected ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
    >
      <button
        class="sui-navigation-bar__button"
        type="button"
        data-selected={selected ? "" : undefined}
        aria-current={selected ? "page" : undefined}
        disabled={disabled}
        onClick={activate}
      >
        <span class="sui-navigation-bar__icon">
          <span class="sui-navigation-bar__icon-glyph" aria-hidden="true">
            {resolveSlot(props.icon)}
          </span>
          {props.badge !== undefined && props.badge !== null ? (
            <span class="sui-navigation-bar__badge" aria-label={props.badgeLabel}>
              {resolveSlot(props.badge)}
            </span>
          ) : null}
        </span>
        <span class="sui-navigation-bar__label">{resolveSlot(props.label)}</span>
      </button>
    </li>
  );
}

export interface NavigationBarProps {
  /** 3–5 пунктов; больше — визуально ломает нижнюю панель. */
  readonly items: readonly NavigationBarItemData[];
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  /** Доступное имя навигации. По умолчанию — `Основная навигация`. */
  readonly label?: string | undefined;
  /** Учитывать `safe-area-inset-bottom` (по умолчанию `true`). */
  readonly safeArea?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Нижняя навигация мобильного приложения: 3–5 пунктов, видимые подписи,
 * бейджи, `aria-current` у выбранного.
 */
export function NavigationBar(props: NavigationBarProps): Node {
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
      class={["sui-navigation-bar", props.class]}
      style={props.style}
      aria-label={props.label ?? config.strings.navigation}
      data-safe-area={props.safeArea === false ? undefined : ""}
    >
      <ul class="sui-navigation-bar__list">
        <KeyedList each={props.items} keyOf={(item) => item.key}>
          {(item) => (
            <NavigationBarItem
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
