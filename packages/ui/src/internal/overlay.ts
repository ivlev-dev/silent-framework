import {
  createEffect,
  createSignal,
  isServerMode,
  onCleanup,
} from "@ivlev-dev/silent-core";

/**
 * Общие DOM-хелперы оверлеев: фокус, focus trap, модальный слой.
 * Обработчики не создаются на уровне модуля — только из эффектов компонента,
 * чтобы SSR не трогал DOM и всё снималось через `onCleanup`/`dispose()`.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
  "audio[controls]",
  "video[controls]",
].join(",");

function isFocusable(element: HTMLElement): boolean {
  if (element.hasAttribute("disabled")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  if (element.hidden) return false;
  if (element.closest("[inert]") !== null) return false;
  return true;
}

/** Элементы, доступные с клавиатуры, в порядке DOM. */
export function getFocusable(root: ParentNode): HTMLElement[] {
  const found = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const result: HTMLElement[] = [];
  for (const element of found) {
    if (isFocusable(element)) result.push(element);
  }
  return result;
}

/** Текущий активный элемент, если это HTML-элемент. */
export function getActiveElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  return active instanceof HTMLElement ? active : null;
}

/** Возвращает фокус на сохранённый элемент, если он ещё в документе. */
export function restoreFocus(target: HTMLElement | null): void {
  if (target === null || !target.isConnected) return;
  target.focus({ preventScroll: true });
}

/** Фокусирует первый доступный элемент или сам контейнер. */
export function focusFirst(root: HTMLElement): boolean {
  const [first] = getFocusable(root);
  if (first !== undefined) {
    first.focus({ preventScroll: true });
    return true;
  }
  root.focus({ preventScroll: true });
  return false;
}

/** Замыкает Tab/Shift+Tab внутри контейнера. */
export function trapTab(root: HTMLElement, event: KeyboardEvent): void {
  const items = getFocusable(root);
  if (items.length === 0) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  const inside = active !== null && root.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    }
    return;
  }
  if (!inside || active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

interface AttributeSnapshot {
  readonly inert: string | null;
  readonly ariaHidden: string | null;
}

const modalRoots = new Set<Element>();
const snapshots = new Map<Element, AttributeSnapshot>();
const applied = new Set<Element>();

function restoreChild(child: Element): void {
  const snapshot = snapshots.get(child);
  if (snapshot === undefined) return;
  if (snapshot.inert === null) child.removeAttribute("inert");
  else child.setAttribute("inert", snapshot.inert);
  if (snapshot.ariaHidden === null) child.removeAttribute("aria-hidden");
  else child.setAttribute("aria-hidden", snapshot.ariaHidden);
}

/**
 * Пока открыт хотя бы один modal, все top-level потомки `body`, не содержащие
 * открытый оверлей, получают `inert` + `aria-hidden`. Вложенные оверлеи не
 * инертят родителя: контейнер, содержащий любой открытый корень, пропускается.
 */
function applyModalLayer(): void {
  if (typeof document === "undefined") return;
  const body = document.body;
  if (body === null) return;
  if (modalRoots.size === 0) {
    for (const child of applied) restoreChild(child);
    applied.clear();
    snapshots.clear();
    return;
  }
  for (const child of Array.from(body.children)) {
    if (!snapshots.has(child)) {
      snapshots.set(child, {
        inert: child.getAttribute("inert"),
        ariaHidden: child.getAttribute("aria-hidden"),
      });
    }
    let containsOpen = false;
    for (const root of modalRoots) {
      if (child === root || child.contains(root)) {
        containsOpen = true;
        break;
      }
    }
    if (containsOpen) {
      if (applied.has(child)) {
        restoreChild(child);
        applied.delete(child);
      }
      continue;
    }
    child.setAttribute("inert", "");
    child.setAttribute("aria-hidden", "true");
    applied.add(child);
  }
}

/** Регистрирует модальный корень; возвращает функцию снятия слоя. */
export function registerModal(root: Element): () => void {
  modalRoots.add(root);
  applyModalLayer();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    modalRoots.delete(root);
    applyModalLayer();
  };
}

/** Эффект только на клиенте: SSR не создаёт DOM-обработчиков. */
export function clientEffect(fn: () => void): void {
  if (isServerMode()) return;
  createEffect(fn);
}

const TRIGGER_INTERACTIVE_SELECTOR = [
  "button",
  "[role='button']",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
].join(",");

const TRIGGER_INTERACTIVE_TAGS = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "summary",
]);

interface TriggerNodeLike {
  readonly tagName?: unknown;
  readonly nodeType?: unknown;
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
  setAttribute?(name: string, value: string): void;
}

function isInteractiveTriggerNode(node: TriggerNodeLike): boolean {
  if (node.nodeType !== 1) return false;
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  if (TRIGGER_INTERACTIVE_TAGS.has(tag)) return true;
  if (tag === "a" && node.hasAttribute?.("href") === true) return true;
  return node.getAttribute?.("role") === "button";
}

function setTriggerNodeAria(
  node: TriggerNodeLike,
  panelId: string,
  hasPopup: "menu" | "dialog",
  expanded: boolean,
): void {
  node.setAttribute?.("aria-haspopup", hasPopup);
  node.setAttribute?.("aria-expanded", expanded ? "true" : "false");
  node.setAttribute?.("aria-controls", panelId);
}

/**
 * Если `trigger` — уже интерактивный узел (Button, ссылка, input), ARIA
 * раскрытия ставится прямо на него ещё в рендере, включая SSR. Для текста
 * или фрагмента возвращает `false`: тогда ARIA несёт сама обёртка-кнопка.
 */
export function applyTriggerAria(
  trigger: unknown,
  panelId: string,
  hasPopup: "menu" | "dialog",
  expanded: boolean,
): boolean {
  if (typeof trigger !== "object" || trigger === null) return false;
  const node = trigger as TriggerNodeLike;
  if (typeof node.setAttribute !== "function") return false;
  if (!isInteractiveTriggerNode(node)) return false;
  setTriggerNodeAria(node, panelId, hasPopup, expanded);
  return true;
}

/**
 * Переносит ARIA состояния раскрытия с декоративной обёртки на фактический
 * интерактивный триггер. Если внутри обёртки нет фокусируемого элемента
 * (например, триггер — текст), обёртка сама становится `role="button"`.
 *
 * ARIA на generic `span` без роли невалиден, поэтому обёртка очищается.
 */
export function syncTriggerAria(
  root: Element,
  anchorSelector: string,
  panelId: string,
  hasPopup: "menu" | "dialog",
  expanded: boolean,
): void {
  const anchor = root.querySelector<HTMLElement>(anchorSelector);
  if (anchor === null) return;
  const target = anchor.querySelector<HTMLElement>(TRIGGER_INTERACTIVE_SELECTOR) ?? anchor;
  const fallback = target === anchor;

  if (fallback) {
    if (!anchor.hasAttribute("role")) anchor.setAttribute("role", "button");
    const tabindex = anchor.getAttribute("tabindex");
    if (tabindex === null || tabindex === "-1") anchor.tabIndex = 0;
  } else {
    if (anchor.getAttribute("role") === "button") anchor.removeAttribute("role");
    if (anchor.getAttribute("tabindex") === "0") anchor.removeAttribute("tabindex");
    anchor.removeAttribute("aria-haspopup");
    anchor.removeAttribute("aria-expanded");
    anchor.removeAttribute("aria-controls");
  }

  setTriggerNodeAria(target, panelId, hasPopup, expanded);
}

/** Восстанавливает фокус при закрытии (и при dispose). */
export function useFocusRestore(isOpen: () => boolean): void {
  clientEffect(() => {
    if (!isOpen()) return;
    const previous = getActiveElement();
    onCleanup(() => {
      restoreFocus(previous);
    });
  });
}

/** Включает `inert`/`aria-hidden` для фона, пока оверлей открыт. */
export function useModalLayer(root: () => Element | null, isOpen: () => boolean): void {
  clientEffect(() => {
    if (!isOpen()) return;
    const element = root();
    if (element === null || !element.isConnected) return;
    const release = registerModal(element);
    onCleanup(release);
  });
}

export interface DismissOptions {
  /** Реагировать на клик вне корня. По умолчанию `true`. */
  readonly outside?: boolean | undefined;
  /** Реагировать на Escape. По умолчанию `true`. */
  readonly escape?: boolean | undefined;
  /** Вызывать `preventDefault` на Escape. По умолчанию `true`. */
  readonly preventEscape?: boolean | undefined;
}

/**
 * Закрытие по клику вне корня и по Escape. Обработчики живут только пока
 * оверлей открыт и снимаются при закрытии/dispose.
 */
export function useDismiss(
  root: () => Element | null,
  isOpen: () => boolean,
  onDismiss: () => void,
  options: DismissOptions = {},
): void {
  const listenOutside = options.outside !== false;
  const listenEscape = options.escape !== false;
  clientEffect(() => {
    if (!isOpen()) return;
    let dismissed = false;
    const outside = (event: Event): void => {
      if (dismissed) return;
      const element = root();
      const target = event.target;
      if (element === null) return;
      if (target instanceof Node && element.contains(target)) return;
      dismissed = true;
      onDismiss();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (dismissed) return;
      dismissed = true;
      if (options.preventEscape !== false) event.preventDefault();
      onDismiss();
    };
    if (listenOutside) {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("mousedown", outside, true);
      document.addEventListener("click", outside, true);
    }
    if (listenEscape) document.addEventListener("keydown", escape);
    onCleanup(() => {
      if (listenOutside) {
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("mousedown", outside, true);
        document.removeEventListener("click", outside, true);
      }
      if (listenEscape) document.removeEventListener("keydown", escape);
    });
  });
}

export interface OpenStateOptions {
  readonly open: () => boolean | undefined;
  readonly defaultOpen: () => boolean;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}

export interface OpenState {
  isOpen(): boolean;
  /** Возвращает `true`, если состояние действительно изменилось. */
  requestOpen(open: boolean): boolean;
}

/** Controlled/uncontrolled `open` для лёгких оверлеев без нативного dialog. */
export function bindOpenState(options: OpenStateOptions): OpenState {
  const [uncontrolled, setUncontrolled] = createSignal(options.defaultOpen());
  const isOpen = (): boolean => {
    const explicit = options.open();
    return explicit === undefined ? uncontrolled() : explicit;
  };
  return {
    isOpen,
    requestOpen(next: boolean): boolean {
      if (isOpen() === next) return false;
      if (options.open() === undefined) setUncontrolled(next);
      options.onOpenChange?.(next);
      return true;
    },
  };
}

/**
 * Видимость после монтирования: на сервере всегда `false`, на клиенте
 * включается в эффекте после первого рендера — гидрация не видит mismatch.
 */
export function useMounted(): () => boolean {
  const [mounted, setMounted] = createSignal(false);
  clientEffect(() => {
    setMounted(true);
  });
  return mounted;
}

/** Сторона, с которой панель примыкает к триггеру. */
export type FloatingSide = "top" | "bottom" | "start" | "end";

/** Прямоугольник в координатах viewport (подмножество `DOMRect`). */
export interface FloatingRect {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface FloatingViewport {
  readonly width: number;
  readonly height: number;
}

export interface FloatingPlacement {
  /** Итоговая сторона после flip у верхнего/нижнего края. */
  readonly side: FloatingSide;
  /** Сдвиг вдоль inline-оси, чтобы панель не вылезала за левый/правый край. */
  readonly inlineShift: number;
  /** Сдвиг вдоль block-оси для боковых панелей. */
  readonly blockShift: number;
}

export interface FloatingOptions {
  readonly anchor: () => Element | null;
  readonly panel: () => HTMLElement | null;
  readonly isOpen: () => boolean;
  readonly preferred: () => FloatingSide;
  /** Зазор между триггером и панелью. По умолчанию 8px. */
  readonly gap?: number | undefined;
  /** Минимальный отступ от края viewport. По умолчанию 12px. */
  readonly margin?: number | undefined;
}

/**
 * Чистая геометрия floating-панели. Flip переключает top/bottom, shift
 * прижимает панель к краям viewport. Боковые стороны (start/end) не
 * переворачиваются — для них применяется только вертикальный shift.
 */
export function resolveFloatingPlacement(
  anchor: FloatingRect,
  panel: FloatingRect,
  viewport: FloatingViewport,
  preferred: FloatingSide,
  gap = 8,
  margin = 12,
): FloatingPlacement {
  const roomBlock = panel.height + gap + margin;
  const roomInline = panel.width + gap + margin;
  const below = viewport.height - anchor.bottom;
  const above = anchor.top;
  let side = preferred;

  if (preferred === "bottom" && below < roomBlock && above >= roomBlock) {
    side = "top";
  } else if (preferred === "top" && above < roomBlock && below >= roomBlock) {
    side = "bottom";
  } else if (preferred === "start" && anchor.left < roomInline && viewport.width - anchor.right >= roomInline) {
    side = "end";
  } else if (preferred === "end" && viewport.width - anchor.right < roomInline && anchor.left >= roomInline) {
    side = "start";
  }

  let inlineShift = 0;
  let blockShift = 0;

  if (side === "top" || side === "bottom") {
    const overflowEnd = panel.right + margin - viewport.width;
    const overflowStart = margin - panel.left;
    if (overflowEnd > 0) inlineShift = -overflowEnd;
    else if (overflowStart > 0) inlineShift = overflowStart;
  } else {
    /*
     * Боковая панель: её inline-позиция зависит от итоговой стороны, а
     * измеренный rect после flip относится к прежней стороне. Считаем
     * ожидаемый край из anchor и ширины панели, затем прижимаем к viewport.
     */
    const panelLeft =
      side === "start" ? anchor.left - gap - panel.width : anchor.right + gap;
    const inlineOverflowEnd = panelLeft + panel.width + margin - viewport.width;
    const inlineOverflowStart = margin - panelLeft;
    if (inlineOverflowEnd > 0) inlineShift = -inlineOverflowEnd;
    else if (inlineOverflowStart > 0) inlineShift = inlineOverflowStart;

    const overflowEnd = panel.bottom + margin - viewport.height;
    const overflowStart = margin - panel.top;
    if (overflowEnd > 0) blockShift = -overflowEnd;
    else if (overflowStart > 0) blockShift = overflowStart;
  }

  return { side, inlineShift, blockShift };
}

/**
 * Держит floating-панель внутри viewport: flip у верхнего/нижнего края,
 * shift у боковых. Пишет CSS-переменные `--sui-floating-*-shift` прямо в
 * панель (стили остаются в CSS), а сторону отдаёт сигналом для `data-side`.
 * На сервере и в jsdom (нулевые rect) ничего не меняет.
 */
export function useFloating(options: FloatingOptions): () => FloatingSide {
  const [side, setSide] = createSignal<FloatingSide>(options.preferred());
  clientEffect(() => {
    if (!options.isOpen()) return;
    const anchor = options.anchor();
    const panel = options.panel();
    if (anchor === null || panel === null) return;

    const update = (): void => {
      /*
       * Измеряем панель без прошлого сдвига: иначе shift учитывается в
       * следующем измерении и обнуляется на повторном вызове (scroll/resize),
       * а панель возвращается за край viewport.
       */
      panel.style.setProperty("--sui-floating-inline-shift", "0px");
      panel.style.setProperty("--sui-floating-block-shift", "0px");
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (
        (anchorRect.width === 0 && anchorRect.height === 0)
        || (panelRect.width === 0 && panelRect.height === 0)
      ) {
        return;
      }
      const placement = resolveFloatingPlacement(
        anchorRect,
        panelRect,
        { width: window.innerWidth, height: window.innerHeight },
        options.preferred(),
        options.gap,
        options.margin,
      );
      setSide(placement.side);
      panel.style.setProperty(
        "--sui-floating-inline-shift",
        `${placement.inlineShift}px`,
      );
      panel.style.setProperty(
        "--sui-floating-block-shift",
        `${placement.blockShift}px`,
      );
      if (placement.side === options.preferred()) panel.removeAttribute("data-flip");
      else panel.setAttribute("data-flip", "");
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    document.addEventListener("scroll", update, { passive: true, capture: true });
    onCleanup(() => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, { capture: true });
    });
  });
  return side;
}
