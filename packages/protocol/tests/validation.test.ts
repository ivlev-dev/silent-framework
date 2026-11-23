import { afterEach, describe, expect, it } from "vitest";
import {
  VALIDATION_HOOK,
  decode,
  defineProtocol,
  encode,
  type ValidateResult,
} from "../src/index.js";
import { bytesOf, expectProtocolError } from "./helpers.js";

class Value {
  public value = 0;
}

defineProtocol(Value, { fields: [{ name: "value", type: "int32" }] });

const holder = globalThis as unknown as Record<symbol, unknown>;

function setHook(hook: unknown): void {
  holder[VALIDATION_HOOK] = hook;
}

afterEach(() => {
  delete holder[VALIDATION_HOOK];
});

describe("валидация", () => {
  it("VALIDATION_HOOK — глобальный символ", () => {
    expect(VALIDATION_HOOK).toBe(Symbol.for("silent.validation.validate"));
  });

  it("без validate хук не вызывается", () => {
    let calls = 0;
    setHook(() => {
      calls += 1;
      return true;
    });
    const value = new Value();
    encode(value);
    encode(value, { validate: false });
    encode(value, { validate: undefined });
    expect(calls).toBe(0);
  });

  it("функция validate на encode", () => {
    const value = new Value();
    let seen: object | undefined;
    encode(value, {
      validate(input) {
        seen = input;
        return true;
      },
    });
    expect(seen).toBe(value);
  });

  it("провал валидации на encode", () => {
    const value = new Value();
    expectProtocolError(() => encode(value, { validate: () => false }), "validation");
  });

  it("провал с ошибками", () => {
    const value = new Value();
    const errors = [{ field: "value", message: "bad" }];
    const result: ValidateResult = { valid: false, errors };
    expectProtocolError(() => encode(value, { validate: () => result }), "validation");
  });

  it("успешный объектный результат", () => {
    const value = new Value();
    expect(() => encode(value, { validate: () => ({ valid: true }) })).not.toThrow();
  });

  it("неверный результат валидатора", () => {
    const value = new Value();
    expectProtocolError(
      () => encode(value, { validate: (() => 42) as unknown as () => ValidateResult }),
      "validation",
    );
  });

  it("исключение валидатора", () => {
    const value = new Value();
    expectProtocolError(
      () => encode(value, { validate() { throw new Error("boom"); } }),
      "validation",
    );
  });

  it("глобальный хук через validate: true", () => {
    let seen: object | undefined;
    setHook((input: object) => {
      seen = input;
      return true;
    });
    const value = new Value();
    encode(value, { validate: true });
    expect(seen).toBe(value);
  });

  it("глобальный хук отсутствует", () => {
    const value = new Value();
    expectProtocolError(() => encode(value, { validate: true }), "validation");
  });

  it("глобальный хук на decode", () => {
    let seen: object | undefined;
    setHook((input: object) => {
      seen = input;
      return true;
    });
    const restored = decode(Value, bytesOf(0x02), { validate: true });
    expect(seen).toBe(restored);
  });

  it("провал валидации на decode", () => {
    expectProtocolError(
      () => decode(Value, bytesOf(0x02), { validate: () => false }),
      "validation",
    );
  });

  it("валидатор возвращает объект без errors", () => {
    expectProtocolError(
      () => decode(Value, bytesOf(0x02), { validate: () => ({ valid: false }) }),
      "validation",
    );
  });
});
