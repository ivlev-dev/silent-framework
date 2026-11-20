import { describe, expect, it } from "vitest";
import { type AnyComponent } from "@ivlev-dev/silent-core";
import { serializeNodeChunks } from "../src/dom/serializer.js";
import { ElementImpl, TextImpl } from "../src/dom/node.js";
import { renderToStream } from "../src/stream.js";

const GRINNING = "\u{1F600}";
const CJK_EXT_B = "\u{20000}";
const TEXT = `a${GRINNING}b${CJK_EXT_B}c${GRINNING}${CJK_EXT_B}d`;
const EXPECTED = `<p>${TEXT}</p>`;
const CHUNK_SIZES: readonly number[] = [1, 2, 3, 4, 5];

function decodeChunks(chunks: readonly string[]): string {
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function expectWholeCodePoints(chunks: readonly string[], chunkSize: number): void {
  const limit = chunkSize === 1 ? 2 : chunkSize;
  expect(chunks.every((chunk) => chunk.length <= limit)).toBe(true);
  for (const chunk of chunks) {
    const first = chunk.charCodeAt(0);
    const last = chunk.charCodeAt(chunk.length - 1);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  }
}

function textPage(): AnyComponent {
  return function Page(): Node {
    const paragraph = document.createElement("p");
    paragraph.textContent = TEXT;
    return paragraph;
  } as unknown as AnyComponent;
}

describe("splitChunks через serializeNodeChunks", () => {
  for (const chunkSize of CHUNK_SIZES) {
    it(`не разрывает суррогатные пары при chunkSize=${chunkSize}`, () => {
      const root = new ElementImpl("p");
      root.appendChild(new TextImpl(TEXT));
      const chunks: string[] = [];

      serializeNodeChunks(root, chunkSize, (chunk) => {
        chunks.push(chunk);
      });

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join("")).toBe(EXPECTED);
      expect(decodeChunks(chunks)).toBe(EXPECTED);
      expect(decodeChunks(chunks)).not.toContain("\uFFFD");
      expectWholeCodePoints(chunks, chunkSize);
    });
  }
});

describe("splitChunks через renderToStream", () => {
  for (const chunkSize of CHUNK_SIZES) {
    it(`не разрывает суррогатные пары при chunkSize=${chunkSize}`, async () => {
      const chunks: string[] = [];
      const stream = renderToStream(textPage(), {
        chunkSize,
        onShell: () => {},
      });

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(decodeChunks(chunks)).toBe(EXPECTED);
      expectWholeCodePoints(chunks, chunkSize);
    });
  }
});
