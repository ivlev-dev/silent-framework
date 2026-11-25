import { createSignal, onCleanup } from "@ivlev-dev/silent-reactivity";
import { rectSortingStrategy } from "../core/sortable.js";
import type { ClientRect, Transform, UniqueIdentifier } from "../core/types.js";
import { clientEffect } from "../runtime/dom.js";
import { useDndContext } from "../runtime/context.js";
import { useSortableContext } from "../runtime/sortable-context.js";
import type {
  SortableEntry,
  UseSortableArguments,
  UseSortableReturn,
} from "../runtime/types.js";
import { useDraggable } from "./use-draggable.js";
import { useDroppable } from "./use-droppable.js";

/**
 * Комбинированный хук сортируемого элемента: draggable + droppable +
 * стратегия из ближайшего `SortableContext`.
 */
export function useSortable(args: UseSortableArguments): UseSortableReturn {
  const controller = useDndContext();
  const sortable = useSortableContext();
  const draggable = useDraggable(args);
  const droppable = useDroppable({
    id: args.id,
    ...(args.data === undefined ? {} : { data: args.data }),
    ...(args.disabled === undefined ? {} : { disabled: args.disabled }),
  });
  const [sortTransform, setSortTransform] = createSignal<Transform | null>(null);

  const id = args.id;
  const items = (): readonly UniqueIdentifier[] =>
    sortable?.items() ?? [id];
  const strategy = () =>
    args.strategy ?? sortable?.strategy() ?? rectSortingStrategy;
  const index = (): number => items().indexOf(id);
  const isDragging = (): boolean => controller.active()?.id === id;
  const isSorting = (): boolean => {
    const active = controller.active();
    return active !== null && items().includes(active.id);
  };
  const isOver = (): boolean => controller.over()?.id === id;
  const newIndex = (): number => {
    const over = controller.over();
    if (over === null) {
      return index();
    }
    const found = items().indexOf(over.id);
    return found === -1 ? index() : found;
  };
  const transform = (): Transform | null =>
    isDragging() ? draggable.transform() : sortTransform();
  const rect = (): ClientRect | null => droppable.rect();

  clientEffect(() => {
    if (sortable === null) {
      return;
    }
    const entry: SortableEntry = {
      id,
      items,
      strategy,
      disabled: () => args.disabled === true || sortable.disabled(),
      setTransform: setSortTransform,
    };
    const unregister = controller.registerSortable(entry);
    onCleanup(unregister);
  });

  const setNodeRef = (node: HTMLElement | null): void => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };

  const transition = (): string | null =>
    args.transition ?? (isSorting() && !isDragging() ? "transform 200ms ease" : null);

  return {
    ...draggable,
    ...droppable,
    setNodeRef,
    setDroppableNodeRef: droppable.setNodeRef,
    setDraggableNodeRef: draggable.setNodeRef,
    transform,
    isDragging,
    isOver,
    rect,
    index,
    items,
    newIndex,
    isSorting,
    wasDragging: isDragging,
    transition,
    data: draggable.data as UseSortableReturn["data"],
  };
}
