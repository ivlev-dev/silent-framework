import { describe, expect, it } from "vitest";
import {
  POOL_PROTOCOL,
  isProtocolCompatible,
  isWireError,
  reviveError,
  serializeError,
} from "../../src/pool/protocol.js";

describe("pool protocol", () => {
  it("сериализует и восстанавливает name/message/stack/code/cause", () => {
    const cause = Object.assign(new Error("корень"), { code: "root-code" });
    const original = Object.assign(new Error("верхняя ошибка", { cause }), {
      name: "RenderReentrancyError",
      code: "top-code",
    });

    const wire = serializeError(original);
    expect(wire).toMatchObject({
      name: "RenderReentrancyError",
      message: "верхняя ошибка",
      code: "top-code",
    });
    expect(wire.stack).toBe(original.stack);
    expect(wire.cause).toMatchObject({
      name: "Error",
      message: "корень",
      code: "root-code",
    });

    const revived = reviveError(wire);
    expect(revived.name).toBe("RenderReentrancyError");
    expect(revived.message).toBe(original.message);
    expect(revived.stack).toBe(original.stack);
    expect((revived as Error & { code?: string }).code).toBe("top-code");
    expect(revived.cause).toBeInstanceOf(Error);
    expect((revived.cause as Error).message).toBe("корень");
    expect((revived.cause as Error & { code?: string }).code).toBe("root-code");
  });

  it("сохраняет RenderReentrancyError по name", () => {
    const error = new Error("вложенный рендер");
    error.name = "RenderReentrancyError";
    const revived = reviveError(serializeError(error));
    expect(revived.name).toBe("RenderReentrancyError");
  });

  it("ограничивает глубину cause тремя уровнями", () => {
    const level3 = new Error("3", { cause: new Error("4") });
    const level2 = new Error("2", { cause: level3 });
    const level1 = new Error("1", { cause: level2 });
    const wire = serializeError(level1);

    expect(wire.cause?.message).toBe("2");
    expect(wire.cause?.cause?.message).toBe("3");
    expect(wire.cause?.cause?.cause?.message).toBe("4");
    expect(wire.cause?.cause?.cause?.cause).toBeUndefined();
  });

  it("сериализует не-Error значения", () => {
    expect(serializeError("текст")).toEqual({
      name: "Error",
      message: "текст",
    });
    expect(serializeError(42)).toEqual({
      name: "Error",
      message: "42",
    });
  });

  it("понимает только текущую версию протокола", () => {
    expect(POOL_PROTOCOL).toBe(1);
    expect(isProtocolCompatible({ protocol: POOL_PROTOCOL })).toBe(true);
    expect(isProtocolCompatible({ protocol: POOL_PROTOCOL + 1 })).toBe(false);
    expect(isProtocolCompatible(null)).toBe(false);
    expect(isProtocolCompatible("protocol")).toBe(false);
  });

  it("валидирует форму wire-ошибки", () => {
    expect(isWireError({ name: "Error", message: "x" })).toBe(true);
    expect(
      isWireError({
        name: "Error",
        message: "x",
        cause: { name: "Cause", message: "root" },
      }),
    ).toBe(true);

    expect(isWireError(null)).toBe(false);
    expect(isWireError("error")).toBe(false);
    expect(isWireError({ name: "Error" })).toBe(false);
    expect(isWireError({ name: 1, message: "x" })).toBe(false);
    expect(isWireError({ name: "Error", message: "x", code: 1 })).toBe(false);
    expect(
      isWireError({ name: "Error", message: "x", cause: { name: "Cause" } }),
    ).toBe(false);
  });
});
