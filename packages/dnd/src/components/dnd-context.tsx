import type { Children } from "@ivlev-dev/silent-core";
import { Provider, useId } from "@ivlev-dev/silent-core";
import { onCleanup } from "@ivlev-dev/silent-reactivity";
import { KeyboardSensor } from "../sensors/keyboard.js";
import { PointerSensor } from "../sensors/pointer.js";
import { useSensor, useSensors } from "../hooks/use-sensor.js";
import { clientEffect } from "../runtime/dom.js";
import { dndContext } from "../runtime/context.js";
import { createDndController } from "../runtime/controller.js";
import type { DndContextProps } from "../runtime/types.js";

/**
 * Корневой провайдер состояния перетаскивания.
 *
 * Контроллер создаётся в рендере и живёт вместе с компонентом; сенсоры
 * навешиваются на конкретные draggable-узлы после монтирования, поэтому
 * серверный рендер не оставляет глобальных обработчиков.
 */
export function DndContext(props: DndContextProps): Node {
  const generatedId = useId("dnd");
  const contextId = props.id ?? generatedId;
  const defaultSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
  );
  const controller = createDndController({
    id: contextId,
    props,
    defaultSensors,
  });

  clientEffect(() => {
    onCleanup(() => controller.dispose());
  });

  return (
    <Provider context={dndContext} value={controller}>
      {props.children as Children}
      <div
        id={`${contextId}-instructions`}
        class="dnd-sr-instructions"
        style={{ display: "none" }}
      >
        {() => controller.instructions().draggable}
      </div>
      <div
        id={`${contextId}-announcements`}
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        class="dnd-sr-announcements"
      >
        {controller.announcement()}
      </div>
    </Provider>
  );
}
