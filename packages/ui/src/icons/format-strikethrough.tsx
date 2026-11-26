import { Icon } from "../components/icon/index.js";
import { glyphTitle, type GlyphProps } from "./glyph.js";

/** Material Symbols: `format_strikethrough`. */
export function FormatStrikethroughIcon(props: GlyphProps): Node {
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
      <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z" />
    </Icon>
  );
}
