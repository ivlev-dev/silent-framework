// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  IdSequence,
  createId,
  createIdGenerator,
  currentIdCount,
  resetIds,
  useId,
  withIdScope,
} from "../src/id.js";

afterEach(() => {
  resetIds();
});

describe("createId", () => {
  it("выдаёт уникальные id с префиксом", () => {
    resetIds();
    const first = createId("field");
    const second = createId("field");
    const other = useId("aria");

    expect(first).toBe("field-1");
    expect(second).toBe("field-2");
    expect(other).toBe("aria-3");
    expect(new Set([first, second, other]).size).toBe(3);
    expect(currentIdCount()).toBe(3);
  });

  it("сбрасывает счётчик детерминированно", () => {
    resetIds();
    const first = createId();
    resetIds();
    expect(createId()).toBe(first);
    expect(currentIdCount()).toBe(1);
  });

  it("изолирует scope через withIdScope", () => {
    resetIds();
    expect(createId()).toBe("silent-1");

    const scoped = withIdScope(() => [createId(), createId()]);
    expect(scoped).toEqual(["silent-1", "silent-2"]);
    expect(currentIdCount()).toBe(1);
    expect(createId()).toBe("silent-2");
  });

});

describe("IdSequence", () => {
  it("ведёт независимую последовательность", () => {
    const sequence = createIdGenerator("item");
    expect(sequence.count).toBe(0);
    expect(sequence.next()).toBe("item-1");
    expect(sequence.next()).toBe("item-2");
    expect(sequence.next("custom")).toBe("custom-3");
    expect(sequence.count).toBe(3);

    sequence.reset();
    expect(sequence.count).toBe(0);
    expect(sequence.next()).toBe("item-1");
  });

  it("не влияет на глобальный счётчик", () => {
    resetIds();
    const sequence = new IdSequence();
    sequence.next();
    expect(currentIdCount()).toBe(0);
  });
});
