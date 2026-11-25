import { createContext } from "@ivlev-dev/silent-core";
import type { DndContextValue } from "./types.js";

/**
 * Контекст перетаскивания. Значение по умолчанию — `null`, поэтому
 * `useDndContext()` может отличить отсутствие провайдера от пустого состояния.
 */
export const dndContext = createContext<DndContextValue | null>({
  name: "DndContext",
  defaultValue: null,
});

/** Текущее значение контекста `DndContext`. */
export function useDndContext(): DndContextValue {
  const value = dndContext.tryGet();
  if (value === null || value === undefined) {
    throw new Error(
      "useDndContext: хук вызван вне <DndContext>. "
        + "Оберните компонент в <DndContext> или используйте DragOverlay/SortableContext внутри него.",
    );
  }
  return value;
}
