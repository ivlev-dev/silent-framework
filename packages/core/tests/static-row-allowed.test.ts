import { describe, expect, it } from "vitest";
import { createSignal, deepReactive, readonly } from "@ivlev-dev/silent-reactivity";
import { staticRowAllowed } from "../src/dom-hydration.js";

describe("staticRowAllowed", () => {
  it("разрешает обычные объекты и примитивы", () => {
    expect(staticRowAllowed(1)).toBe(true);
    expect(staticRowAllowed("row")).toBe(true);
    expect(staticRowAllowed(null)).toBe(true);
    expect(staticRowAllowed({ label: "a", id: 1 })).toBe(true);
  });

  it("запрещает non-enumerable getter", () => {
    const row: Record<string, unknown> = { label: "a" };
    Object.defineProperty(row, "hidden", {
      get: () => "value",
      enumerable: false,
      configurable: true,
    });
    expect(staticRowAllowed(row)).toBe(false);
  });

  it("запрещает symbol-getter", () => {
    const key = Symbol("secret");
    const row: Record<PropertyKey, unknown> = { label: "a" };
    Object.defineProperty(row, key, {
      get: () => "value",
      enumerable: false,
      configurable: true,
    });
    expect(staticRowAllowed(row)).toBe(false);
  });

  it("разрешает non-enumerable данные и symbol-данные", () => {
    const row: Record<PropertyKey, unknown> = { label: "a" };
    Object.defineProperty(row, "hidden", {
      value: 1,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(row, Symbol("data"), {
      value: 2,
      enumerable: false,
      configurable: true,
    });
    expect(staticRowAllowed(row)).toBe(true);
  });

  it("запрещает функции с accessor-свойствами", () => {
    const plain = (): string => "row";
    expect(staticRowAllowed(plain)).toBe(true);

    const withGetter = (): string => "row";
    Object.defineProperty(withGetter, "extra", {
      get: () => 1,
      enumerable: false,
      configurable: true,
    });
    expect(staticRowAllowed(withGetter)).toBe(false);
  });

  it("запрещает экземпляры классов и реактивные объекты", () => {
    class Row {
      readonly label = "a";
    }
    expect(staticRowAllowed(new Row())).toBe(false);
    expect(staticRowAllowed(deepReactive({ label: "a" }))).toBe(false);
  });

  it("запрещает вложенную реактивность и readonly-обёртки", () => {
    const [value] = createSignal("a");
    const nested = deepReactive({ value });
    expect(staticRowAllowed({ child: nested })).toBe(false);
    expect(staticRowAllowed({ child: readonly(nested) })).toBe(false);
    expect(staticRowAllowed({ child: readonly({ nested }) })).toBe(false);
    expect(staticRowAllowed({ child: { label: "ok" } })).toBe(true);
    expect(staticRowAllowed([{ label: "ok" }])).toBe(true);
  });

  it("возвращает false для revoked proxy вместо исключения", () => {
    const revocable = Proxy.revocable({ label: "a" }, {});
    revocable.revoke();
    expect(staticRowAllowed(revocable.proxy)).toBe(false);
    expect(staticRowAllowed({ child: revocable.proxy })).toBe(false);
  });
})
