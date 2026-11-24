import type { IconProps } from "../components/icon/index.js";

/**
 * Свойства глифа Material Symbols.
 *
 * - `title` — доступное имя: SVG получает `role="img"` и `<title>`.
 * - `label` — алиас `title` из `Icon` (совместимость с существующими иконками).
 * - `size` — шаг шкалы `Icon` (`sm`/`md`/`lg`/`xl`), по умолчанию `md`.
 */
export interface GlyphProps extends Omit<IconProps, "children"> {
  readonly title?: string | undefined;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * `<title>` в SVG-неймспейсе.
 *
 * JSX-компилятор создаёт элементы вне списка SVG-тегов ядра как HTML,
 * поэтому заголовок строится явно. Работает и на клиенте, и в SSR
 * (серверная сессия устанавливает DOM-глобали).
 */
export function glyphTitle(text: string): Node {
  const element = document.createElementNS(SVG_NAMESPACE, "title");
  element.textContent = text;
  return element;
}
