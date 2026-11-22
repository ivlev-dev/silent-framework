import { describe, expect, it } from "vitest";
import { createDocument, installDomGlobals } from "../src/dom/document.js";

describe("installDomGlobals: частичная установка", () => {
  it("восстанавливает уже установленные глобалы при исключении", () => {
    // Non-configurable свойство на позднем индексе заставляет defineProperty
    // упасть уже после установки document/Node/Element.
    Object.defineProperty(globalThis, "Text", {
      configurable: false,
      writable: false,
      value: class PoisonText {},
    });

    const beforeDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const beforeElement = Object.getOwnPropertyDescriptor(globalThis, "Element");

    expect(() => installDomGlobals(createDocument())).toThrow(TypeError);

    expect(Object.getOwnPropertyDescriptor(globalThis, "document")).toEqual(beforeDocument);
    expect(Object.getOwnPropertyDescriptor(globalThis, "Element")).toEqual(beforeElement);
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
  });
});
