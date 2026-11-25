import { createSignal, onCleanup } from "@ivlev-dev/silent-reactivity";
import { asData, clientEffect } from "../runtime/dom.js";
import { useDndContext } from "../runtime/context.js";
import type { Transform } from "../core/types.js";
import type {
  DraggableAttributeValue,
  DraggableEntry,
  DraggableListeners,
  UseDraggableArguments,
  UseDraggableReturn,
} from "../runtime/types.js";

/**
 * Элемент-источник перетаскивания.
 *
 * Регистрация узла и сенсоров выполняется в `clientEffect`: в SSR никаких
 * измерений и DOM-слушателей не появляется. Возвращаемые `transform`/
 * `isDragging`/`over` — аксессоры, а не снимки состояния.
 */
export function useDraggable(args: UseDraggableArguments): UseDraggableReturn {
  const controller = useDndContext();
  const [node, setNode] = createSignal<HTMLElement | null>(null);
  const [activatorNode, setActivatorNode] = createSignal<HTMLElement | null>(null);
  const [transform, setTransform] = createSignal<Transform | null>(null);
  const id = args.id;

  const data = (): Record<string, unknown> => asData(args.data);
  const disabled = (): boolean => args.disabled === true;
  const isDragging = (): boolean => controller.active()?.id === id;

  const userListeners = args.listeners ?? {};
  const listeners: DraggableListeners = {
    onPointerDown(event: Event): void {
      userListeners.onPointerDown?.(event);
      controller.dispatchActivator(id, "pointerdown", event);
    },
    onKeyDown(event: Event): void {
      userListeners.onKeyDown?.(event);
      controller.dispatchActivator(id, "keydown", event);
    },
  };

  const attributes = {
    role: "button",
    tabindex: 0,
    "aria-disabled": "false",
    "aria-pressed": "false",
    "aria-roledescription": "draggable",
    "aria-describedby": `${controller.id}-instructions`,
    ...(args.attributes ?? {}),
    "data-dnd-id": String(id),
  } as Record<string, DraggableAttributeValue>;

  const setNodeRef = (value: HTMLElement | null): void => {
    setNode(value);
  };
  const setActivatorNodeRef = (value: HTMLElement | null): void => {
    setActivatorNode(value);
  };

  clientEffect(() => {
    const element = node();
    if (element === null) {
      return;
    }
    const pressed = isDragging() ? "true" : "false";
    element.setAttribute("aria-pressed", pressed);
    element.setAttribute("aria-disabled", disabled() ? "true" : "false");
    element.setAttribute("aria-roledescription", controller.ariaRoleDescription());
  });

  clientEffect(() => {
    const element = node();
    if (element === null) {
      return;
    }
    const entry: DraggableEntry = {
      id,
      node,
      activatorNode,
      data,
      disabled,
      setTransform,
    };
    const unregister = controller.registerDraggable(entry);
    const cleanups: Array<() => void> = [];
    for (const descriptor of controller.sensors()) {
      cleanups.push(
        descriptor.sensor.attach(
          controller,
          element,
          descriptor.options ?? {},
          activatorNode(),
        ),
      );
    }
    onCleanup(() => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      unregister();
    });
  });

  return {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    node,
    activatorNode,
    transform,
    isDragging,
    active: controller.active,
    over: controller.over,
    activatorEvent: controller.activatorEvent,
    data,
  };
}
