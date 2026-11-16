import { createRoot } from "@ivlev-dev/silent-reactivity";
import type { RouterViewComponentProps } from "../src/index";

export interface Rendered {
  readonly host: HTMLElement;
  dispose(): void;
}

export function render(factory: () => Node): Rendered {
  const host = document.createElement("div");
  let stop = (): void => {};
  createRoot((dispose) => {
    stop = dispose;
    host.appendChild(factory());
  });
  document.body.appendChild(host);
  return {
    host,
    dispose(): void {
      stop();
      host.remove();
    },
  };
}

export function view(label: string): (props: RouterViewComponentProps) => HTMLElement {
  return (props): HTMLElement => {
    const element = document.createElement("p");
    element.dataset.view = label;
    const id = props.params["id"];
    element.textContent = id === undefined ? label : `${label}:${id}`;
    return element;
  };
}

export function leaf(label: string): () => HTMLElement {
  return (): HTMLElement => {
    const element = document.createElement("span");
    element.dataset.view = label;
    element.textContent = label;
    return element;
  };
}

export function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
