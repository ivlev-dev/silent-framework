import { CustomSelect } from "./custom-select.js";
import { NativeSelect } from "./native-select.js";
import type { SelectProps } from "./types.js";

export type {
  SelectGroup,
  SelectItem,
  SelectOption,
  SelectProps,
  SelectSearchable,
  SelectValue,
  SelectVariant,
} from "./types.js";

/**
 * Список. По умолчанию — кастомная ветка на listbox-движке; `variant="native"`
 * оставляет прежний `<select>` с нативной реконсиляцией `option`.
 */
export function Select(props: SelectProps): Node {
  if (props.variant === "native") return NativeSelect(props);
  return CustomSelect(props);
}
