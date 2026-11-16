// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRoot,
  createSignal,
  flushSync,
} from "@ivlev-dev/silent-reactivity";
import { Portal, Teleport } from "../src/portal";
import { Presence, Transition } from "../src/transition";
import { disposeNode, setServerMode, text } from "../src/dom";

const hosts: HTMLElement[] = [];

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

function span(value: string): HTMLElement {
  const element = document.createElement("span");
  element.textContent = value;
  return element;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

afterEach(() => {
  vi.useRealTimers();
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
  setServerMode(false);
});

describe("Portal", () => {
  it("переносит содержимое в target, сохраняет реактивность и очищает target при unmount", () => {
    const target = host();
    const [count, setCount] = createSignal(0);
    const wrapper = span("");
    const textNode = document.createTextNode("");
    wrapper.appendChild(textNode);
    text(textNode, () => `count ${count()}`);

    const portal = Portal({ target, children: wrapper });
    expect(target.contains(wrapper)).toBe(true);
    expect(wrapper.textContent).toBe("count 0");

    setCount(3);
    flushSync();
    expect(wrapper.textContent).toBe("count 3");

    disposeNode(portal);
    expect(target.contains(wrapper)).toBe(false);
    expect(target.childNodes.length).toBe(0);
  });

  it("принимает селектор и функцию, а также поддерживает вложенные Portal", async () => {
    const outerTarget = host();
    outerTarget.id = "portal-outer";
    const innerTarget = host();
    innerTarget.id = "portal-inner";
    const innerContent = span("inner");

    const outer = Portal({
      target: () => document.querySelector<Element>("#portal-outer"),
      children: () => {
        const wrapper = document.createElement("div");
        wrapper.appendChild(
          Portal({ target: "#portal-inner", children: innerContent }),
        );
        return wrapper;
      },
    });

    expect(outerTarget.querySelector("div")).not.toBeNull();
    expect(innerTarget.contains(innerContent)).toBe(true);

    disposeNode(outer);
    expect(outerTarget.childNodes.length).toBe(0);
    expect(innerTarget.contains(innerContent)).toBe(false);
  });

  it("без target рендерит содержимое на месте и не теряет его", async () => {
    const container = host();
    const content = span("fallback");
    const portal = Portal({ target: "#missing-target", children: content });
    container.appendChild(portal);

    expect(container.contains(content)).toBe(false);
    await settle();
    expect(container.contains(content)).toBe(true);

    disposeNode(portal);
    expect(container.contains(content)).toBe(false);
  });

  it("Teleport является псевдонимом Portal", () => {
    expect(Teleport).toBe(Portal);
  });

  it("на сервере отдаёт только маркер", () => {
    setServerMode(true);
    const node = Portal({ target: "body", children: span("server") });
    setServerMode(false);
    expect(node.nodeType).toBe(Node.COMMENT_NODE);
    expect((node as Comment).data).toBe("silent-portal");
  });
});

describe("Transition", () => {
  it("проигрывает enter и leave, сохраняя DOM до конца leave", () => {
    vi.useFakeTimers();
    const container = host();
    const content = span("content");
    const fallback = span("fallback");
    const [show, setShow] = createSignal(true);

    const dispose = createRoot((disposeRoot) => {
      container.appendChild(
        Transition({
          show,
          children: content,
          fallback,
          enterClass: "enter",
          leaveClass: "leave",
          duration: 100,
        }),
      );
      return disposeRoot;
    });
    flushSync();

    expect(container.contains(content)).toBe(true);
    expect(content.classList.contains("enter")).toBe(true);

    vi.advanceTimersByTime(100);
    expect(content.classList.contains("enter")).toBe(false);

    setShow(false);
    flushSync();
    expect(container.contains(content)).toBe(true);
    expect(content.classList.contains("leave")).toBe(true);
    expect(content.classList.contains("enter")).toBe(false);

    vi.advanceTimersByTime(99);
    expect(container.contains(content)).toBe(true);

    vi.advanceTimersByTime(1);
    flushSync();
    expect(container.contains(content)).toBe(false);
    expect(container.contains(fallback)).toBe(true);

    dispose();
  });

  it("выдерживает повторный toggle во время leave и не теряет состояние", () => {
    vi.useFakeTimers();
    const container = host();
    const content = span("content");
    const [show, setShow] = createSignal(true);

    const dispose = createRoot((disposeRoot) => {
      container.appendChild(
        Transition({
          show,
          children: content,
          enterClass: "enter",
          leaveClass: "leave",
          duration: 100,
        }),
      );
      return disposeRoot;
    });
    flushSync();

    setShow(false);
    flushSync();
    expect(content.classList.contains("leave")).toBe(true);

    vi.advanceTimersByTime(50);
    setShow(true);
    flushSync();
    expect(container.contains(content)).toBe(true);
    expect(content.classList.contains("enter")).toBe(true);
    expect(content.classList.contains("leave")).toBe(false);

    vi.advanceTimersByTime(200);
    expect(container.contains(content)).toBe(true);
    expect(content.classList.contains("enter")).toBe(false);

    dispose();
  });

  it("не размонтирует содержимое при unmount=false", () => {
    vi.useFakeTimers();
    const container = host();
    const content = span("content");
    const [show, setShow] = createSignal(true);

    const dispose = createRoot((disposeRoot) => {
      container.appendChild(
        Transition({
          show,
          children: content,
          leaveClass: "leave",
          duration: 50,
          unmount: false,
        }),
      );
      return disposeRoot;
    });
    flushSync();

    setShow(false);
    flushSync();
    vi.advanceTimersByTime(50);
    flushSync();

    expect(container.contains(content)).toBe(true);
    expect(content.classList.contains("leave")).toBe(false);

    setShow(true);
    flushSync();
    expect(container.contains(content)).toBe(true);
    dispose();
  });

  it("поддерживает when и fallback для изначально скрытого состояния", () => {
    const container = host();
    const content = span("content");
    const fallback = span("fallback");
    const dispose = createRoot((disposeRoot) => {
      container.appendChild(
        Transition({ when: false, children: content, fallback }),
      );
      return disposeRoot;
    });
    flushSync();

    expect(container.contains(fallback)).toBe(true);
    expect(container.contains(content)).toBe(false);
    dispose();
  });

  it("очищает таймеры при dispose во время анимации", () => {
    vi.useFakeTimers();
    const container = host();
    const content = span("content");
    const [show, setShow] = createSignal(true);

    const dispose = createRoot((disposeRoot) => {
      container.appendChild(
        Transition({
          show,
          children: content,
          leaveClass: "leave",
          duration: 100,
        }),
      );
      return disposeRoot;
    });
    flushSync();

    setShow(false);
    flushSync();
    expect(vi.getTimerCount()).toBe(1);

    dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.runOnlyPendingTimers();
    expect(container.contains(content)).toBe(false);
  });

  it("Presence является псевдонимом Transition", () => {
    expect(Presence).toBe(Transition);
  });

  it("на сервере рендерит содержимое без анимационных классов и маркеров", () => {
    setServerMode(true);
    const content = span("server");
    const node = Transition({
      show: true,
      children: content,
      enterClass: "enter",
      duration: 100,
    });
    setServerMode(false);

    const fragment = node as DocumentFragment;
    expect(fragment.textContent).toBe("server");
    expect((content as HTMLElement).classList.contains("enter")).toBe(false);
    const last = fragment.lastChild;
    expect(last?.nodeType).toBe(Node.COMMENT_NODE);
    expect((last as Comment).data).toBe("silent-transition");
  });
});
