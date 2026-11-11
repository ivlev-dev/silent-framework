import { createRenderEffect, createRoot } from "@ivlev-dev/silent-reactivity";

type UnlessStatic = (fn: () => void) => boolean;
type Lazy = (fn: () => void) => (() => void) | null;
type Scoped = (fn: () => void) => () => void;

const UNLESS_STATIC = Symbol.for("silent.renderEffectUnlessStatic");
const LAZY = Symbol.for("silent.lazyRenderEffect");
const SCOPED = Symbol.for("silent.scopedRenderEffect");

const registry = createRoot as unknown as Record<symbol, unknown>;
const unlessStaticCandidate = registry[UNLESS_STATIC];
const lazyCandidate = registry[LAZY];
const scopedCandidate = registry[SCOPED];

const unlessStaticFallback: UnlessStatic = (fn) => {
  createRenderEffect(fn);
  return true;
};

export const renderEffectUnlessStatic: UnlessStatic =
  typeof unlessStaticCandidate === "function"
    ? (unlessStaticCandidate as UnlessStatic)
    : unlessStaticFallback;

export const createLazyRenderEffect: Lazy =
  typeof lazyCandidate === "function"
    ? (lazyCandidate as Lazy)
    : (fn) => {
        if (typeof scopedCandidate !== "function") {
          createRenderEffect(fn);
          return null;
        }
        return (scopedCandidate as Scoped)(fn);
      };
