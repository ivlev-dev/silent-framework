import type {
  ViewContext,
  Component,
} from "../src/jsx";
import { Suspense, lazy } from "../src/suspense";

interface CounterVM {
  count: number;
}

function CounterPreloader() {
  return <span />;
}

export function Counter(
  this: ViewContext<CounterVM, typeof CounterPreloader>,
  props: { count: number },
) {
  return <span class="count">{this.vm.count}</span>;
}

export function PositiveUsage() {
  return <Counter count={3} />;
}

export function MissingProp() {
  // @ts-expect-error
  return <Counter />;
}

export function BadProp() {
  // @ts-expect-error
  return <Counter count="x" />;
}

function Loader(props: { text?: string }) {
  return <span>{props.text}</span>;
}

export function LoaderUsage() {
  return <Loader />;
}

const LazyCounter = lazy<{ count: number }>(async () => ({
  default: Counter as unknown as (...args: never[]) => unknown,
}));

export function SuspenseUsage() {
  return (
    <Suspense fallback={<span>wait</span>}>
      <LazyCounter count={1} />
    </Suspense>
  );
}

export function LazyBadProp() {
  // @ts-expect-error
  return <LazyCounter count="x" />;
}

export const IntrinsicCheck = () => (
  <div class="x" onClick={(e) => e.clientX} onInput={(e) => e.data}>
    <a href="/" target="_blank">
      link
    </a>
    <img src="/x.png" alt="x" />
    <input value={1} checked disabled placeholder="p" type="text" name="n" />
    <textarea disabled placeholder="t" name="ta" />
    <select disabled name="sel" />
    <form onSubmit={(e) => e.preventDefault()} />
    <svg>
      <path />
      <circle />
      <rect />
      <line />
      <g>
        <defs />
        <linearGradient />
        <stop />
        <use />
        <text>
          <tspan />
        </text>
      </g>
    </svg>
  </div>
);