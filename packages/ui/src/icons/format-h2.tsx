import { Icon } from "../components/icon/index.js";
import { glyphTitle, type GlyphProps } from "./glyph.js";

/** Material Symbols: `format_h2` (сетка 960 → 24px). */
export function FormatH2Icon(props: GlyphProps): Node {
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
      <path d="M3 17v-10h2v4h4v-4h2v10h-2v-4H5v4h-2Zm10 0v-4q0 -.825 .5875 -1.4125T15 11h4v-2H13v-2h6q.825 0 1.4125 .5875T21 9v2q0 .825 -.5875 1.4125T19 13H15v2h6v2H13Z" />
    </Icon>
  );
}
