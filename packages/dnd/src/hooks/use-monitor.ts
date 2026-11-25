import { onCleanup } from "@ivlev-dev/silent-reactivity";
import { clientEffect } from "../runtime/dom.js";
import { useDndContext } from "../runtime/context.js";
import type { DndMonitorListener } from "../runtime/types.js";

/**
 * Подписка на события текущего `DndContext` без участия в перетаскивании.
 * Подписка снимается при размонтировании компонента.
 */
export function useDndMonitor(listener: DndMonitorListener): void {
  const controller = useDndContext();
  clientEffect(() => {
    const unregister = controller.registerMonitor(listener);
    onCleanup(unregister);
  });
}
