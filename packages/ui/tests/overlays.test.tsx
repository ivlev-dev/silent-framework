import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createComponent,
  flushSync,
  hydrate,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { Dialog } from "../src/components/dialog/index.js";
import { AlertDialog } from "../src/components/alert-dialog/index.js";
import { Sheet } from "../src/components/sheet/index.js";
import { Popover } from "../src/components/popover/index.js";
import { Menu, MenuItem, MenuSeparator } from "../src/components/menu/index.js";
import { Tooltip } from "../src/components/tooltip/index.js";
import { Snackbar } from "../src/components/snackbar/index.js";
import { Button } from "../src/components/button/index.js";
import { resolveFloatingPlacement, registerModal } from "../src/internal/overlay.js";

interface Handle {
  readonly node: Node;
  update(props: Record<string, unknown>): void;
  dispose(): void;
}

const handles: Handle[] = [];

function flush(): void {
  flushSync();
  flushSync();
}

function mount(component: AnyComponent, props: Record<string, unknown> = {}): Handle {
  const result = createComponent(component, props);
  document.body.appendChild(result.node);
  handles.push(result);
  flush();
  return result;
}

function rootOf(handle: Handle): Element {
  const node = handle.node;
  if (node.nodeType !== Node.ELEMENT_NODE) {
    throw new Error(`ожидался элемент, получен nodeType=${node.nodeType}`);
  }
  return node as Element;
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flush();
}

function keydown(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  flush();
}

function pointer(target: EventTarget, type: string, pointerType: string): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType }));
  flush();
}

function outsideClick(): void {
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  flush();
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Dialog", () => {
  it("открывается uncontrolled, ставит aria и RU-кнопку закрытия", () => {
    const dialog = rootOf(
      mount(Dialog, {
        defaultOpen: true,
        title: "Настройки",
        description: "Измените параметры профиля",
        children: "Содержимое",
      }),
    );
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.hasAttribute("open")).toBe(true);
    const labelledby = dialog.getAttribute("aria-labelledby");
    expect(labelledby).not.toBeNull();
    expect(dialog.querySelector(`#${labelledby}`)?.textContent).toBe("Настройки");
    const describedby = dialog.getAttribute("aria-describedby");
    expect(dialog.querySelector(`#${describedby}`)?.textContent).toContain("Измените");
    expect(dialog.querySelector(".sui-dialog__close")?.getAttribute("aria-label")).toBe("Закрыть");
    expect(dialog.querySelector(".sui-dialog__body")?.getAttribute("tabindex")).toBe("0");
    expect(dialog.textContent).toContain("Содержимое");
    // jsdom не умеет showModal(): компонент уходит в fallback.
    expect(dialog.hasAttribute("data-fallback")).toBe(true);
  });

  it("закрывается кнопкой, Escape и backdrop, возвращает фокус", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Открыть";
    document.body.appendChild(trigger);
    trigger.focus();

    const changes: boolean[] = [];
    const dialog = rootOf(
      mount(Dialog, {
        defaultOpen: true,
        title: "Заголовок",
        onOpenChange: (open: boolean) => changes.push(open),
      }),
    );
    expect(document.activeElement === dialog || dialog.contains(document.activeElement)).toBe(true);

    click(dialog.querySelector(".sui-dialog__close") as Element);
    expect(changes.at(-1)).toBe(false);
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);

    mount(Dialog, { defaultOpen: true, title: "Escape" });
    const escapeDialog = document.querySelector(".sui-dialog[open]") as HTMLDialogElement;
    keydown(escapeDialog, "Escape");
    expect(escapeDialog.hasAttribute("open")).toBe(false);

    const backdrop = rootOf(mount(Dialog, { defaultOpen: true, title: "Backdrop" }));
    click(backdrop);
    expect(backdrop.hasAttribute("open")).toBe(false);
  });

  it("закрывает :modal при controlled-закрытии, даже если атрибут open уже снят", () => {
    const proto = HTMLDialogElement.prototype as unknown as {
      showModal?: (this: HTMLDialogElement) => void;
      close?: (this: HTMLDialogElement) => void;
    };
    const originalShow = proto.showModal;
    const originalClose = proto.close;
    const closed: HTMLDialogElement[] = [];
    const closeWithOpen: boolean[] = [];
    proto.showModal = function showModal(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
    proto.close = function closeDialog(this: HTMLDialogElement): void {
      closeWithOpen.push(this.hasAttribute("open"));
      closed.push(this);
      this.removeAttribute("open");
    };
    try {
      const handle = mount(Dialog, { open: true, title: "Controlled" });
      const dialog = rootOf(handle) as HTMLDialogElement;
      expect(closed).toHaveLength(0);

      handle.update({ open: false, title: "Controlled" });
      flush();

      expect(closed).toContain(dialog);
      expect(closeWithOpen).toEqual([true]);
      expect(dialog.hasAttribute("open")).toBe(false);
      expect(dialog.hasAttribute("data-fallback")).toBe(false);
    } finally {
      if (originalShow === undefined) delete proto.showModal;
      else proto.showModal = originalShow;
      if (originalClose === undefined) delete proto.close;
      else proto.close = originalClose;
    }
  });

  it("замыкает Tab внутри диалога", () => {
    const dialog = rootOf(
      mount(Dialog, {
        defaultOpen: true,
        title: "Фокус",
        children: <Button>Действие</Button>,
      }),
    );
    const focusable = dialog.querySelectorAll<HTMLElement>("button");
    expect(focusable.length).toBeGreaterThan(1);
    const last = focusable[focusable.length - 1] as HTMLElement;
    last.focus();
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(focusable[0]);
  });

  it("SSR рендерит inline <dialog open> и гидрация не даёт mismatch", async () => {
    function View(): Node {
      return (
        <Dialog defaultOpen title="Сервер" description="Описание">
          Контент
        </Dialog>
      );
    }
    const { html } = await renderToString(View);
    expect(html).toContain("<dialog");
    expect(html).toContain("open");
    expect(html).toContain('class="sui-dialog"');
    expect(html).toContain("Сервер");
    expect(html).not.toContain("data-fallback");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, View, {
      onMismatch: (error) => mismatches.push(error.message),
    });
    flush();
    expect(mismatches).toEqual([]);
    const dialog = container.querySelector("dialog");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.hasAttribute("data-fallback")).toBe(true);
    handle.dispose();
  });
});

describe("AlertDialog", () => {
  it("role=alertdialog, не закрывается по backdrop, confirm вызывает callback", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const dialog = rootOf(
      mount(AlertDialog, {
        defaultOpen: true,
        title: "Удалить файл?",
        description: "Действие необратимо",
        destructive: true,
        confirmLabel: "Удалить",
        onConfirm,
        onCancel,
      }),
    );
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.getAttribute("role")).toBe("alertdialog");
    expect(dialog.querySelector(".sui-alert-dialog__confirm")?.textContent).toContain("Удалить");
    expect(dialog.querySelector(".sui-alert-dialog__confirm")?.hasAttribute("data-destructive")).toBe(true);

    click(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);

    click(dialog.querySelector(".sui-alert-dialog__confirm") as Element);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute("open")).toBe(false);

    const again = rootOf(mount(AlertDialog, { defaultOpen: true, title: "Отмена", onCancel }));
    click(again.querySelector(".sui-alert-dialog__cancel") as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(again.hasAttribute("open")).toBe(false);

    const escaped = rootOf(mount(AlertDialog, { defaultOpen: true, title: "Escape", onCancel }));
    keydown(escaped, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(escaped.hasAttribute("open")).toBe(false);
  });
});

describe("Sheet", () => {
  it("сторона, ручка, закрытие по Escape и inert фона", () => {
    const sibling = document.createElement("div");
    sibling.setAttribute("data-testid", "page");
    document.body.appendChild(sibling);

    const sheet = rootOf(
      mount(Sheet, {
        defaultOpen: true,
        side: "bottom",
        title: "Фильтры",
        children: "Форма",
      }),
    );
    expect(sheet.getAttribute("data-side")).toBe("bottom");
    expect(sheet.hasAttribute("data-open")).toBe(true);
    expect(sheet.querySelector("[data-drag-handle]")).not.toBeNull();
    expect(sheet.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(sheet.querySelector(".sui-sheet__close")?.getAttribute("aria-label")).toBe("Закрыть");
    expect(sheet.querySelector(".sui-sheet__body")?.getAttribute("tabindex")).toBe("0");
    expect(sibling.getAttribute("aria-hidden")).toBe("true");
    expect(sibling.hasAttribute("inert")).toBe(true);

    keydown(document, "Escape");
    expect(sheet.hasAttribute("data-open")).toBe(false);
    expect(sheet.getAttribute("aria-hidden")).toBe("true");
    expect(sibling.hasAttribute("inert")).toBe(false);
    expect(sibling.hasAttribute("aria-hidden")).toBe(false);
  });

  it("dispose снимает modal-слой", () => {
    const sibling = document.createElement("div");
    document.body.appendChild(sibling);
    const handle = mount(Sheet, { defaultOpen: true, title: "x" });
    expect(sibling.hasAttribute("inert")).toBe(true);
    handle.dispose();
    handles.splice(handles.indexOf(handle), 1);
    flush();
    expect(sibling.hasAttribute("inert")).toBe(false);
  });

  it("вложенные modal-слои держат блокировку прокрутки до закрытия последнего", () => {
    const first = mount(Sheet, { defaultOpen: true, title: "Первый" });
    expect(document.body.style.overflow).toBe("hidden");

    const second = mount(Sheet, { defaultOpen: true, title: "Второй" });
    first.dispose();
    handles.splice(handles.indexOf(first), 1);
    flush();
    expect(document.body.style.overflow).toBe("hidden");

    second.dispose();
    handles.splice(handles.indexOf(second), 1);
    flush();
    expect(document.body.style.overflow).toBe("");
  });

  it("registerModal компенсирует скроллбар и восстанавливает overflow/padding", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    document.body.style.overflow = "auto";
    document.body.style.paddingRight = "4px";
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1017);
    let release: () => void = () => {};
    try {
      release = registerModal(root);
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.body.style.paddingRight).toBe("21px");

      release();
      release = () => {};
      expect(document.body.style.overflow).toBe("auto");
      expect(document.body.style.paddingRight).toBe("4px");
    } finally {
      release();
      Reflect.deleteProperty(document.documentElement, "clientWidth");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    }
  });
});

describe("Popover", () => {
  it("открывается после mount, aria-expanded, outside click и Escape", () => {
    const changes: boolean[] = [];
    const popover = rootOf(
      mount(Popover, {
        trigger: <Button>Открыть</Button>,
        defaultOpen: true,
        placement: "top",
        label: "Настройки",
        onOpenChange: (open: boolean) => changes.push(open),
        children: <Button>Внутри</Button>,
      }),
    );
    const anchor = popover.querySelector(".sui-popover__anchor") as HTMLElement;
    const trigger = anchor.querySelector("button") as HTMLElement;
    const panel = popover.querySelector(".sui-popover__panel") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-label")).toBe("Настройки");
    expect(anchor.hasAttribute("aria-expanded")).toBe(false);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    expect(popover.getAttribute("data-placement")).toBe("top");
    expect(popover.getAttribute("data-side")).toBe("top");
    expect(panel.getAttribute("data-side")).toBe("top");

    outsideClick();
    expect(changes.at(-1)).toBe(false);
    expect((popover.querySelector(".sui-popover__panel") as HTMLElement).hasAttribute("hidden")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    click(popover.querySelector(".sui-popover__anchor button") as Element);
    expect(changes.at(-1)).toBe(true);
    expect((popover.querySelector(".sui-popover__panel") as HTMLElement).hasAttribute("hidden")).toBe(false);

    keydown(document, "Escape");
    expect(changes.at(-1)).toBe(false);
    expect((popover.querySelector(".sui-popover__panel") as HTMLElement).hasAttribute("hidden")).toBe(true);
  });

  it("SSR закрыт и открывается после гидрации без mismatch", async () => {
    const { html } = await renderToString(Popover, {
      props: { trigger: "Триггер", defaultOpen: true, children: "Панель" },
    });
    expect(html).toContain("sui-popover__panel");
    expect(html).toContain("hidden");
    expect(html).toContain('aria-expanded="false"');

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatches: string[] = [];
    const handle = await hydrate(container, Popover, {
      props: { trigger: "Триггер", defaultOpen: true, children: "Панель" },
      onMismatch: (error) => mismatches.push(error.message),
    });
    flush();
    expect(mismatches).toEqual([]);
    expect(
      (container.querySelector(".sui-popover__panel") as HTMLElement).hasAttribute("hidden"),
    ).toBe(false);
    handle.dispose();
  });
});

describe("Menu", () => {
  it("роли, roving tabindex, стрелки/Home/End/Enter/Escape", () => {
    const onSelect = vi.fn();
    const menu = rootOf(
      mount(Menu, {
        defaultOpen: true,
        label: "Действия",
        trigger: <Button>Меню</Button>,
        children: [
          <MenuItem onSelect={onSelect}>Открыть</MenuItem>,
          <MenuItem disabled>Удалить</MenuItem>,
          <MenuSeparator />,
          <MenuItem>Ещё</MenuItem>,
        ],
      }),
    );
    expect(menu.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("Действия");
    expect(menu.getAttribute("data-side")).toBe("bottom");
    expect(menu.querySelector('[role="menu"]')?.getAttribute("data-side")).toBe("bottom");
    const anchor = menu.querySelector(".sui-menu__anchor") as HTMLElement;
    const trigger = anchor.querySelector("button") as HTMLElement;
    expect(anchor.hasAttribute("aria-expanded")).toBe(false);
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(
      menu.querySelector('[role="menu"]')?.id,
    );
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items).toHaveLength(3);
    expect(items[0]?.getAttribute("tabindex")).toBe("0");
    expect(items[1]?.getAttribute("aria-disabled")).toBe("true");
    expect(menu.querySelector('[role="separator"]')).not.toBeNull();

    items[0]?.focus();
    flush();
    keydown(items[0] as EventTarget, "ArrowDown");
    expect(document.activeElement).toBe(items[2]);

    keydown(document.activeElement as EventTarget, "Home");
    expect(document.activeElement).toBe(items[0]);

    keydown(document.activeElement as EventTarget, "End");
    expect(document.activeElement).toBe(items[2]);

    keydown(document.activeElement as EventTarget, "ArrowDown");
    expect(document.activeElement).toBe(items[0]);

    keydown(document.activeElement as EventTarget, "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((menu.querySelector('[role="menu"]') as HTMLElement).hasAttribute("hidden")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("текстовый триггер получает роль кнопки и ARIA на обёртке", () => {
    const menu = rootOf(
      mount(Menu, {
        defaultOpen: true,
        trigger: "Меню",
        children: [<MenuItem>Один</MenuItem>],
      }),
    );
    const anchor = menu.querySelector(".sui-menu__anchor") as HTMLElement;
    expect(anchor.getAttribute("role")).toBe("button");
    expect(anchor.getAttribute("tabindex")).toBe("0");
    expect(anchor.getAttribute("aria-haspopup")).toBe("menu");
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
    expect(anchor.getAttribute("aria-controls")).toBe(
      menu.querySelector('[role="menu"]')?.id,
    );
  });

  it("Escape закрывает и возвращает фокус на триггер", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const menu = rootOf(
      mount(Menu, {
        defaultOpen: true,
        trigger: <Button>Меню</Button>,
        children: [<MenuItem>Один</MenuItem>],
      }),
    );
    const first = menu.querySelector<HTMLElement>('[role="menuitem"]') as HTMLElement;
    first.focus();
    flush();
    keydown(first, "Escape");
    expect((menu.querySelector('[role="menu"]') as HTMLElement).hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("SSR закрыт", async () => {
    const { html } = await renderToString(Menu, {
      props: { defaultOpen: true, trigger: "Меню", children: "Пункт" },
    });
    expect(html).toContain('role="menu"');
    expect(html).toContain("hidden");
    expect(html).toContain('aria-expanded="false"');
  });
});

describe("Tooltip", () => {
  it("показывается на hover, ставит aria-describedby, скрывается на leave", () => {
    const tooltip = rootOf(
      mount(Tooltip, {
        content: "Подсказка",
        delay: 0,
        children: <Button>Кнопка</Button>,
      }),
    );
    expect(tooltip.querySelector('[role="tooltip"]')).not.toBeNull();
    expect((tooltip.querySelector('[role="tooltip"]') as HTMLElement).hasAttribute("hidden")).toBe(true);
    expect(tooltip.hasAttribute("aria-describedby")).toBe(false);

    pointer(tooltip, "pointerenter", "mouse");
    const panel = tooltip.querySelector('[role="tooltip"]') as HTMLElement;
    expect(panel.textContent).toBe("Подсказка");
    expect(panel.hasAttribute("hidden")).toBe(false);
    const describedby = tooltip.getAttribute("aria-describedby");
    expect(describedby).not.toBeNull();
    expect(panel.id).toBe(describedby);

    pointer(tooltip, "pointerleave", "mouse");
    expect((tooltip.querySelector('[role="tooltip"]') as HTMLElement).hasAttribute("hidden")).toBe(true);
    expect(tooltip.hasAttribute("aria-describedby")).toBe(false);

    pointer(tooltip, "pointerenter", "mouse");
    keydown(tooltip, "Escape");
    expect((tooltip.querySelector('[role="tooltip"]') as HTMLElement).hasAttribute("hidden")).toBe(true);
  });

  it("не показывается на touch и отсутствует в SSR", async () => {
    const tooltip = rootOf(
      mount(Tooltip, {
        content: "Подсказка",
        delay: 0,
        children: <Button>Кнопка</Button>,
      }),
    );
    pointer(tooltip, "pointerdown", "touch");
    tooltip.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    flush();
    expect((tooltip.querySelector('[role="tooltip"]') as HTMLElement).hasAttribute("hidden")).toBe(true);

    const { html } = await renderToString(Tooltip, {
      props: { content: "Подсказка", children: "Кнопка" },
    });
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("hidden");
    expect(html).not.toContain("aria-describedby");
  });
});

describe("Snackbar", () => {
  it("role=status, сообщение, действие и RU-закрытие", () => {
    const onClose = vi.fn();
    const snackbar = rootOf(
      mount(Snackbar, {
        open: true,
        message: "Сохранено",
        action: <Button variant="text">Отменить</Button>,
        autoHideDuration: 0,
        onClose,
      }),
    );
    expect(snackbar.tagName).toBe("DIV");
    expect(snackbar.getAttribute("role")).toBe("status");
    expect(snackbar.getAttribute("aria-live")).toBe("polite");
    expect(snackbar.querySelector(".sui-snackbar__message")?.textContent).toBe("Сохранено");
    expect(snackbar.querySelector(".sui-snackbar__action")).not.toBeNull();
    expect(snackbar.querySelector(".sui-snackbar__close")?.getAttribute("aria-label")).toBe("Закрыть");
    click(snackbar.querySelector(".sui-snackbar__close") as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("автоскрытие по таймеру и очистка при dispose", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const snackbar = mount(Snackbar, {
      open: true,
      message: "Таймер",
      autoHideDuration: 1000,
      onClose,
    });
    vi.advanceTimersByTime(999);
    flush();
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    snackbar.dispose();
    handles.splice(handles.indexOf(snackbar), 1);
  });

  it("dispose снимает таймер до срабатывания", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const snackbar = mount(Snackbar, {
      open: true,
      message: "Таймер",
      autoHideDuration: 1000,
      onClose,
    });
    snackbar.dispose();
    handles.splice(handles.indexOf(snackbar), 1);
    vi.advanceTimersByTime(5000);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("закрытый снекбар скрыт", () => {
    const snackbar = rootOf(mount(Snackbar, { open: false, message: "Скрыто" }));
    expect(snackbar.hasAttribute("hidden")).toBe(true);
    expect(snackbar.hasAttribute("data-open")).toBe(false);
  });
});

interface TestRect {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

function rect(left: number, top: number, width: number, height: number): TestRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

describe("Floating placement", () => {
  const viewport = { width: 1024, height: 768 };

  it("flip: bottom у нижнего края уходит наверх и наоборот", () => {
    const anchorLow = rect(100, 700, 100, 40);
    const panel = rect(100, 748, 220, 200);
    expect(resolveFloatingPlacement(anchorLow, panel, viewport, "bottom").side).toBe("top");

    const anchorHigh = rect(100, 10, 100, 40);
    const panelHigh = rect(100, 58, 220, 200);
    expect(resolveFloatingPlacement(anchorHigh, panelHigh, viewport, "top").side).toBe("bottom");
  });

  it("shift: панель прижимается к правому и левому краю", () => {
    const anchor = rect(900, 100, 100, 40);
    const rightPanel = rect(900, 148, 220, 120);
    const right = resolveFloatingPlacement(anchor, rightPanel, viewport, "bottom");
    expect(right.inlineShift).toBeLessThan(0);
    expect(rightPanel.right + right.inlineShift).toBeLessThanOrEqual(viewport.width - 12);

    const leftPanel = rect(2, 148, 220, 120);
    const left = resolveFloatingPlacement(anchor, leftPanel, viewport, "bottom");
    expect(left.inlineShift).toBeGreaterThan(0);
    expect(leftPanel.left + left.inlineShift).toBeGreaterThanOrEqual(12);
  });

  it("боковые стороны переворачиваются, если не помещаются", () => {
    const leftAnchor = rect(20, 100, 60, 40);
    const leftPanel = rect(-220, 100, 220, 120);
    expect(resolveFloatingPlacement(leftAnchor, leftPanel, viewport, "start").side).toBe("end");

    const rightAnchor = rect(950, 100, 60, 40);
    const rightPanel = rect(1020, 100, 220, 120);
    expect(resolveFloatingPlacement(rightAnchor, rightPanel, viewport, "end").side).toBe("start");
  });

  it("боковая панель прижимается к краям узкого viewport", () => {
    const narrow = { width: 360, height: 800 };
    const anchor = rect(190, 100, 100, 40);
    const panel = rect(300, 100, 192, 60);

    const end = resolveFloatingPlacement(anchor, panel, narrow, "end");
    expect(end.side).toBe("end");
    expect(end.inlineShift).toBeLessThan(0);
    expect(290 + 8 + 192 + end.inlineShift).toBeLessThanOrEqual(narrow.width - 12);

    const start = resolveFloatingPlacement(anchor, panel, narrow, "start");
    expect(start.side).toBe("start");
    expect(start.inlineShift).toBeGreaterThan(0);
    expect(190 - 8 - 192 + start.inlineShift).toBeGreaterThanOrEqual(12);
  });

  it("не двигает панель, когда она помещается целиком", () => {
    const anchor = rect(400, 300, 100, 40);
    const panel = rect(400, 348, 240, 180);
    expect(resolveFloatingPlacement(anchor, panel, viewport, "bottom")).toEqual({
      side: "bottom",
      inlineShift: 0,
      blockShift: 0,
    });
  });
});
