// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insert, setServerMode, templateHoles } from "../src/dom";
import { isMetadataFree } from "../src/metadata";
import { setServerBackend, type ServerBackend } from "../src/server-backend";
import { SERVER_HOLE_SET_VALUE, setServerHoleValue } from "../src/server-hole";

interface LazyHole {
  readonly parentNode: unknown;
  readonly values: unknown[];
  readonly written: string[];
  set(value: string): void;
}

function createLazyHole(accepted: boolean, receiver?: { current: unknown }): LazyHole {
  const values: unknown[] = [];
  const written: string[] = [];
  const hole: LazyHole & Record<string, unknown> = {
    parentNode: null,
    values,
    written,
    set(value: string): void {
      written.push(value);
    },
    [SERVER_HOLE_SET_VALUE](this: unknown, value: unknown): boolean {
      values.push(value);
      if (receiver !== undefined) {
        receiver.current = this;
      }
      return accepted;
    },
  };
  return hole;
}

function createPlainHole(written: string[]): {
  readonly parentNode: unknown;
  readonly set: (value: string) => void;
} {
  return {
    parentNode: null,
    set(value: string): void {
      written.push(value);
    },
  };
}

function backendWithSerialize(serialize: (value: unknown) => string): ServerBackend {
  return {
    createTemplate: () => null,
    serialize,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  setServerBackend(null);
});

afterEach(() => {
  setServerBackend(null);
  document.body.replaceChildren();
});

describe("setServerHoleValue", () => {
  it("вызывает метод по протокольному имени через сам объект", () => {
    const receiver: { current: unknown } = { current: null };
    const hole = createLazyHole(true, receiver);

    expect(setServerHoleValue(hole, "payload")).toBe(true);
    expect(hole.values).toEqual(["payload"]);
    expect(receiver.current).toBe(hole);
  });

  it("возвращает false, если метод отсутствует", () => {
    expect(setServerHoleValue(createPlainHole([]), "value")).toBe(false);
  });

  it("возвращает false для не-объектов", () => {
    expect(setServerHoleValue(null, "value")).toBe(false);
    expect(setServerHoleValue(undefined, "value")).toBe(false);
    expect(setServerHoleValue("hole", "value")).toBe(false);
    expect(setServerHoleValue(1, "value")).toBe(false);
  });

  it("возвращает false, если поле не является функцией", () => {
    expect(
      setServerHoleValue({ [SERVER_HOLE_SET_VALUE]: 1 }, "value"),
    ).toBe(false);
  });

  it("пробрасывает отказ метода", () => {
    const hole = createLazyHole(false);
    expect(setServerHoleValue(hole, "value")).toBe(false);
    expect(hole.values).toEqual(["value"]);
  });

  it("требует именно true", () => {
    expect(
      setServerHoleValue(
        {
          [SERVER_HOLE_SET_VALUE]: () => "yes" as unknown as boolean,
        },
        "value",
      ),
    ).toBe(false);
  });
});

describe("insert с серверной дырой", () => {
  it("передаёт значение ленивому сеттеру и не сериализует", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const hole = createLazyHole(true);
    let calls = 0;

    insert(parent, () => {
      calls += 1;
      return "value";
    }, hole);

    expect(calls).toBe(1);
    expect(hole.values).toEqual(["value"]);
    expect(hole.written).toEqual([]);
  });

  it("падает в старый путь, если сеттер отказал", () => {
    setServerBackend(backendWithSerialize((value) => `[${String(value)}]`));
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const hole = createLazyHole(false);
    let calls = 0;

    insert(parent, () => {
      calls += 1;
      return "value";
    }, hole);

    expect(calls).toBe(1);
    expect(hole.values).toEqual(["value"]);
    expect(hole.written).toEqual([
      "<!--silent-insert-->[value]<!--silent-insert-end-->",
    ]);
  });

  it("использует старый путь для дыры без протокольного метода", () => {
    setServerBackend(backendWithSerialize((value) => `${String(value)}!`));
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const written: string[] = [];
    const hole = createPlainHole(written);
    let calls = 0;

    insert(parent, () => {
      calls += 1;
      return "value";
    }, hole);

    expect(calls).toBe(1);
    expect(written).toEqual(["<!--silent-insert-->value!<!--silent-insert-end-->"]);
  });

  it("сериализует пусто без backend", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const written: string[] = [];

    insert(parent, () => "value", createPlainHole(written));

    expect(written).toEqual(["<!--silent-insert--><!--silent-insert-end-->"]);
  });
});

describe("markMetadataFree", () => {
  it("помечает узел серверного шаблона как свободный от метаданных", () => {
    const node = document.createElement("div");
    setServerBackend({
      createTemplate: () => ({ node, holes: [], attrs: [] }),
      serialize: (value) => String(value),
    });
    setServerMode(true);
    try {
      const clone = templateHoles("<div></div>")();
      expect(clone.node).toBe(node);
      expect(isMetadataFree(node)).toBe(true);
    } finally {
      setServerMode(false);
    }
  });

  it("не помечает узел, если backend отказался", () => {
    const node = document.createElement("div");
    setServerBackend({ createTemplate: () => null, serialize: (value) => String(value) });
    setServerMode(true);
    try {
      const clone = templateHoles("<div></div>")();
      expect(clone.node).not.toBe(node);
      expect(isMetadataFree(node)).toBe(false);
    } finally {
      setServerMode(false);
    }
  });
});
