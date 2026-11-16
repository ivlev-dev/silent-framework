export type DevtoolsEventType = "mount" | "unmount" | "error" | "hmr" | "navigate";

export interface DevtoolsEventBase {
  readonly type: DevtoolsEventType;
  readonly sequence: number;
  readonly timestamp: number;
}

export interface DevtoolsMountEvent extends DevtoolsEventBase {
  readonly type: "mount";
  readonly viewId: number;
  readonly name: string;
  readonly moduleId: string | null;
  readonly hydrated: boolean;
  readonly props: readonly string[];
}

export interface DevtoolsUnmountEvent extends DevtoolsEventBase {
  readonly type: "unmount";
  readonly viewId: number;
  readonly name: string;
  readonly moduleId: string | null;
  readonly lifetimeMs: number;
}

export interface DevtoolsErrorEvent extends DevtoolsEventBase {
  readonly type: "error";
  readonly name: string | null;
  readonly moduleId: string | null;
  readonly phase: string;
  readonly message: string;
}

export interface DevtoolsHmrEvent extends DevtoolsEventBase {
  readonly type: "hmr";
  readonly moduleId: string;
  readonly kind: "update" | "invalidate";
  readonly views: number;
}

export interface DevtoolsNavigateEvent extends DevtoolsEventBase {
  readonly type: "navigate";
  readonly to: string;
  readonly from: string | null;
}

export type DevtoolsEvent =
  | DevtoolsMountEvent
  | DevtoolsUnmountEvent
  | DevtoolsErrorEvent
  | DevtoolsHmrEvent
  | DevtoolsNavigateEvent;

export type DevtoolsSubscriber = (event: DevtoolsEvent) => void;

export interface DevtoolsEventStats {
  readonly active: boolean;
  readonly installed: boolean;
  readonly subscribers: number;
  readonly buffered: number;
  readonly capacity: number;
  readonly emitted: number;
  readonly dropped: number;
  readonly mounts: number;
  readonly unmounts: number;
  readonly errors: number;
  readonly hmr: number;
  readonly navigations: number;
}

export const DEVTOOLS_EVENT_LIMIT = 100;
const MAX_TEXT_LENGTH = 512;
const MAX_PROP_KEYS = 32;

let events: DevtoolsEvent[] = [];
let subscribers = new Set<DevtoolsSubscriber>();
let installed = false;
let capacity = DEVTOOLS_EVENT_LIMIT;
let sequence = 0;
let emitted = 0;
let dropped = 0;
let mounts = 0;
let unmounts = 0;
let errors = 0;
let hmr = 0;
let navigations = 0;

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEVTOOLS_EVENT_LIMIT;
  }
  return Math.min(1000, Math.max(1, Math.floor(limit)));
}

function clip(value: string): string {
  return value.length <= MAX_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_TEXT_LENGTH)}…`;
}

function clipProps(props: readonly string[]): readonly string[] {
  if (props.length <= MAX_PROP_KEYS) {
    return props;
  }
  return props.slice(0, MAX_PROP_KEYS);
}

function isActive(): boolean {
  return installed || subscribers.size > 0;
}

export function setDevtoolsInstalled(next: boolean): void {
  installed = next;
  if (!isActive()) {
    events = [];
  }
}

export function isDevtoolsInstalled(): boolean {
  return installed;
}

export function isDevtoolsActive(): boolean {
  return isActive();
}

export function setDevtoolsEventLimit(limit: number): void {
  capacity = clampLimit(limit);
  if (events.length > capacity) {
    dropped += events.length - capacity;
    events = events.slice(events.length - capacity);
  }
}

export function getDevtoolsEventLimit(): number {
  return capacity;
}

export function subscribeDevtoolsEvents(listener: DevtoolsSubscriber): () => void {
  subscribers.add(listener);
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    subscribers.delete(listener);
    if (!isActive()) {
      events = [];
    }
  };
}

export function clearDevtoolsSubscribers(): void {
  subscribers = new Set();
  if (!installed) {
    events = [];
  }
}

export function getDevtoolsEvents(): readonly DevtoolsEvent[] {
  return [...events];
}

export function clearDevtoolsEvents(): void {
  events = [];
}

export function emitDevtoolsEvent(
  event:
    | Omit<DevtoolsMountEvent, "sequence" | "timestamp">
    | Omit<DevtoolsUnmountEvent, "sequence" | "timestamp">
    | Omit<DevtoolsErrorEvent, "sequence" | "timestamp">
    | Omit<DevtoolsHmrEvent, "sequence" | "timestamp">
    | Omit<DevtoolsNavigateEvent, "sequence" | "timestamp">,
): DevtoolsEvent | null {
  if (!isActive()) {
    return null;
  }
  sequence += 1;
  emitted += 1;
  let next: DevtoolsEvent;
  switch (event.type) {
    case "mount":
      mounts += 1;
      next = {
        ...event,
        props: clipProps(event.props),
        sequence,
        timestamp: Date.now(),
      };
      break;
    case "unmount":
      unmounts += 1;
      next = { ...event, sequence, timestamp: Date.now() };
      break;
    case "error":
      errors += 1;
      next = {
        ...event,
        message: clip(event.message),
        sequence,
        timestamp: Date.now(),
      };
      break;
    case "hmr":
      hmr += 1;
      next = { ...event, sequence, timestamp: Date.now() };
      break;
    case "navigate":
      navigations += 1;
      next = { ...event, sequence, timestamp: Date.now() };
      break;
  }
  events.push(next);
  if (events.length > capacity) {
    events = events.slice(events.length - capacity);
    dropped += 1;
  }
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(next);
    } catch (error) {
      console.error(error);
    }
  }
  return next;
}

export function emitDevtoolsMount(event: {
  readonly viewId: number;
  readonly name: string;
  readonly moduleId: string | null;
  readonly hydrated: boolean;
  readonly props: readonly string[];
}): void {
  emitDevtoolsEvent({ type: "mount", ...event });
}

export function emitDevtoolsUnmount(event: {
  readonly viewId: number;
  readonly name: string;
  readonly moduleId: string | null;
  readonly lifetimeMs: number;
}): void {
  emitDevtoolsEvent({ type: "unmount", ...event });
}

export function emitDevtoolsError(event: {
  readonly name: string | null;
  readonly moduleId: string | null;
  readonly phase: string;
  readonly message: string;
}): void {
  emitDevtoolsEvent({ type: "error", ...event });
}

export function emitDevtoolsHmr(event: {
  readonly moduleId: string;
  readonly kind: "update" | "invalidate";
  readonly views: number;
}): void {
  emitDevtoolsEvent({ type: "hmr", ...event });
}

export function emitDevtoolsNavigate(event: {
  readonly to: string;
  readonly from: string | null;
}): void {
  emitDevtoolsEvent({ type: "navigate", to: clip(event.to), from: event.from === null ? null : clip(event.from) });
}

export function getDevtoolsEventStats(): DevtoolsEventStats {
  return {
    active: isActive(),
    installed,
    subscribers: subscribers.size,
    buffered: events.length,
    capacity,
    emitted,
    dropped,
    mounts,
    unmounts,
    errors,
    hmr,
    navigations,
  };
}

export function resetDevtoolsEvents(): void {
  events = [];
  sequence = 0;
  emitted = 0;
  dropped = 0;
  mounts = 0;
  unmounts = 0;
  errors = 0;
  hmr = 0;
  navigations = 0;
}
