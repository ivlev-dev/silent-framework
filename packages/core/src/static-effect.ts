import { createRenderEffect, createRoot } from "@ivlev-dev/silent-reactivity";

type UnlessStatic = (fn: () => void) => boolean;

const UNLESS_STATIC = Symbol.for("silent.renderEffectUnlessStatic");
const registry = createRoot as unknown as Record<symbol, unknown>;
const candidate = registry[UNLESS_STATIC];

export const renderEffectUnlessStatic: UnlessStatic =
  typeof candidate === "function"
    ? (candidate as UnlessStatic)
    : (fn) => {
        createRenderEffect(fn);
        return true;
      };
