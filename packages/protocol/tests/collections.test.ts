import { describe, expect, it } from "vitest";
import { decode, defineProtocol, encode } from "../src/index.js";
import { box, expectProtocolError, hex } from "./helpers.js";

function encodeBox(type: Parameters<typeof box>[0], value: unknown): string {
  const Model = box(type);
  const instance = new Model();
  instance.value = value;
  return hex(encode(instance));
}

class Item {
  public v = 0;
}

defineProtocol(Item, { fields: [{ name: "v", type: "int32" }] });

function item(value: number): Item {
  const instance = new Item();
  instance.v = value;
  return instance;
}

describe("массивы", () => {
  it("кодирует count и элементы", () => {
    expect(encodeBox(["array", "int32"], [1, 2, 3])).toBe("03020406");
    expect(encodeBox(["array", "int32"], [])).toBe("00");
    expect(encodeBox(["array", "string"], ["a", "b"])).toBe("0201610162");
  });

  it("кодирует вложенные массивы", () => {
    expect(encodeBox(["array", ["array", "int32"]], [[1], [2, 3]])).toBe("020102020406");
  });

  it("кодирует массив классов без префикса длины", () => {
    expect(encodeBox(["array", ["class", () => Item]], [item(1), item(2)])).toBe("020204");
  });

  it("bitmap optional-элементов после count", () => {
    expect(encodeBox(["array", ["optional", "int32"]], [1, undefined, 3])).toBe("03050206");
    expect(encodeBox(["array", ["optional", "int32"]], [undefined, undefined])).toBe("0200");
  });

  it("bitmap optional-классов", () => {
    const bytes = encodeBox(
      ["array", ["optional", ["class", () => Item]]],
      [item(1), undefined],
    );
    expect(bytes).toBe("020102");
  });

  it("roundtrip массива с optional-элементами", () => {
    const Model = box(["array", ["optional", "int32"]]);
    const instance = new Model();
    instance.value = [1, undefined, 3];
    const restored = decode(Model, encode(instance)).value as unknown[];
    expect(restored.length).toBe(3);
    expect(restored[0]).toBe(1);
    expect(restored[1]).toBeUndefined();
    expect(restored[2]).toBe(3);
  });

  it("требует массив", () => {
    expectProtocolError(() => encodeBox(["array", "int32"], new Set([1])), "value");
  });

  it("обрезка массива", () => {
    const Model = box(["array", "int32"]);
    expectProtocolError(() => decode(Model, new Uint8Array([0x02, 0x02])), "truncated");
  });
});

describe("кортежи", () => {
  it("кодирует значения без bitmap", () => {
    expect(encodeBox(["tuple", ["int32", "string"]], [1, "a"])).toBe("020161");
  });

  it("bitmap optional-слотов в начале", () => {
    expect(encodeBox(["tuple", ["int32", ["optional", "string"]]], [1, undefined])).toBe("0002");
    expect(encodeBox(["tuple", ["int32", ["optional", "string"]]], [1, "a"])).toBe("01020161");
    expect(encodeBox(["tuple", [["optional", "int32"], "string"]], [undefined, "a"])).toBe("000161");
  });

  it("roundtrip кортежа", () => {
    const Model = box(["tuple", ["int32", ["optional", "string"], "bool"]]);
    const instance = new Model();
    instance.value = [5, undefined, true];
    const restored = decode(Model, encode(instance)).value as unknown[];
    expect(restored).toEqual([5, undefined, true]);
  });

  it("требует точную длину", () => {
    expectProtocolError(() => encodeBox(["tuple", ["int32", "string"]], [1]), "value");
    expectProtocolError(() => encodeBox(["tuple", ["int32"]], [1, 2]), "value");
  });
});

describe("map", () => {
  it("сортирует строковые ключи по UTF-8", () => {
    expect(encodeBox(["map", "string", "int32"], new Map([["b", 2], ["a", 1]])))
      .toBe("02016102016204");
  });

  it("принимает plain object для строковых ключей", () => {
    expect(encodeBox(["map", "string", "int32"], { b: 2, a: 1 }))
      .toBe("02016102016204");
  });

  it("сортирует числовые ключи численно", () => {
    expect(encodeBox(["map", "int32", "string"], new Map([[2, "b"], [1, "a"]])))
      .toBe("02020161040162");
  });

  it("сортирует bool-ключи false < true", () => {
    expect(encodeBox(["map", "bool", "string"], new Map([[true, "t"], [false, "f"]])))
      .toBe("02000166010174");
  });

  it("сортирует enum-ключи по значению", () => {
    expect(encodeBox(
      ["map", ["enum", [1, 2, 3]], "int32"],
      new Map([[2, 20], [1, 10]]),
    )).toBe("0201140228");
  });

  it("пустая map — один байт", () => {
    expect(encodeBox(["map", "string", "int32"], new Map())).toBe("00");
  });

  it("bitmap optional-значений после count", () => {
    expect(encodeBox(
      ["map", "string", ["optional", "int32"]],
      new Map([["b", undefined], ["a", 1]]),
    )).toBe("02010161020162");
  });

  it("декодирует в Map", () => {
    const Model = box(["map", "string", "int32"]);
    const restored = decode(Model, new Uint8Array([0x02, 0x01, 0x61, 0x02, 0x01, 0x62, 0x04]));
    const map = restored.value;
    expect(map).toBeInstanceOf(Map);
    expect([...(map as Map<string, number>)]).toEqual([["a", 1], ["b", 2]]);
  });

  it("отклоняет float-ключи", () => {
    expectProtocolError(
      () => encodeBox(["map", "float64", "int32"], new Map([[1, 2]])),
      "schema",
    );
  });

  it("отклоняет bytes-ключи", () => {
    expectProtocolError(
      () => encodeBox(["map", "bytes", "int32"], new Map([[new Uint8Array([1]), 2]])),
      "schema",
    );
  });

  it("не принимает Set вместо plain object", () => {
    expectProtocolError(
      () => encodeBox(["map", "string", "int32"], new Set([["a", 1]])),
      "value",
    );
  });

  it("не принимает типизированный массив вместо plain object", () => {
    expectProtocolError(
      () => encodeBox(["map", "string", "int32"], new Uint8Array([1, 2])),
      "value",
    );
  });
});

describe("record", () => {
  it("кодирует объект как отсортированную map строк", () => {
    expect(encodeBox(["record", "int32"], { b: 2, a: 1 })).toBe("02016102016204");
  });

  it("поддерживает optional-значения", () => {
    expect(encodeBox(["record", ["optional", "int32"]], { b: undefined, a: 1 }))
      .toBe("02010161020162");
  });

  it("декодирует в plain object", () => {
    const Model = box(["record", "int32"]);
    const restored = decode(Model, new Uint8Array([0x01, 0x01, 0x61, 0x02])).value;
    expect(restored).toEqual({ a: 1 });
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
  });

  it("не создаёт прототипные свойства", () => {
    const Model = box(["record", "int32"]);
    const payload = new Uint8Array([0x01, 0x09, 0x5f, 0x5f, 0x70, 0x72, 0x6f, 0x74, 0x6f, 0x5f, 0x5f, 0x02]);
    const restored = decode(Model, payload).value as Record<string, unknown>;
    expect(Object.hasOwn(restored, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
  });
});

describe("set", () => {
  it("сортирует числовые значения", () => {
    expect(encodeBox(["set", "int32"], new Set([3, 1, 2]))).toBe("03020406");
  });

  it("сортирует строки по UTF-8", () => {
    expect(encodeBox(["set", "string"], new Set(["b", "a"]))).toBe("0201610162");
  });

  it("сортирует bool", () => {
    expect(encodeBox(["set", "bool"], new Set([true, false]))).toBe("020001");
  });

  it("пустой set — один байт", () => {
    expect(encodeBox(["set", "int32"], new Set())).toBe("00");
  });

  it("детерминированно кодирует set классов", () => {
    const first = encodeBox(["set", ["class", () => Item]], new Set([item(2), item(1)]));
    const second = encodeBox(["set", ["class", () => Item]], new Set([item(1), item(2)]));
    expect(first).toBe(second);
    expect(first).toBe("020204");
  });

  it("декодирует в Set", () => {
    const Model = box(["set", "int32"]);
    const restored = decode(Model, new Uint8Array([0x02, 0x02, 0x04])).value;
    expect(restored).toBeInstanceOf(Set);
    expect([...(restored as Set<number>)]).toEqual([1, 2]);
  });

  it("требует Set", () => {
    expectProtocolError(() => encodeBox(["set", "int32"], [1, 2]), "value");
  });
});
