import { createContext } from "@ivlev-dev/silent-core";
import type { SortableContextValue } from "./types.js";

/**
 * Контекст сортируемого набора. Вложенные `SortableContext` перекрывают
 * внешние, поэтому вложенные списки работают без дополнительной настройки.
 */
export const sortableContext = createContext<SortableContextValue | null>({
  name: "SortableContext",
  defaultValue: null,
});

export function useSortableContext(): SortableContextValue | null {
  return sortableContext.tryGet() ?? null;
}
