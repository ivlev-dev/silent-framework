import { createSignal, onCleanup } from "@ivlev-dev/silent-reactivity";
import { asData, clientEffect } from "../runtime/dom.js";
import { useDndContext } from "../runtime/context.js";
import type { ClientRect } from "../core/types.js";
import type {
  DroppableEntry,
  UseDroppableArguments,
  UseDroppableReturn,
} from "../runtime/types.js";

/** Элемент-цель перетаскивания: регистрирует DOM-узел и его прямоугольник. */
export function useDroppable(args: UseDroppableArguments): UseDroppableReturn {
  const controller = useDndContext();
  const [node, setNode] = createSignal<HTMLElement | null>(null);
  const [rect, setRect] = createSignal<ClientRect | null>(null);
  const id = args.id;

  const data = (): Record<string, unknown> => asData(args.data);
  const disabled = (): boolean => args.disabled === true;
  const isOver = (): boolean => controller.over()?.id === id;

  const setNodeRef = (value: HTMLElement | null): void => {
    setNode(value);
  };

  clientEffect(() => {
    const element = node();
    if (element === null) {
      return;
    }
    const entry: DroppableEntry = {
      id,
      node,
      data,
      disabled,
      rect,
      setRect,
    };
    const unregister = controller.registerDroppable(entry);
    onCleanup(unregister);
  });

  return {
    setNodeRef,
    node,
    rect,
    isOver,
    active: controller.active,
    over: controller.over,
    data,
  };
}
