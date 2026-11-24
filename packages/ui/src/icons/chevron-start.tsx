import { Icon } from "../components/icon/index.js";
import { glyphTitle, type GlyphProps } from "./glyph.js";

/** Material Symbols: `keyboard_arrow_left` — chevron-start (LTR). */
export function ChevronStartIcon(props: GlyphProps): Node {
  const title = props.title ?? props.label;
  return (
    <Icon
      size={props.size}
      label={title}
      class={props.class}
      style={props.style}
      attrs={{ fill: "currentColor", ...props.attrs }}
    >
      {title === undefined ? null : glyphTitle(title)}
      <path d="M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
    </Icon>
  );
}
