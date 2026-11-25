import type { Children } from "@ivlev-dev/silent-core";
import { Provider, useId } from "@ivlev-dev/silent-core";
import { rectSortingStrategy } from "../core/sortable.js";
import { sortableContext } from "../runtime/sortable-context.js";
import type {
  SortableContextProps,
  SortableContextValue,
} from "../runtime/types.js";

/** Провайдер сортируемого набора: порядок `items` — источник правды. */
export function SortableContext(props: SortableContextProps): Node {
  const generatedId = useId("sortable");
  const value: SortableContextValue = {
    id: props.id ?? generatedId,
    containerId: props.containerId,
    items: () =>
      typeof props.items === "function" ? props.items() : props.items,
    strategy: () => props.strategy ?? rectSortingStrategy,
    disabled: () => props.disabled === true,
  };
  return (
    <Provider context={sortableContext} value={value}>
      {props.children as Children}
    </Provider>
  );
}
