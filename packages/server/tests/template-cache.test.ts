import { afterEach, describe, expect, it } from "vitest";
import {
  TEMPLATE_CACHE_LIMIT,
  clearTemplateCache,
  getTemplate,
  hasTemplate,
  setTemplate,
  templateCacheSize,
  type ParsedTemplate,
} from "../src/template-cache.js";

function entry(id: number): ParsedTemplate {
  return {
    parts: [`<i>${id}</i>`, ""],
    indexes: [0],
    markers: ["<!--silent-hole-0-->"],
  };
}

afterEach(() => {
  clearTemplateCache();
});

describe("template cache", () => {
  it("возвращает undefined для отсутствующего шаблона", () => {
    expect(getTemplate("<div></div>")).toBeUndefined();
    expect(templateCacheSize()).toBe(0);
  });

  it("хранит и отдаёт разобранный шаблон", () => {
    const parsed = entry(1);
    setTemplate("<i></i>", parsed);

    expect(getTemplate("<i></i>")).toBe(parsed);
    expect(hasTemplate("<i></i>")).toBe(true);
    expect(templateCacheSize()).toBe(1);
  });

  it("кэширует отрицательный результат", () => {
    setTemplate("<meta>", null);

    expect(getTemplate("<meta>")).toBeNull();
    expect(hasTemplate("<meta>")).toBe(true);
  });

  it("обновляет давность при чтении", () => {
    const first = entry(0);
    setTemplate("first", first);
    for (let index = 0; index < TEMPLATE_CACHE_LIMIT - 1; index += 1) {
      setTemplate(`filler-${index}`, entry(index));
    }

    expect(templateCacheSize()).toBe(TEMPLATE_CACHE_LIMIT);
    expect(getTemplate("first")).toBe(first);

    setTemplate("overflow", entry(99));

    expect(templateCacheSize()).toBe(TEMPLATE_CACHE_LIMIT);
    expect(hasTemplate("first")).toBe(true);
    expect(hasTemplate("filler-0")).toBe(false);
  });

  it("вытесняет самую старую запись при переполнении", () => {
    for (let index = 0; index <= TEMPLATE_CACHE_LIMIT; index += 1) {
      setTemplate(`template-${index}`, entry(index));
    }

    expect(templateCacheSize()).toBe(TEMPLATE_CACHE_LIMIT);
    expect(hasTemplate("template-0")).toBe(false);
    expect(hasTemplate("template-1")).toBe(true);
  });

  it("очищает кэш", () => {
    setTemplate("x", entry(1));
    clearTemplateCache();

    expect(templateCacheSize()).toBe(0);
    expect(hasTemplate("x")).toBe(false);
  });
});
