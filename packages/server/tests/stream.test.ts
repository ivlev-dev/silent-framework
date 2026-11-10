import { describe, expect, it } from "vitest";
import { templateHoles, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToStream } from "../src/stream.js";

function page(): Node {
  return templateHoles(
    '<div class="page"><title>Page</title><meta name="description" content="desc"><h1>Body</h1></div>',
  )().node;
}

describe("renderToStream", () => {
  it("вызывает onHead и отдаёт тело чанками", async () => {
    let head = "";
    const stream = renderToStream(page as unknown as AnyComponent, {
      chunkSize: 8,
      onHead: (value) => {
        head = value;
      },
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(head).toContain("<title>Page</title>");
    expect(head).toContain('name="description"');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 8)).toBe(true);
    expect(chunks.join("")).toContain("<h1>Body</h1>");
    expect(chunks.join("")).not.toContain("<title");
  });

  it("пробрасывает ошибку рендера в поток", async () => {
    function Broken(): Node {
      throw new Error("boom");
    }

    const stream = renderToStream(Broken as unknown as AnyComponent);

    await expect(async () => {
      for await (const chunk of stream) {
        void chunk;
      }
    }).rejects.toThrow("boom");
  });
});
