export type ColorFormat = "hex" | "rgb" | "hsl";

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface HsvColor {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

export interface HslColor {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/u;
const RGB_PATTERN = /^rgba?\((.*)\)$/iu;
const HSL_PATTERN = /^hsla?\((.*)\)$/iu;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (trimmed === "") return 1;
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? clamp(percent / 100, 0, 1) : 1;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

function parseRgbChannel(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? clamp(Math.round(percent * 2.55), 0, 255) : null;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? clamp(Math.round(value), 0, 255) : null;
}

function parseHue(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.endsWith("grad")) {
    const value = Number.parseFloat(trimmed.slice(0, -4));
    return Number.isFinite(value) ? ((value * 360) / 400) % 360 : null;
  }
  if (trimmed.endsWith("rad")) {
    const value = Number.parseFloat(trimmed.slice(0, -3));
    return Number.isFinite(value) ? ((value * 180) / Math.PI) % 360 : null;
  }
  if (trimmed.endsWith("turn")) {
    const value = Number.parseFloat(trimmed.slice(0, -4));
    return Number.isFinite(value) ? (value * 360) % 360 : null;
  }
  const value = Number.parseFloat(trimmed.replace(/deg$/u, ""));
  return Number.isFinite(value) ? ((value % 360) + 360) % 360 : null;
}

function parsePercent(raw: string): number | null {
  const value = Number.parseFloat(raw.trim().replace(/%$/u, ""));
  return Number.isFinite(value) ? clamp(value, 0, 100) : null;
}

function splitFunctionBody(body: string): readonly string[] {
  return body
    .trim()
    .split(/\s*[,/]\s*|\s+/u)
    .filter((part) => part !== "");
}

function parseHex(raw: string): RgbaColor | null {
  const match = HEX_PATTERN.exec(raw.trim().toLowerCase());
  if (match === null) return null;
  const value = match[1];
  if (value === undefined) return null;
  const normalized = value.length <= 4
    ? value.split("").map((part) => `${part}${part}`).join("")
    : value;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const a = normalized.length === 8
    ? Number.parseInt(normalized.slice(6, 8), 16) / 255
    : 1;
  return {
    r,
    g,
    b,
    a: round(clamp(a, 0, 1), 3),
  };
}

function parseRgb(raw: string): RgbaColor | null {
  const match = RGB_PATTERN.exec(raw);
  if (match === null) return null;
  const body = match[1];
  if (body === undefined) return null;
  const parts = splitFunctionBody(body);
  if (parts.length < 3) return null;
  const r = parseRgbChannel(parts[0] ?? "");
  const g = parseRgbChannel(parts[1] ?? "");
  const b = parseRgbChannel(parts[2] ?? "");
  if (r === null || g === null || b === null) return null;
  return { r, g, b, a: round(parseAlpha(parts[3]), 3) };
}

function parseHsl(raw: string): RgbaColor | null {
  const match = HSL_PATTERN.exec(raw);
  if (match === null) return null;
  const body = match[1];
  if (body === undefined) return null;
  const parts = splitFunctionBody(body);
  if (parts.length < 3) return null;
  const h = parseHue(parts[0] ?? "");
  const s = parsePercent(parts[1] ?? "");
  const l = parsePercent(parts[2] ?? "");
  if (h === null || s === null || l === null) return null;
  const rgb = hslToRgb({ h, s, l });
  return {
    r: Math.round(rgb.r),
    g: Math.round(rgb.g),
    b: Math.round(rgb.b),
    a: round(parseAlpha(parts[3]), 3),
  };
}

export function parseColor(input: string): RgbaColor | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (trimmed.toLowerCase() === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return parseHex(trimmed) ?? parseRgb(trimmed) ?? parseHsl(trimmed);
}

export function isValidColor(input: string): boolean {
  return parseColor(input) !== null;
}

export function normalizeColor(color: RgbaColor): RgbaColor {
  return {
    r: clamp(Math.round(color.r), 0, 255),
    g: clamp(Math.round(color.g), 0, 255),
    b: clamp(Math.round(color.b), 0, 255),
    a: round(clamp(color.a, 0, 1), 3),
  };
}

export function rgbToHsv(color: RgbaColor): HsvColor {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;
  return { h: round(h, 2), s: round(s, 2), v: round(v, 2) };
}

export function hsvToRgb(hsv: HsvColor, alpha = 1): RgbaColor {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp(hsv.s, 0, 100) / 100;
  const v = clamp(hsv.v, 0, 100) / 100;
  const chroma = v * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (segment < 1) {
    r = chroma;
    g = x;
  } else if (segment < 2) {
    r = x;
    g = chroma;
  } else if (segment < 3) {
    g = chroma;
    b = x;
  } else if (segment < 4) {
    g = x;
    b = chroma;
  } else if (segment < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }
  const m = v - chroma;
  return normalizeColor({
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
    a: alpha,
  });
}

export function rgbToHsl(color: RgbaColor): HslColor {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: round(h, 2), s: round(s * 100, 2), l: round(l * 100, 2) };
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function channel(value: number): number {
  return Math.round(value * 255 + 1e-6);
}

export function hslToRgb(hsl: HslColor): RgbaColor {
  const h = (((hsl.h % 360) + 360) % 360) / 360;
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;
  if (s === 0) {
    const gray = channel(l);
    return { r: gray, g: gray, b: gray, a: 1 };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: channel(hueToRgb(p, q, h + 1 / 3)),
    g: channel(hueToRgb(p, q, h)),
    b: channel(hueToRgb(p, q, h - 1 / 3)),
    a: 1,
  };
}

function hexPart(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

export function toHex(color: RgbaColor, showAlpha = false): string {
  const base = `#${hexPart(color.r)}${hexPart(color.g)}${hexPart(color.b)}`;
  if (!showAlpha) return base;
  const alpha = clamp(color.a, 0, 1);
  return `${base}${hexPart(alpha * 255)}`;
}

function alphaText(alpha: number): string {
  return String(round(clamp(alpha, 0, 1), 3));
}

export function toRgbString(color: RgbaColor, showAlpha = false): string {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  if (!showAlpha) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${alphaText(color.a)})`;
}

export function toHslString(color: RgbaColor, showAlpha = false): string {
  const hsl = rgbToHsl(color);
  const h = round(hsl.h, 0);
  const s = round(hsl.s, 0);
  const l = round(hsl.l, 0);
  if (!showAlpha) return `hsl(${h}, ${s}%, ${l}%)`;
  return `hsla(${h}, ${s}%, ${l}%, ${alphaText(color.a)})`;
}

export function formatColor(
  color: RgbaColor,
  format: ColorFormat,
  showAlpha = false,
): string {
  const normalized = normalizeColor(color);
  switch (format) {
    case "rgb":
      return toRgbString(normalized, showAlpha);
    case "hsl":
      return toHslString(normalized, showAlpha);
    case "hex":
    default:
      return toHex(normalized, showAlpha);
  }
}

export function toCssColor(color: RgbaColor): string {
  const normalized = normalizeColor(color);
  return `rgba(${normalized.r}, ${normalized.g}, ${normalized.b}, ${normalized.a})`;
}

export function colorsEqual(left: RgbaColor, right: RgbaColor): boolean {
  return (
    Math.round(left.r) === Math.round(right.r)
    && Math.round(left.g) === Math.round(right.g)
    && Math.round(left.b) === Math.round(right.b)
    && round(left.a, 3) === round(right.a, 3)
  );
}
