import { Icon } from "../components/icon/index.js";
import { glyphTitle, type GlyphProps } from "./glyph.js";

/** Material Symbols: `format_h1` (сетка 960 → 24px). */
export function FormatH1Icon(props: GlyphProps): Node {
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
      <path d="M5 17v-10h2v4h4v-4h2v10h-2v-4H7v4h-2Zm12 0v-8h-2v-2h4v10h-2Z" />
    </Icon>
  );
}
