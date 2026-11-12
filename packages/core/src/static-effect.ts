import { createRenderEffect, createRoot } from "@ivlev-dev/silent-reactivity";

type UnlessStatic = (fn: () => void) => boolean;
type EffectUnlessStatic = (fn: () => void) => (() => void) | null;
type Scoped = (fn: () => void) => () => void;

const UNLESS_STATIC = Symbol.for("silent.renderEffectUnlessStatic");
const UNLESS_STATIC_EFFECT = Symbol.for("silent.effectUnlessStatic");
const SCOPED = Symbol.for("silent.scopedRenderEffect");

const registry = createRoot as unknown as Record<symbol, unknown>;
const unlessStaticCandidate = registry[UNLESS_STATIC];
const effectCandidate = registry[UNLESS_STATIC_EFFECT];
const scopedCandidate = registry[SCOPED];

export const renderEffectUnlessStatic: UnlessStatic =
  typeof unlessStaticCandidate === "function"
    ? (unlessStaticCandidate as UnlessStatic)
    : (fn) => {
        createRenderEffect(fn);
        return true;
      };

export const effectUnlessStatic: EffectUnlessStatic =
  typeof effectCandidate === "function"
    ? (effectCandidate as EffectUnlessStatic)
    : (fn) => {
        if (typeof scopedCandidate !== "function") {
          createRenderEffect(fn);
          return null;
        }
        return (scopedCandidate as Scoped)(fn);
      };
