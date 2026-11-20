const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;

/**
 * Режет строку на куски длиной не больше chunkSize, не разрывая
 * суррогатные пары UTF-16: иначе при независимом кодировании чанков
 * (Buffer/TextEncoder) пара превращается в U+FFFD.
 */
export function splitChunks(text: string, chunkSize: number): string[] {
  const normalized = Math.trunc(chunkSize);
  const size = Number.isFinite(normalized) && normalized > 0 ? normalized : 1;
  if (text.length === 0) {
    return [];
  }
  if (text.length <= size) {
    return [text];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + size;
    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }
    const code = text.charCodeAt(end - 1);
    if (code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END) {
      if (end - start > 1) {
        end -= 1;
      } else {
        // chunkSize = 1: отдаём суррогатную пару целиком.
        end += 1;
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
