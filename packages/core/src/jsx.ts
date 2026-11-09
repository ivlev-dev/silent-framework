export type Child = Node | string | number | bigint | boolean | null | undefined;

export type Children = Child | Child[] | (() => Children);

export namespace JSX {
  export type Element = Node;

  export type ElementType = keyof IntrinsicElements | ((...args: never[]) => Element);

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicAttributes {
    key?: string | number;
  }

  export interface IntrinsicElements {
    a: AProps;
    button: ButtonProps;
    div: CommonProps;
    form: FormProps;
    h1: CommonProps;
    h2: CommonProps;
    h3: CommonProps;
    h4: CommonProps;
    h5: CommonProps;
    h6: CommonProps;
    img: ImgProps;
    input: InputProps;
    label: CommonProps;
    li: CommonProps;
    main: CommonProps;
    nav: CommonProps;
    ol: CommonProps;
    option: CommonProps;
    p: CommonProps;
    section: CommonProps;
    select: SelectProps;
    span: CommonProps;
    table: CommonProps;
    textarea: TextareaProps;
    ul: CommonProps;
    svg: CommonProps;
    path: CommonProps;
    circle: CommonProps;
    rect: CommonProps;
    line: CommonProps;
    g: CommonProps;
    defs: CommonProps;
    linearGradient: CommonProps;
    stop: CommonProps;
    use: CommonProps;
    text: CommonProps;
    tspan: CommonProps;
    strong: CommonProps;
    em: CommonProps;
    small: CommonProps;
    code: CommonProps;
    pre: CommonProps;
    header: CommonProps;
    footer: CommonProps;
    article: CommonProps;
    aside: CommonProps;
    figure: CommonProps;
    figcaption: CommonProps;
    dl: CommonProps;
    dt: CommonProps;
    dd: CommonProps;
    hr: CommonProps;
    br: CommonProps;
    canvas: CommonProps;
    video: CommonProps;
    audio: CommonProps;
    source: CommonProps;
    iframe: CommonProps;
    [tag: string]: CommonProps;
  }
}

interface CommonProps {
  class?: string;
  className?: string;
  id?: string;
  style?: string | Record<string, string | number | null | undefined>;
  ref?: unknown;
  children?: Children;
  dangerouslySetInnerHTML?: { __html: string };
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: InputEvent) => void;
  onChange?: (event: Event) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyUp?: (event: KeyboardEvent) => void;
  onSubmit?: (event: SubmitEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onScroll?: (event: Event) => void;
  onPointerDown?: (event: PointerEvent) => void;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;
  [key: string]: unknown;
}

interface InputProps extends CommonProps {
  value?: string | number | readonly string[] | undefined;
  checked?: boolean;
  disabled?: boolean;
  placeholder?: string;
  type?: string;
  name?: string;
}

interface TextareaProps extends CommonProps {
  value?: string | number | readonly string[] | undefined;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
}

interface SelectProps extends CommonProps {
  value?: string | number | readonly string[] | undefined;
  disabled?: boolean;
  name?: string;
}

interface ImgProps extends CommonProps {
  src?: string;
  alt?: string;
}

interface AProps extends CommonProps {
  href?: string;
  target?: string;
}

interface ButtonProps extends CommonProps {
  disabled?: boolean;
  type?: string;
  name?: string;
}

interface FormProps extends CommonProps {
  onSubmit?: (event: SubmitEvent) => void;
}

export type Component<P = Record<string, never>> = (props: P) => JSX.Element;

export type ViewContext<
  VM extends object,
  Preloader extends Component<never> = Component<never>,
> = { vm: VM; preloader: Preloader };

export type ViewComponent<
  P,
  VM extends object,
  Preloader extends Component<never>,
> = (this: ViewContext<VM, Preloader>, props: P) => JSX.Element;

export type SyncComponent<P> = (props: P) => JSX.Element;