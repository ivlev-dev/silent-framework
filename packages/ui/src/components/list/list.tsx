import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type ListItemRole = "option" | "button" | "link";

export interface ListProps {
  /** `role="listbox"`: включает выбор элементов (`ListItem.selected`). */
  readonly selectable?: boolean | undefined;
  /** Разделители между всеми элементами. */
  readonly divider?: boolean | undefined;
  /** Плотный режим: меньше вертикальные отступы. */
  readonly dense?: boolean | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

export interface ListItemProps {
  readonly selected?: boolean | undefined;
  readonly interactive?: boolean | undefined;
  readonly current?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Слот слева: аватар, иконка, чекбокс. */
  readonly leading?: Children;
  /** Слот справа: бейдж, иконка, метаданные. */
  readonly trailing?: Children;
  /** Разделитель сверху у конкретного элемента. */
  readonly divider?: boolean | undefined;
  /** Обрезка длинного текста по строкам (1–3). */
  readonly lines?: 1 | 2 | 3 | undefined;
  /** Переопределение роли (по умолчанию: `option` при `selected`, иначе `button`). */
  readonly role?: ListItemRole | undefined;
  readonly onClick?: ((event: MouseEvent | KeyboardEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/** Список. `role="listbox"` ставится только по явному `selectable`. */
export function List(props: ListProps): Node {
  return (
    <ul
      {...props.attrs}
      ref={props.ref}
      class={["sui-list", props.class]}
      style={props.style}
      role={props.selectable === true ? "listbox" : undefined}
      data-divider={props.divider === true ? "" : undefined}
      data-dense={props.dense === true ? "" : undefined}
    >
      {props.children}
    </ul>
  );
}

/**
 * Строка списка. Интерактивная строка активируется Enter/Space, `selected`
 * даёт `aria-selected`, `current` — `aria-current="page"`. Компонент не
 * владеет списком и спокойно живёт внутри `For` c `keyOf`.
 */
export function ListItem(props: ListItemProps): Node {
  const interactive = props.interactive === true;
  const disabled = props.disabled === true;
  const active = interactive && !disabled;
  const role =
    props.role ?? (props.selected !== undefined ? "option" : interactive ? "button" : undefined);

  return (
    <li
      {...props.attrs}
      ref={props.ref}
      class={["sui-list-item", props.class]}
      style={props.style}
      role={role}
      tabindex={active ? 0 : undefined}
      data-interactive={interactive ? "" : undefined}
      data-selected={props.selected === true ? "" : undefined}
      data-current={props.current === true ? "" : undefined}
      data-lines={props.lines}
      data-divider={props.divider === true ? "" : undefined}
      aria-selected={props.selected === undefined ? undefined : props.selected ? "true" : "false"}
      aria-current={props.current === true ? "page" : undefined}
      aria-disabled={disabled ? "true" : undefined}
      onClick={(event) => {
        if (!active) return;
        props.onClick?.(event);
      }}
      onKeyDown={(event) => {
        if (!active) return;
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          props.onClick?.(event);
        }
      }}
    >
      <span class="sui-list-item__leading" data-slot="leading">
        {props.leading}
      </span>
      <span class="sui-list-item__content">{props.children}</span>
      <span class="sui-list-item__trailing" data-slot="trailing">
        {props.trailing}
      </span>
    </li>
  );
}
