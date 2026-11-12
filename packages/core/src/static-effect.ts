import { createRenderEffect, createRoot } from "@ivlev-dev/silent-reactivity";

type EffectUnlessStatic = (fn: () => void) => (() => void) | null;

const UNLESS_STATIC_EFFECT = Symbol.for("silent.effectUnlessStatic");

const registry = createRoot as unknown as Record<symbol, unknown>;
const effectCandidate = registry[UNLESS_STATIC_EFFECT];

export const createEffectUnlessStatic: EffectUnlessStatic =
  typeof effectCandidate === "function"
    ? (effectCandidate as EffectUnlessStatic)
    : (fn) =>
        createRoot((dispose) => {
          createRenderEffect(fn);
          return dispose;
        });
