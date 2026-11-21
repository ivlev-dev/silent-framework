const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;

/**
 * Режет строку на куски длиной не больше chunkSize и отдаёт их в emit
 * без промежуточного массива. Суррогатные пары UTF-16 не разрываются:
 * иначе при независимом кодировании чанков (Buffer/TextEncoder) пара
 * превращается в U+FFFD.
 */
export function forEachChunk(
  text: string,
  chunkSize: number,
  emit: (chunk: string) => void,
): void {
  const normalized = Math.trunc(chunkSize);
  const size = Number.isFinite(normalized) && normalized > 0 ? normalized : 1;
  const length = text.length;
  if (length === 0) {
    return;
  }
  if (length <= size) {
    emit(text);
    return;
  }
  let start = 0;
  while (start < length) {
    let end = start + size;
    if (end >= length) {
      emit(text.slice(start));
      return;
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
    emit(text.slice(start, end));
    start = end;
  }
}

/** Совместимая обёртка над forEachChunk для тестов и внешних вызовов. */
export function splitChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  forEachChunk(text, chunkSize, (chunk) => {
    chunks.push(chunk);
  });
  return chunks;
}
