import { Icon } from "../components/icon/index.js";
import { glyphTitle, type GlyphProps } from "./glyph.js";

/** Material Symbols: `format_underlined`. */
export function FormatUnderlineIcon(props: GlyphProps): Node {
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
      <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z" />
    </Icon>
  );
}
