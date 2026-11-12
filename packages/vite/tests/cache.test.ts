import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashContent,
  pruneTransformCache,
  readTransformCache,
  transformCacheKey,
  writeTransformCache,
} from "../src/cache.js";

const directories: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "silent-cache-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const result = { code: "ok", map: null, diagnostics: [] };

describe("transform cache", () => {
  it("строит ключ из всех частей", () => {
    expect(transformCacheKey(["a", "b"])).toBe(transformCacheKey(["a", "b"]));
    expect(transformCacheKey(["a", "b"])).not.toBe(transformCacheKey(["a", "c"]));
    expect(transformCacheKey(["ab"])).not.toBe(transformCacheKey(["a", "b"]));
  });

  it("сохраняет и читает результат", () => {
    const directory = tempDirectory();
    const key = transformCacheKey(["view"]);
    expect(readTransformCache(directory, key)).toBeNull();
    writeTransformCache(directory, key, result);
    expect(readTransformCache(directory, key)).toEqual(result);
  });

  it("игнорирует повреждённую запись", () => {
    const directory = tempDirectory();
    const key = transformCacheKey(["broken"]);
    writeFileSync(join(directory, `${key}.json`), "{");
    expect(readTransformCache(directory, key)).toBeNull();
  });

  it("игнорирует запись неверной структуры", () => {
    const directory = tempDirectory();
    const key = transformCacheKey(["shape"]);
    writeFileSync(join(directory, `${key}.json`), JSON.stringify({ code: 1 }));
    expect(readTransformCache(directory, key)).toBeNull();
  });

  it("удаляет самые старые записи при превышении лимита", () => {
    const directory = tempDirectory();
    for (let index = 0; index < 3; index += 1) {
      const key = transformCacheKey([String(index)]);
      writeTransformCache(directory, key, result);
      const time = new Date(Date.now() - (3 - index) * 1000);
      utimesSync(join(directory, `${key}.json`), time, time);
    }
    pruneTransformCache(directory, 2);
    expect(readdirSync(directory).filter((name) => name.endsWith(".json")).length).toBe(2);
  });

  it("хэш содержимого стабилен и различает входы", () => {
    expect(hashContent("value")).toBe(hashContent("value"));
    expect(hashContent("value")).not.toBe(hashContent("other"));
  });
});
