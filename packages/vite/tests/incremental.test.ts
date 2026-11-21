import { realpathSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalizePath,
  mergeIndexDelta,
  moduleFingerprint,
  modulePathCandidates,
  modulePathOfFile,
  pruneEmptyInterfaceTokens,
  removeModuleFromIndex,
  stableIndexJson,
} from "../src/incremental.js";
import type { SilentIndex } from "../src/native.js";

const empty = (): SilentIndex => ({ interfaces: {}, values: {} });

const root = realpathSync.native(process.cwd());
const modulePath = (name: string): string => `${root}/${name}`;

describe("incremental index", () => {
  it("удаляет значения модуля, его интерфейсы и реализации в чужих токенах", () => {
    const index: SilentIndex = {
      interfaces: {
        [`${modulePath("types")}#Store`]: [
          `${modulePath("memory")}#MemoryStore`,
          `${modulePath("api")}#ApiStore`,
        ],
        [`${modulePath("memory")}#Cache`]: [`${modulePath("memory")}#MemoryStore`],
      },
      values: {
        [modulePath("types")]: ["Store"],
        [modulePath("memory")]: ["MemoryStore", "Cache"],
        [modulePath("api")]: ["ApiStore"],
      },
    };

    expect(removeModuleFromIndex(index, modulePath("memory.ts"))).toBe(true);

    expect(index.values).toEqual({
      [modulePath("types")]: ["Store"],
      [modulePath("api")]: ["ApiStore"],
    });
    expect(index.interfaces).toEqual({
      [`${modulePath("types")}#Store`]: [`${modulePath("api")}#ApiStore`],
    });
  });

  it("удаляет пустые токены интерфейсов", () => {
    const index: SilentIndex = {
      interfaces: {
        [`${modulePath("types")}#Store`]: [`${modulePath("memory")}#MemoryStore`],
      },
      values: { [modulePath("memory")]: ["MemoryStore"] },
    };

    expect(removeModuleFromIndex(index, modulePath("memory.ts"))).toBe(true);
    expect(index.interfaces).toEqual({});
  });

  it("не удаляет интерфейс, объявленный модулем, вместе с чужими реализациями", () => {
    const index: SilentIndex = {
      interfaces: {
        [`${modulePath("types")}#Store`]: [`${modulePath("memory")}#MemoryStore`],
      },
      values: { [modulePath("types")]: ["Store"] },
    };

    // Правка types.ts не должна обнулять реализации из memory.ts.
    expect(removeModuleFromIndex(index, modulePath("types.ts"))).toBe(true);
    expect(index.values).toEqual({});
    expect(index.interfaces).toEqual({
      [`${modulePath("types")}#Store`]: [`${modulePath("memory")}#MemoryStore`],
    });
  });

  it("удаляет только пустые токены, объявленные модулем", () => {
    const index: SilentIndex = {
      interfaces: {
        [`${modulePath("types")}#Empty`]: [],
        [`${modulePath("types")}#Used`]: [`${modulePath("memory")}#MemoryStore`],
        [`${modulePath("other")}#Empty`]: [],
      },
      values: {},
    };

    expect(pruneEmptyInterfaceTokens(index, modulePath("types.ts"))).toBe(true);
    expect(index.interfaces).toEqual({
      [`${modulePath("types")}#Used`]: [`${modulePath("memory")}#MemoryStore`],
      [`${modulePath("other")}#Empty`]: [],
    });
  });

  it("не трогает пустые токены чужих модулей", () => {
    const index: SilentIndex = {
      interfaces: { [`${modulePath("other")}#Empty`]: [] },
      values: {},
    };

    expect(pruneEmptyInterfaceTokens(index, modulePath("types.ts"))).toBe(false);
    expect(index.interfaces).toEqual({
      [`${modulePath("other")}#Empty`]: [],
    });
  });

  it("возвращает false, если модуля в индексе нет", () => {
    const index = empty();
    expect(removeModuleFromIndex(index, modulePath("missing.ts"))).toBe(false);
    expect(index).toEqual(empty());
  });

  it("сливает значения и объединения реализаций без дублей", () => {
    const index: SilentIndex = {
      interfaces: { [`${modulePath("types")}#Store`]: [`${modulePath("memory")}#MemoryStore`] },
      values: { [modulePath("types")]: ["Store"] },
    };
    const delta: SilentIndex = {
      interfaces: {
        [`${modulePath("types")}#Store`]: [
          `${modulePath("memory")}#MemoryStore`,
          `${modulePath("api")}#ApiStore`,
        ],
        [`${modulePath("logger")}#Logger`]: [`${modulePath("memory")}#MemoryStore`],
      },
      values: {
        [modulePath("memory")]: ["MemoryStore"],
        [modulePath("logger")]: ["Logger"],
      },
    };

    expect(mergeIndexDelta(index, delta)).toBe(true);
    expect(index.interfaces).toEqual({
      [`${modulePath("types")}#Store`]: [
        `${modulePath("memory")}#MemoryStore`,
        `${modulePath("api")}#ApiStore`,
      ],
      [`${modulePath("logger")}#Logger`]: [`${modulePath("memory")}#MemoryStore`],
    });
    expect(index.values).toEqual({
      [modulePath("types")]: ["Store"],
      [modulePath("memory")]: ["MemoryStore"],
      [modulePath("logger")]: ["Logger"],
    });

    expect(mergeIndexDelta(index, delta)).toBe(false);
  });

  it("снимок модуля игнорирует порядок и чужие записи", () => {
    const index: SilentIndex = {
      interfaces: {
        [`${modulePath("types")}#Store`]: [
          `${modulePath("memory")}#MemoryStore`,
          `${modulePath("api")}#ApiStore`,
        ],
        [`${modulePath("logger")}#Logger`]: [`${modulePath("api")}#ApiStore`],
      },
      values: {
        [modulePath("memory")]: ["MemoryStore"],
        [modulePath("api")]: ["ApiStore"],
      },
    };

    const before = moduleFingerprint(index, modulePath("memory.ts"));
    index.interfaces[`${modulePath("types")}#Store`] = [
      `${modulePath("api")}#ApiStore`,
      `${modulePath("memory")}#MemoryStore`,
    ];
    expect(moduleFingerprint(index, modulePath("memory.ts"))).toBe(before);

    index.values[modulePath("api")] = ["ApiStore", "Extra"];
    // `${modulePath("api")}#ApiStore` — реализация другого модуля, записи api не входят.
    delete index.values[modulePath("api")];
    expect(moduleFingerprint(index, modulePath("memory.ts"))).toBe(before);

    index.interfaces[`${modulePath("types")}#Store`] = [
      `${modulePath("memory")}#Renamed`,
      `${modulePath("api")}#ApiStore`,
    ];
    expect(moduleFingerprint(index, modulePath("memory.ts"))).not.toBe(before);
  });

  it("детерминированно сериализует индекс независимо от порядка ключей и элементов", () => {
    const first: SilentIndex = {
      interfaces: { "b#B": ["i#I", "j#J"], "a#A": ["i#I"] },
      values: { b: ["B", "C"], a: ["A"] },
    };
    const second: SilentIndex = {
      interfaces: { "a#A": ["i#I"], "b#B": ["j#J", "i#I"] },
      values: { a: ["A"], b: ["C", "B"] },
    };

    expect(stableIndexJson(first)).toBe(stableIndexJson(second));
  });

  it("нормализует путь как нативный сканер", () => {
    expect(canonicalizePath(`${process.cwd()}/src/../src/app.ts`)).toBe(
      `${root}/src/app.ts`,
    );
    expect(modulePathOfFile(`${process.cwd()}/src/app.ts`)).toBe(
      `${root}/src/app`,
    );
    expect(modulePathCandidates(`${process.cwd()}/src/app.ts`)).toContain(
      `${root}/src/app`,
    );
  });
});
