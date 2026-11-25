import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import type { BoundField, ControlSize } from "../internal/control.js";
import type {
  ListboxGroup,
  ListboxItem,
  ListboxOption,
  ListboxValue,
} from "../internal/listbox-engine.js";

export type SelectValue = ListboxValue;
export type SelectOption = ListboxOption;
export type SelectGroup = ListboxGroup;
export type SelectItem = ListboxItem;
export type SelectVariant = "custom" | "native";
export type SelectSearchable = boolean | "auto";

export interface SelectProps {
  readonly options: readonly SelectItem[];
  /** Значение: строка/число или массив для `multiple`. */
  readonly value?:
    | SelectValue
    | readonly SelectValue[]
    | undefined;
  readonly defaultValue?:
    | SelectValue
    | readonly SelectValue[]
    | undefined;
  readonly onValueChange?:
    | ((value: SelectValue | readonly SelectValue[]) => void)
    | undefined;
  readonly field?:
    | BoundField<string | number | readonly string[]>
    | undefined;
  /** Ветка рендера. По умолчанию `custom`; `native` — прежний `<select>`. */
  readonly variant?: SelectVariant | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly placeholder?: string | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly empty?: Children;
  readonly loadingText?: Children;
  readonly multiple?: boolean | undefined;
  readonly searchable?: SelectSearchable | undefined;
  readonly clearable?: boolean | undefined;
  readonly loading?: boolean | undefined;
  readonly loadOptions?:
    | ((
        query: string,
        signal: AbortSignal,
      ) => Promise<readonly SelectItem[]>)
    | undefined;
  readonly renderOption?: ((option: SelectOption) => Children) | undefined;
  readonly renderValue?:
    | ((options: readonly SelectOption[]) => Children)
    | undefined;
  readonly maxVisible?: number | undefined;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly size?: ControlSize | undefined;
  readonly bare?: boolean | undefined;
  readonly describedBy?: string | undefined;
  /** Доступное имя, если видимой подписи нет. */
  readonly ariaLabel?: string | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}
