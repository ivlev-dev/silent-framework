import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type FabVariant = "primary" | "secondary" | "tertiary" | "surface";
export type FabSize = "sm" | "md" | "lg";

/**
 * Позиционирование задаёт потребитель: `position` ставит только
 * `data-position` и `position: absolute` внутри позиционированного
 * контейнера. Глобального `position: fixed` компонент не навязывает.
 */
export type FabPosition =
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

interface FabCommonProps {
  readonly variant?: FabVariant | undefined;
  readonly size?: FabSize | undefined;
  readonly position?: FabPosition | undefined;
  /** Глиф. Для icon-only допустим и `children` (см. ниже). */
  readonly icon?: Children;
  /** Глиф-фолбэк: `<Fab ariaLabel="Добавить"><AddIcon /></Fab>`. */
  readonly children?: Children;
  readonly disabled?: boolean | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Расширенная FAB обязана иметь видимую подпись, icon-only — `ariaLabel`:
 * компилятор не даст собрать безымянную кнопку.
 */
export type FabProps = FabCommonProps &
  (
    | {
        readonly extended: true;
        readonly label: Children;
        readonly ariaLabel?: string | undefined;
      }
    | {
        readonly extended?: false | undefined;
        /** В icon-only режиме обязателен: иначе кнопка безымянная. */
        readonly ariaLabel: string;
        readonly label?: undefined;
      }
  );

/**
 * FloatingActionButton (M3): primary/secondary/tertiary/surface, три размера,
 * extended-режим с подписью. Нажатие блокируется при `disabled`.
 */
export function Fab(props: FabProps): Node {
  const extended = props.extended === true;
  const label: Children = props.extended === true ? props.label : undefined;
  const glyph: Children = props.icon ?? props.children;

  return (
    <button
      {...props.attrs}
      ref={props.ref}
      class={["sui-fab", props.class]}
      style={props.style}
      type="button"
      data-variant={props.variant ?? "primary"}
      data-size={props.size ?? "md"}
      data-extended={extended ? "" : undefined}
      data-position={props.position}
      aria-label={props.ariaLabel}
      disabled={props.disabled === true}
      onClick={(event) => {
        if (props.disabled === true) return;
        props.onClick?.(event);
      }}
    >
      <span class="sui-fab__icon" data-slot="icon" aria-hidden="true">
        {glyph}
      </span>
      <Show when={extended}>
        <span class="sui-fab__label">{label}</span>
      </Show>
    </button>
  );
}
