import { createSignal } from "@ivlev-dev/silent-reactivity";
import { applyTransform, getCenter, getClientRect } from "../core/geometry.js";
import { closestCenter } from "../core/collisions.js";
import { applyModifiers } from "../core/modifiers.js";
import type {
  Active,
  ClientRect,
  Collision,
  CollisionDetection,
  Coordinates,
  DragAbortEvent,
  DragCancelEvent,
  DragEndEvent,
  DragEventBase,
  DragMoveEvent,
  DragOverEvent,
  DragPendingEvent,
  DragStartEvent,
  DroppableContainer,
  ModifierArgs,
  Modifiers,
  Over,
  ScreenReaderInstructions,
  SortingStrategy,
  Transform,
  UniqueIdentifier,
} from "../core/types.js";
import {
  resolveAnnouncements,
  resolveInstructions,
} from "../a11y/defaults.js";
import { createAutoScroll, type AutoScrollHandle } from "./auto-scroll.js";
import {
  findScrollableAncestor,
  getWindowRect,
  measureElement,
} from "./dom.js";
import {
  MeasuringFrequency,
  MeasuringStrategy,
  type AccessibilityOptions,
  type DndContextProps,
  type DndContextValue,
  type DragResult,
  type DragStatus,
  type DraggableEntry,
  type DroppableEntry,
  type DndMonitorListener,
  type PendingDrag,
  type SensorDescriptor,
  type SortableEntry,
} from "./types.js";

interface ActivatorHandler {
  readonly eventType: string;
  readonly handler: (event: Event) => void;
}

interface FocusSnapshot {
  readonly id: UniqueIdentifier;
  readonly node: HTMLElement | null;
  readonly activatorNode: HTMLElement | null;
}

export interface DndControllerOptions {
  readonly id: string;
  readonly props: DndContextProps;
  readonly defaultSensors: readonly SensorDescriptor[];
}

const ZERO_TRANSFORM: Transform = Object.freeze({ x: 0, y: 0 });
const ZERO_COORDINATES: Coordinates = Object.freeze({ x: 0, y: 0 });

function changedOver(
  previous: Over | null,
  next: Over | null,
): boolean {
  return (previous?.id ?? null) !== (next?.id ?? null);
}

/**
 * Замыкание-контроллер `DndContext`: сигналы состояния, реестры узлов,
 * шина мониторов и методы, которыми пользуются сенсоры и хуки.
 *
 * Контроллер не создаёт обработчиков на уровне модуля; все DOM-слушатели
 * живут в сенсорах, привязанных к конкретным узлам, и снимаются их `cleanup`.
 */
export function createDndController(
  options: DndControllerOptions,
): DndContextValue {
  const { id, props } = options;

  const [active, setActive] = createSignal<Active | null>(null);
  const [over, setOver] = createSignal<Over | null>(null);
  const [collisions, setCollisions] = createSignal<Collision[] | null>(null);
  const [activatorEvent, setActivatorEvent] = createSignal<Event | null>(null);
  const [pending, setPendingState] = createSignal<PendingDrag | null>(null);
  const [status, setStatus] = createSignal<DragStatus>("idle");
  const [activeTransform, setActiveTransform] = createSignal<Transform>(ZERO_TRANSFORM);
  const [announcement, setAnnouncement] = createSignal("");
  const [overlayVisible, setOverlayVisible] = createSignal(false);
  const [overlaySource, setOverlaySource] = createSignal<Active | null>(null);
  const [overlayTransform, setOverlayTransform] = createSignal<Transform>(ZERO_TRANSFORM);
  const [dragResult, setDragResult] = createSignal<DragResult | null>(null);

  const draggables = new Map<UniqueIdentifier, DraggableEntry>();
  const droppables = new Map<UniqueIdentifier, DroppableEntry>();
  const sortables = new Map<UniqueIdentifier, SortableEntry>();
  const monitors = new Set<DndMonitorListener>();
  const activators = new Map<UniqueIdentifier, ActivatorHandler[]>();
  const handledEvents = new WeakSet<Event>();
  let measuredRects = new Map<UniqueIdentifier, ClientRect>();

  let activeEntry: DraggableEntry | null = null;
  let initialCoordinates: Coordinates = ZERO_COORDINATES;
  let rawTransform: Transform = ZERO_TRANSFORM;
  let pointerCoordinates: Coordinates | null = null;
  let lastScrollSignature = "";
  let restoreFocusTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const sensors = (): readonly SensorDescriptor[] =>
    props.sensors ?? options.defaultSensors;
  const modifierList = (): Modifiers => props.modifiers ?? [];
  const collisionDetection = (): CollisionDetection =>
    props.collisionDetection ?? closestCenter;
  const accessibility = (): AccessibilityOptions => props.accessibility ?? {};
  const announcements = () => resolveAnnouncements(accessibility().announcements);
  const instructions = (): ScreenReaderInstructions =>
    resolveInstructions(accessibility().screenReaderInstructions);

  const autoScroll: AutoScrollHandle = createAutoScroll({
    getActiveNode: () => activeEntry?.node() ?? null,
    getPointer: () => pointerCoordinates,
    getActiveRect: () => {
      const current = active();
      if (current?.rect === null || current === null) {
        return null;
      }
      return applyTransform(current.rect, activeTransform());
    },
    getOptions: () => props.autoScroll,
  });

  function measureDroppables(): Map<UniqueIdentifier, ClientRect> {
    const next = new Map<UniqueIdentifier, ClientRect>();
    for (const entry of droppables.values()) {
      const rect = measureElement(entry.node());
      entry.setRect(rect);
      if (rect !== null) {
        next.set(entry.id, rect);
      }
    }
    measuredRects = next;
    return next;
  }

  function scrollSignature(): string {
    const node = activeEntry?.node() ?? null;
    if (node === null || typeof document === "undefined") {
      return "";
    }
    const parts: string[] = [];
    let current: Element | null = node;
    while (current !== null) {
      const scroll = current as Element & {
        scrollTop?: number;
        scrollLeft?: number;
      };
      if (typeof scroll.scrollTop === "number" || typeof scroll.scrollLeft === "number") {
        parts.push(`${scroll.scrollTop ?? 0}:${scroll.scrollLeft ?? 0}`);
      }
      current = current.parentElement;
    }
    const root = document.scrollingElement;
    if (root !== null && root !== undefined) {
      parts.push(`${root.scrollTop}:${root.scrollLeft}`);
    }
    return parts.join("|");
  }

  function shouldMeasureDroppables(initial: boolean): boolean {
    const settings = props.measuring?.droppable;
    const strategy = settings?.strategy ?? MeasuringStrategy.WhileDragging;
    if (initial) {
      lastScrollSignature = scrollSignature();
      return true;
    }
    if (strategy === MeasuringStrategy.BeforeDragging) {
      return false;
    }
    if (strategy === MeasuringStrategy.Always) {
      return true;
    }
    const frequency = settings?.frequency ?? MeasuringFrequency.Optimized;
    if (frequency === MeasuringFrequency.Always) {
      return true;
    }
    const signature = scrollSignature();
    if (signature !== lastScrollSignature) {
      lastScrollSignature = signature;
      return true;
    }
    return false;
  }

  function resolveOver(collisionsNow: readonly Collision[]): Over | null {
    const first = collisionsNow[0];
    if (first === undefined) {
      return null;
    }
    const entry = droppables.get(first.id);
    if (entry === undefined) {
      return null;
    }
    return {
      id: entry.id,
      data: entry.data(),
      rect: measuredRects.get(entry.id) ?? entry.rect(),
      disabled: entry.disabled(),
    };
  }

  function scrollableAncestorRect(): ClientRect | undefined {
    const node = activeEntry?.node() ?? null;
    if (node === null) {
      return undefined;
    }
    const ancestor = findScrollableAncestor(node.parentElement);
    if (ancestor === null) {
      return undefined;
    }
    return measureElement(ancestor) ?? undefined;
  }

  function buildModifierArgs(
    transform: Transform,
    current: Active,
    previousOver: Over | null,
    event: Event | null,
  ): ModifierArgs {
    const args: ModifierArgs = {
      transform,
      draggingNodeRect: current.rect,
      activatorEvent: event,
      active: current,
      over: previousOver,
    };
    if (pointerCoordinates !== null) {
      args.pointerCoordinates = pointerCoordinates;
    }
    const parent = activeEntry?.node()?.parentElement ?? null;
    const containerRect = measureElement(parent);
    if (containerRect !== null) {
      args.containerRect = containerRect;
    }
    const scrollRect = scrollableAncestorRect();
    if (scrollRect !== undefined) {
      args.scrollableAncestorRect = scrollRect;
    }
    const windowRect = getWindowRect();
    if (windowRect !== null) {
      args.windowRect = windowRect;
    }
    return args;
  }

  function buildDroppableContainers(): DroppableContainer[] {
    const result: DroppableContainer[] = [];
    for (const entry of droppables.values()) {
      result.push({
        id: entry.id,
        data: entry.data(),
        disabled: entry.disabled(),
        rect: measuredRects.get(entry.id) ?? entry.rect(),
      });
    }
    return result;
  }

  function applySortableTransforms(
    current: Active,
    currentOver: Over | null,
    rects: ReadonlyMap<UniqueIdentifier, ClientRect>,
  ): void {
    const overId = currentOver?.id;
    for (const entry of sortables.values()) {
      const items = entry.items();
      const index = items.indexOf(entry.id);
      const activeIndex = items.indexOf(current.id);
      const overIndex = overId === undefined ? -1 : items.indexOf(overId);
      if (
        entry.id === current.id
        || index === -1
        || activeIndex === -1
        || overIndex === -1
        || entry.disabled()
      ) {
        entry.setTransform(null);
        continue;
      }
      const itemRects = items.map((itemId) => {
        const fromMap = rects.get(itemId);
        if (fromMap !== undefined) {
          return fromMap;
        }
        return droppables.get(itemId)?.rect() ?? null;
      });
      const activeNodeRect = itemRects[activeIndex]
        ?? current.rect
        ?? null;
      const overRect = itemRects[overIndex] ?? currentOver?.rect ?? null;
      const strategy: SortingStrategy = entry.strategy();
      const transform = strategy({
        activeIndex,
        overIndex,
        index,
        rects: itemRects,
        activeNodeRect,
        overRect,
      });
      entry.setTransform(transform);
    }
  }

  function createEventBase(
    current: Active,
    currentOver: Over | null,
    delta: Transform,
    collisionsNow: Collision[] | null,
    event: Event | null,
  ): DragEventBase {
    return {
      active: current,
      over: currentOver,
      delta,
      collisions: collisionsNow,
      activatorEvent: event,
    };
  }

  function announce(
    kind: "start" | "move" | "over" | "end" | "cancel",
    event: DragEventBase,
  ): void {
    const set = announcements();
    let message: string | undefined;
    if (kind === "start") {
      message = set.onDragStart(event as DragStartEvent);
    } else if (kind === "move") {
      message = set.onDragMove?.(event as DragMoveEvent);
    } else if (kind === "over") {
      message = set.onDragOver?.(event as DragOverEvent);
    } else if (kind === "end") {
      message = set.onDragEnd?.(event as DragEndEvent);
    } else {
      message = set.onDragCancel?.(event as DragCancelEvent);
    }
    if (typeof message === "string" && message.length > 0) {
      setAnnouncement(message);
    }
  }

  function notifyMonitor(
    kind: "start" | "move" | "over" | "end" | "cancel" | "pending" | "abort",
    event: DragEventBase,
  ): void {
    if (kind === "start") {
      props.onDragStart?.(event as DragStartEvent);
      for (const listener of monitors) {
        listener.onDragStart?.(event as DragStartEvent);
      }
      return;
    }
    if (kind === "move") {
      props.onDragMove?.(event as DragMoveEvent);
      for (const listener of monitors) {
        listener.onDragMove?.(event as DragMoveEvent);
      }
      return;
    }
    if (kind === "over") {
      props.onDragOver?.(event as DragOverEvent);
      for (const listener of monitors) {
        listener.onDragOver?.(event as DragOverEvent);
      }
      return;
    }
    if (kind === "end") {
      props.onDragEnd?.(event as DragEndEvent);
      for (const listener of monitors) {
        listener.onDragEnd?.(event as DragEndEvent);
      }
      return;
    }
    if (kind === "cancel") {
      props.onDragCancel?.(event as DragCancelEvent);
      for (const listener of monitors) {
        listener.onDragCancel?.(event as DragCancelEvent);
      }
      return;
    }
    if (kind === "pending") {
      props.onDragPending?.(event as DragPendingEvent);
      for (const listener of monitors) {
        listener.onDragPending?.(event as DragPendingEvent);
      }
      return;
    }
    props.onDragAbort?.(event as DragAbortEvent);
    for (const listener of monitors) {
      listener.onDragAbort?.(event as DragAbortEvent);
    }
  }

  function computeFrame(
    transform: Transform,
    emitMove: boolean,
    emitOver: boolean,
    currentEvent: Event | null = null,
  ): DragEventBase | null {
    const current = active();
    if (current === null || activeEntry === null) {
      return null;
    }
    if (shouldMeasureDroppables(false)) {
      measureDroppables();
    }
    const previousOver = over();
    const modified = applyModifiers(
      modifierList(),
      buildModifierArgs(transform, current, previousOver, currentEvent ?? activatorEvent()),
    );
    activeEntry.setTransform(modified);
    setActiveTransform(modified);
    setOverlayTransform(modified);

    const collisionRect = current.rect === null
      ? getClientRect({
          left: pointerCoordinates?.x ?? 0,
          top: pointerCoordinates?.y ?? 0,
          width: 1,
          height: 1,
        })
      : applyTransform(current.rect, modified);
    const droppableContainers = buildDroppableContainers();
    const collisionsNow = collisionDetection()({
      active: current,
      collisionRect,
      droppableRects: measuredRects,
      droppableContainers,
      pointerCoordinates: pointerCoordinates,
    });
    const nextOver = resolveOver(collisionsNow);
    setCollisions(collisionsNow);
    setOver(nextOver);
    applySortableTransforms(current, nextOver, measuredRects);

    const event = createEventBase(
      current,
      nextOver,
      modified,
      collisionsNow,
      currentEvent ?? activatorEvent(),
    );
    if (emitMove) {
      announce("move", event);
      notifyMonitor("move", event);
    }
    if (emitOver && changedOver(previousOver, nextOver)) {
      announce("over", event);
      notifyMonitor("over", event);
    }
    return event;
  }

  function clearTransforms(): void {
    for (const entry of draggables.values()) {
      entry.setTransform(null);
    }
    for (const entry of sortables.values()) {
      entry.setTransform(null);
    }
  }

  function captureFocus(
    entry: DraggableEntry,
    id: UniqueIdentifier,
  ): FocusSnapshot {
    return {
      id,
      node: entry.node(),
      activatorNode: entry.activatorNode(),
    };
  }

  function focusElement(node: HTMLElement | null): void {
    if (node === null) {
      return;
    }
    const focus = (node as { focus?: unknown }).focus;
    if (typeof focus === "function") {
      (focus as (options?: FocusOptions) => void).call(node, { preventScroll: true });
    }
  }

  function findNodeByDataId(id: UniqueIdentifier): HTMLElement | null {
    if (typeof document === "undefined") {
      return null;
    }
    const expected = String(id);
    const candidates = document.querySelectorAll<HTMLElement>("[data-dnd-id]");
    for (const candidate of candidates) {
      if (
        candidate.isConnected
        && candidate.getAttribute("data-dnd-id") === expected
      ) {
        return candidate;
      }
    }
    return null;
  }

  function resolveFocusNode(snapshot: FocusSnapshot): HTMLElement | null {
    const preferred = snapshot.activatorNode ?? snapshot.node;
    if (preferred !== null && preferred.isConnected) {
      return preferred;
    }
    const registered = draggables.get(snapshot.id)?.node() ?? null;
    if (registered !== null && registered.isConnected) {
      return registered;
    }
    const found = findNodeByDataId(snapshot.id);
    if (found !== null) {
      return found;
    }
    // Fallback — старый узел: `focus()` на отключённом узле безопасен и
    // сохраняет поведение для окружений без `data-dnd-id`.
    return preferred;
  }

  function applyFocusRestore(snapshot: FocusSnapshot, cancelled: boolean): void {
    if (accessibility().restoreFocus === false || typeof document === "undefined") {
      return;
    }
    const focused = document.activeElement;
    const focusReturned = focused instanceof HTMLElement
      && focused !== document.body
      && focused !== document.documentElement
      && focused.isConnected;
    if (cancelled && focusReturned) {
      return;
    }
    const target = resolveFocusNode(snapshot);
    if (target === null) {
      return;
    }
    if (focused === target || target.contains(focused)) {
      return;
    }
    focusElement(target);
  }

  function clearScheduledFocus(): void {
    if (restoreFocusTimer !== null) {
      clearTimeout(restoreFocusTimer);
      restoreFocusTimer = null;
    }
  }

  /**
   * Фокус возвращается отдельной задачей после синхронных `onDragEnd`/
   * `onDragCancel` и flush: при controlled-reorder приложение успевает
   * заменить DOM-узлы, и старый узел уже отключён.
   */
  function scheduleFocusRestore(
    snapshot: FocusSnapshot | null,
    cancelled: boolean,
  ): void {
    clearScheduledFocus();
    if (snapshot === null || accessibility().restoreFocus === false) {
      return;
    }
    restoreFocusTimer = setTimeout(() => {
      restoreFocusTimer = null;
      if (disposed || active() !== null) {
        return;
      }
      applyFocusRestore(snapshot, cancelled);
    }, 0);
  }

  function finish(
    result: DragResult,
    cancelled: boolean,
    snapshot: FocusSnapshot | null,
  ): void {
    autoScroll.stop();
    clearTransforms();
    setPendingState(null);
    setStatus("idle");
    setActive(null);
    setOver(null);
    setCollisions(null);
    setActivatorEvent(null);
    setActiveTransform(ZERO_TRANSFORM);
    activeEntry = null;
    rawTransform = ZERO_TRANSFORM;
    initialCoordinates = ZERO_COORDINATES;
    pointerCoordinates = null;
    setDragResult(result);
    if (cancelled) {
      setOverlayVisible(false);
      setOverlaySource(null);
      setOverlayTransform(ZERO_TRANSFORM);
    }
    scheduleFocusRestore(snapshot, cancelled);
  }

  function finishCancel(
    event: DragEventBase,
    snapshot?: FocusSnapshot | null,
  ): void {
    const focusSnapshot = snapshot
      ?? (activeEntry === null ? null : captureFocus(activeEntry, event.active.id));
    announce("cancel", event);
    notifyMonitor("cancel", event);
    finish(
      { active: event.active, over: event.over, cancelled: true },
      true,
      focusSnapshot,
    );
  }

  const value: DndContextValue = {
    id,
    active,
    over,
    collisions,
    activatorEvent,
    pending,
    status,
    activeTransform,
    announcement,
    instructions,
    ariaRoleDescription: () => accessibility().ariaRoleDescription ?? "draggable",
    overlayVisible,
    overlaySource,
    overlayTransform,
    dragResult,
    sensors,
    droppableContainers: () => buildDroppableContainers(),
    droppableRects: () => measuredRects,
    windowRect: () => getWindowRect(),

    registerDraggable(entry: DraggableEntry): () => void {
      draggables.set(entry.id, entry);
      return () => {
        if (draggables.get(entry.id) === entry) {
          draggables.delete(entry.id);
        }
        entry.setTransform(null);
      };
    },

    registerDroppable(entry: DroppableEntry): () => void {
      droppables.set(entry.id, entry);
      return () => {
        if (droppables.get(entry.id) === entry) {
          droppables.delete(entry.id);
          measuredRects.delete(entry.id);
        }
        entry.setRect(null);
      };
    },

    registerSortable(entry: SortableEntry): () => void {
      sortables.set(entry.id, entry);
      return () => {
        if (sortables.get(entry.id) === entry) {
          sortables.delete(entry.id);
        }
        entry.setTransform(null);
      };
    },

    registerMonitor(listener: DndMonitorListener): () => void {
      monitors.add(listener);
      return () => {
        monitors.delete(listener);
      };
    },

    registerActivator(
      node: HTMLElement,
      eventType: string,
      handler: (event: Event) => void,
    ): () => void {
      const draggableId = value.getDraggableIdByNode(node);
      if (draggableId === null) {
        return () => {};
      }
      let list = activators.get(draggableId);
      if (list === undefined) {
        list = [];
        activators.set(draggableId, list);
      }
      const record: ActivatorHandler = { eventType, handler };
      list.push(record);
      return () => {
        const current = activators.get(draggableId);
        if (current === undefined) {
          return;
        }
        const index = current.indexOf(record);
        if (index !== -1) {
          current.splice(index, 1);
        }
        if (current.length === 0) {
          activators.delete(draggableId);
        }
      };
    },

    dispatchActivator(
      draggableId: UniqueIdentifier,
      eventType: string,
      event: Event,
    ): void {
      const list = activators.get(draggableId);
      if (list === undefined) {
        return;
      }
      for (const record of list) {
        if (record.eventType === eventType) {
          record.handler(event);
        }
      }
    },

    claimActivator(event: Event): boolean {
      if (handledEvents.has(event)) {
        return false;
      }
      handledEvents.add(event);
      return true;
    },

    getDraggableIdByNode(node: HTMLElement): UniqueIdentifier | null {
      for (const entry of draggables.values()) {
        if (entry.node() === node) {
          return entry.id;
        }
      }
      return null;
    },

    getDraggableNode(draggableId: UniqueIdentifier): HTMLElement | null {
      return draggables.get(draggableId)?.node() ?? null;
    },

    getDroppableRect(droppableId: UniqueIdentifier): ClientRect | null {
      return measuredRects.get(droppableId)
        ?? droppables.get(droppableId)?.rect()
        ?? null;
    },

    getActiveRect(): ClientRect | null {
      return active()?.rect ?? null;
    },

    getPointerCoordinates(): Coordinates | null {
      return pointerCoordinates;
    },

    startDrag(
      draggableId: UniqueIdentifier,
      event: Event | null,
      coordinates?: Coordinates,
    ): void {
      if (disposed || activeEntry !== null) {
        return;
      }
      clearScheduledFocus();
      const entry = draggables.get(draggableId);
      if (entry === undefined || entry.disabled()) {
        return;
      }
      const currentRect = measureElement(entry.node());
      const current: Active = {
        id: entry.id,
        data: entry.data(),
        rect: currentRect,
      };
      initialCoordinates = coordinates
        ?? (currentRect === null ? ZERO_COORDINATES : getCenter(currentRect));
      pointerCoordinates = coordinates ?? null;
      rawTransform = ZERO_TRANSFORM;
      activeEntry = entry;
      setPendingState(null);
      setActivatorEvent(event);
      setStatus("dragging");
      setActive(current);
      setOver(null);
      setCollisions(null);
      setActiveTransform(ZERO_TRANSFORM);
      setOverlayTransform(ZERO_TRANSFORM);
      setOverlaySource(current);
      setOverlayVisible(true);
      setDragResult(null);
      measureDroppables();
      lastScrollSignature = scrollSignature();
      const startEvent = computeFrame(ZERO_TRANSFORM, false, false, event);
      if (startEvent === null) {
        return;
      }
      announce("start", startEvent);
      notifyMonitor("start", startEvent);
      autoScroll.start();
    },

    moveDrag(coordinates: Coordinates, event?: Event): void {
      if (activeEntry === null || status() !== "dragging") {
        return;
      }
      pointerCoordinates = coordinates;
      rawTransform = {
        x: coordinates.x - initialCoordinates.x,
        y: coordinates.y - initialCoordinates.y,
      };
      computeFrame(rawTransform, true, true, event ?? null);
    },

    moveDragBy(delta: Coordinates, event?: Event): void {
      if (activeEntry === null || status() !== "dragging") {
        return;
      }
      rawTransform = {
        x: rawTransform.x + delta.x,
        y: rawTransform.y + delta.y,
      };
      pointerCoordinates = {
        x: initialCoordinates.x + rawTransform.x,
        y: initialCoordinates.y + rawTransform.y,
      };
      computeFrame(rawTransform, true, true, event ?? null);
    },

    endDrag(event?: Event): void {
      if (activeEntry === null) {
        value.clearPending();
        return;
      }
      const base = computeFrame(rawTransform, false, true, event ?? null);
      if (base === null) {
        return;
      }
      const snapshot = activeEntry === null
        ? null
        : captureFocus(activeEntry, base.active.id);
      const cancel = props.cancelDrop?.({
        active: base.active,
        over: base.over,
        collisions: base.collisions,
        delta: base.delta,
        activatorEvent: base.activatorEvent,
      });
      if (cancel === true) {
        finishCancel(base, snapshot);
        return;
      }
      announce("end", base);
      notifyMonitor("end", base);
      finish({
        active: base.active,
        over: base.over,
        cancelled: false,
      }, false, snapshot);
    },

    cancelDrag(event?: Event): void {
      if (activeEntry === null) {
        if (pending() !== null) {
          value.abortPending(event ?? null);
        }
        return;
      }
      const current = active();
      if (current === null) {
        return;
      }
      const base = createEventBase(
        current,
        over(),
        activeTransform(),
        collisions(),
        event ?? activatorEvent(),
      );
      finishCancel(base);
    },

    setPending(
      draggableId: UniqueIdentifier,
      event: Event | null,
      coordinates: Coordinates | null,
    ): void {
      if (disposed || status() === "dragging") {
        return;
      }
      const entry = draggables.get(draggableId);
      if (entry === undefined || entry.disabled()) {
        return;
      }
      const next: PendingDrag = {
        id: draggableId,
        initialCoordinates: coordinates,
        activatorEvent: event,
      };
      setPendingState(next);
      setStatus("pending");
      setActivatorEvent(event);
      const pendingActive: Active = {
        id: draggableId,
        data: entry.data(),
        rect: measureElement(entry.node()),
      };
      const pendingEvent = createEventBase(
        pendingActive,
        null,
        ZERO_TRANSFORM,
        null,
        event,
      );
      notifyMonitor("pending", pendingEvent);
    },

    abortPending(event?: Event | null): void {
      const current = pending();
      if (current === null) {
        return;
      }
      const entry = draggables.get(current.id);
      const pendingActive: Active = {
        id: current.id,
        data: entry?.data() ?? {},
        rect: measureElement(entry?.node() ?? null),
      };
      const abortEvent = createEventBase(
        pendingActive,
        null,
        ZERO_TRANSFORM,
        null,
        event ?? current.activatorEvent,
      );
      setPendingState(null);
      setStatus("idle");
      setActivatorEvent(null);
      notifyMonitor("abort", abortEvent);
    },

    clearPending(): void {
      if (pending() === null) {
        return;
      }
      setPendingState(null);
      if (status() === "pending") {
        setStatus("idle");
      }
    },

    hideOverlay(): void {
      setOverlayVisible(false);
      setOverlaySource(null);
      setOverlayTransform(ZERO_TRANSFORM);
      setDragResult(null);
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      clearScheduledFocus();
      autoScroll.dispose();
      monitors.clear();
      activators.clear();
      draggables.clear();
      droppables.clear();
      sortables.clear();
      measuredRects = new Map();
    },
  };

  return value;
}
