import { Icon } from "../components/icon/index.js";
import { glyphTitle, type GlyphProps } from "./glyph.js";

/** Material Symbols: `format_indent_decrease`. */
export function FormatIndentDecreaseIcon(props: GlyphProps): Node {
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
      <path d="M11 17h10v-2H11v2zm-8-5 4 4V8l-4 4zm0 9h18v-2H3v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z" />
    </Icon>
  );
}
