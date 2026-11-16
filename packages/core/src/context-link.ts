import type { Owner } from "@ivlev-dev/silent-reactivity";

export type ContextValues = Map<object, unknown>;

export interface ContextLink {
  capture(): ContextValues | null;
  adopt(owner: Owner | null, values: ContextValues | null): void;
}

const LINK_KEY = Symbol.for("silent.context.link");

type LinkHost = typeof globalThis & {
  [LINK_KEY]?: ContextLink;
};

function link(): ContextLink | undefined {
  return (globalThis as LinkHost)[LINK_KEY];
}

export function registerContextLink(next: ContextLink): void {
  (globalThis as LinkHost)[LINK_KEY] = next;
}

export function captureContextValues(): ContextValues | null {
  const current = link();
  return current === undefined ? null : current.capture();
}

export function adoptContextValues(
  owner: Owner | null,
  values: ContextValues | null,
): void {
  if (values === null) {
    return;
  }
  const current = link();
  if (current !== undefined) {
    current.adopt(owner, values);
  }
}
