import type {
  Children,
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
      <ellipse />
      <polyline />
      <polygon />
      <text>
        <textPath />
      </text>
      <pattern>
        <rect />
      </pattern>
      <mask>
        <rect />
      </mask>
      <clipPath>
        <rect />
      </clipPath>
      <filter>
        <feGaussianBlur />
        <feOffset />
        <feBlend />
        <feColorMatrix />
        <feComposite />
        <feFlood />
        <feImage />
        <feMerge>
          <feMergeNode />
        </feMerge>
        <feMorphology />
        <feTurbulence />
      </filter>
      <symbol>
        <rect />
      </symbol>
      <marker>
        <path />
      </marker>
      <radialGradient>
        <stop />
      </radialGradient>
      <view />
      <foreignObject>
        <div />
      </foreignObject>
      <desc />
      <metadata />
    </svg>
  </div>
);

export const MappedSvg = () => (
  <svg viewBox="0 0 8 8">
    {[1, 2].map((n) => (
      <path key={n} d="M0 0h8" />
    ))}
  </svg>
);

export function SetChildren() {
  const nodes = new Set<Node>([document.createTextNode("set")]);
  return <div>{nodes}</div>;
}

function* nodeGenerator(): Generator<Node, void, unknown> {
  yield document.createTextNode("gen");
}

export function GeneratorChildren() {
  return <div>{nodeGenerator()}</div>;
}

export const PrimitiveArrayChildren = () => (
  <div>{["a", 1, 2n, true, null, undefined]}</div>
);

function Panel(props: { children?: Children }) {
  return <section>{props.children}</section>;
}

export const PanelUsage = () => (
  <Panel>
    {[1, 2].map((n) => (
      <span key={n}>{n}</span>
    ))}
  </Panel>
);

export const PanelSetUsage = () => (
  <Panel>{new Set<Node>([document.createTextNode("set")])}</Panel>
);