import { describe, expect, it } from "vitest";
import {
  VirtualizerCore,
  computeRange,
  computeServerSlice,
  defaultKey,
  defaultRangeExtractor,
} from "../src/index.js";
import type {
  Range,
  VirtualItem,
  VirtualizerOptions,
} from "../src/index.js";

/** Короткая фабрика настроек с фиксированным размером. */
function makeCore(
  count: number,
  size: number,
  extra: Partial<VirtualizerOptions> = {},
): VirtualizerCore {
  return new VirtualizerCore({ count, estimateSize: () => size, ...extra });
}

/** Ручной массив измерений: элементы одного размера без промежутков. */
function makeItems(count: number, size: number): VirtualItem[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    key: index,
    start: index * size,
    end: index * size + size,
    size,
    lane: 0,
  }));
}

const EMPTY_RANGE: Range = {
  startIndex: 0,
  endIndex: -1,
  overscanStartIndex: 0,
  overscanEndIndex: -1,
  count: 0,
};

describe("VirtualizerCore: базовая раскладка", () => {
  it("пустой список даёт пустые измерения и диапазон", () => {
    const core = makeCore(0, 20);

    expect(core.measurements()).toEqual([]);
    expect(core.totalSize()).toBe(0);
    expect(core.rangeFor(0, 100)).toEqual(EMPTY_RANGE);
    expect(core.indexAtOffset(0)).toBe(-1);
    expect(core.offsetForIndex(0, "start")).toBe(0);
    expect(core.snapshot().entries).toEqual([]);
  });

  it("один элемент виден при любом смещении", () => {
    const core = makeCore(1, 100);

    expect(core.measurements()).toEqual([
      { index: 0, key: 0, start: 0, end: 100, size: 100, lane: 0 },
    ]);
    expect(core.totalSize()).toBe(100);
    expect(core.rangeFor(0, 50)).toEqual({
      startIndex: 0,
      endIndex: 0,
      overscanStartIndex: 0,
      overscanEndIndex: 0,
      count: 1,
    });
    expect(core.rangeFor(10_000, 50)).toEqual({
      startIndex: 0,
      endIndex: 0,
      overscanStartIndex: 0,
      overscanEndIndex: 0,
      count: 1,
    });
    expect(core.indexAtOffset(99)).toBe(0);
  });

  it("100k элементов: диапазон считается без материализации и без повторных оценок", () => {
    let estimates = 0;
    const core = new VirtualizerCore({
      count: 100_000,
      estimateSize: () => {
        estimates++;
        return 10;
      },
    });

    const range = core.rangeFor(500_000, 800);
    expect(range).toEqual({
      startIndex: 50_000,
      endIndex: 50_079,
      overscanStartIndex: 49_995,
      overscanEndIndex: 50_084,
      count: 100_000,
    });
    expect(core.totalSize()).toBe(1_000_000);
    expect(estimates).toBe(100_000);

    core.rangeFor(0, 800);
    core.totalSize();
    expect(estimates).toBe(100_000);
  });

  it("учитывает gap, paddingStart/End и scrollMargin", () => {
    const core = new VirtualizerCore({
      count: 10,
      estimateSize: () => 20,
      gap: 5,
      paddingStart: 10,
      paddingEnd: 7,
      scrollMargin: 3,
    });

    const items = core.measurements();
    expect(items[0]).toEqual({
      index: 0,
      key: 0,
      start: 13,
      end: 33,
      size: 20,
      lane: 0,
    });
    expect(items[9]?.start).toBe(238);
    expect(items[9]?.end).toBe(258);
    expect(core.totalSize()).toBe(265);

    expect(core.rangeFor(0, 40)).toEqual({
      startIndex: 0,
      endIndex: 1,
      overscanStartIndex: 0,
      overscanEndIndex: 6,
      count: 10,
    });
    expect(core.rangeFor(10_000, 40)).toEqual({
      startIndex: 8,
      endIndex: 9,
      overscanStartIndex: 3,
      overscanEndIndex: 9,
      count: 10,
    });
  });

  it("динамические размеры обновляются через measure/resize/invalidate", () => {
    const core = new VirtualizerCore({
      count: 3,
      estimateSize: (index) => (index + 1) * 10,
      gap: 5,
      paddingStart: 4,
      paddingEnd: 6,
      scrollMargin: 2,
    });

    expect(core.measurements().map((item) => item.size)).toEqual([10, 20, 30]);
    expect(core.measurements().map((item) => item.start)).toEqual([6, 21, 46]);
    expect(core.measurements().map((item) => item.end)).toEqual([16, 41, 76]);
    expect(core.totalSize()).toBe(82);

    core.measureItem(1, 50);
    expect(core.measurements().map((item) => item.start)).toEqual([6, 21, 76]);
    expect(core.totalSize()).toBe(112);

    core.resizeItem(2, 5);
    expect(core.measurements().map((item) => item.end)).toEqual([16, 71, 81]);
    expect(core.totalSize()).toBe(87);

    core.invalidate(2);
    expect(core.measurements().map((item) => item.size)).toEqual([10, 50, 30]);
    expect(core.totalSize()).toBe(112);

    core.invalidate();
    expect(core.measurements().map((item) => item.size)).toEqual([10, 20, 30]);
    expect(core.totalSize()).toBe(82);
  });

  it("отрицательные и нечисловые размеры трактуются как 0, count < 0 — как пусто", () => {
    const sizes = [-5, Number.NaN, Number.POSITIVE_INFINITY, 10];
    const core = new VirtualizerCore({
      count: 4,
      estimateSize: (index) => sizes[index] ?? 10,
    });

    expect(core.measurements().map((item) => item.size)).toEqual([0, 0, 0, 10]);
    expect(core.measurements().map((item) => item.start)).toEqual([0, 0, 0, 0]);
    expect(core.totalSize()).toBe(10);

    core.measureItem(0, -100);
    expect(core.measurements()[0]?.size).toBe(0);

    const negative = new VirtualizerCore({ count: -5, estimateSize: () => 10 });
    expect(negative.measurements()).toEqual([]);
    expect(negative.totalSize()).toBe(0);
    expect(negative.rangeFor(0, 100).count).toBe(0);
  });
});

describe("VirtualizerCore: overscan и клампинг", () => {
  it("overscan по умолчанию равен 5", () => {
    const core = makeCore(20, 10);

    expect(core.rangeFor(0, 20)).toEqual({
      startIndex: 0,
      endIndex: 1,
      overscanStartIndex: 0,
      overscanEndIndex: 6,
      count: 20,
    });
  });

  it("overscan 0 и overscan больше списка клампятся по границам", () => {
    const exact = makeCore(3, 10, { overscan: 0 });
    expect(exact.rangeFor(0, 10)).toEqual({
      startIndex: 0,
      endIndex: 0,
      overscanStartIndex: 0,
      overscanEndIndex: 0,
      count: 3,
    });

    const wide = makeCore(3, 10, { overscan: 10 });
    expect(wide.rangeFor(0, 10)).toEqual({
      startIndex: 0,
      endIndex: 0,
      overscanStartIndex: 0,
      overscanEndIndex: 2,
      count: 3,
    });
  });

  it("клампит отрицательное и запредельное смещение", () => {
    const core = makeCore(10, 10);

    expect(core.rangeFor(-100, 50)).toEqual({
      startIndex: 0,
      endIndex: 4,
      overscanStartIndex: 0,
      overscanEndIndex: 9,
      count: 10,
    });
    expect(core.rangeFor(500, 1000)).toEqual({
      startIndex: 0,
      endIndex: 9,
      overscanStartIndex: 0,
      overscanEndIndex: 9,
      count: 10,
    });
    expect(core.rangeFor(0, 0)).toEqual({
      startIndex: 0,
      endIndex: -1,
      overscanStartIndex: 0,
      overscanEndIndex: -1,
      count: 10,
    });
  });

  it("применяет rangeExtractor: фильтрует, усекает, убирает дубликаты", () => {
    let seen: Range | null = null;
    const core = new VirtualizerCore({
      count: 100,
      estimateSize: () => 10,
      overscan: 2,
      rangeExtractor: (range) => {
        seen = range;
        return [0, 50, 50, -1, 100, 2.9];
      },
    });

    const range = core.rangeFor(0, 30);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(2);
    expect(range.overscanStartIndex).toBe(0);
    expect(range.overscanEndIndex).toBe(50);
    expect(seen).toEqual({
      startIndex: 0,
      endIndex: 2,
      overscanStartIndex: 0,
      overscanEndIndex: 4,
      count: 100,
    });
  });

  it("defaultRangeExtractor возвращает окно включительно", () => {
    expect(
      defaultRangeExtractor({
        startIndex: 2,
        endIndex: 3,
        overscanStartIndex: 1,
        overscanEndIndex: 4,
        count: 10,
      }),
    ).toEqual([1, 2, 3, 4]);
    expect(
      defaultRangeExtractor({
        startIndex: 0,
        endIndex: -1,
        overscanStartIndex: 0,
        overscanEndIndex: -1,
        count: 0,
      }),
    ).toEqual([]);
  });
});

describe("computeRange", () => {
  it("считает диапазон по массиву измерений", () => {
    expect(
      computeRange({
        measurements: makeItems(5, 10),
        scrollOffset: 15,
        viewportSize: 12,
        overscan: 1,
      }),
    ).toEqual({
      startIndex: 1,
      endIndex: 2,
      overscanStartIndex: 0,
      overscanEndIndex: 3,
      count: 5,
    });
  });

  it("клампит отрицательное смещение и пустой вьюпорт", () => {
    expect(
      computeRange({
        measurements: makeItems(10, 10),
        scrollOffset: -50,
        viewportSize: 25,
        overscan: 0,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 2,
      overscanStartIndex: 0,
      overscanEndIndex: 2,
      count: 10,
    });

    expect(
      computeRange({
        measurements: makeItems(10, 10),
        scrollOffset: 0,
        viewportSize: 0,
        overscan: 0,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: -1,
      overscanStartIndex: 0,
      overscanEndIndex: -1,
      count: 10,
    });

    expect(
      computeRange({
        measurements: [],
        scrollOffset: 0,
        viewportSize: 100,
        overscan: 5,
      }),
    ).toEqual(EMPTY_RANGE);
  });

  it("находит первый элемент по префиксному максимуму end при перекрытии дорожек", () => {
    const overlapping: VirtualItem[] = [
      { index: 0, key: 0, start: 0, end: 100, size: 100, lane: 0 },
      { index: 1, key: 1, start: 0, end: 10, size: 10, lane: 1 },
      { index: 2, key: 2, start: 10, end: 20, size: 10, lane: 1 },
    ];

    expect(
      computeRange({
        measurements: overlapping,
        scrollOffset: 50,
        viewportSize: 10,
        overscan: 0,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 2,
      overscanStartIndex: 0,
      overscanEndIndex: 2,
      count: 3,
    });
  });

  it("санитизирует произвольные индексы extractor", () => {
    const range = computeRange({
      measurements: makeItems(10, 10),
      scrollOffset: 0,
      viewportSize: 10,
      overscan: 0,
      rangeExtractor: () => [999, -3, 2.9, 2],
    });

    expect(range).toEqual({
      startIndex: 0,
      endIndex: 0,
      overscanStartIndex: 0,
      overscanEndIndex: 2,
      count: 10,
    });

    const empty = computeRange({
      measurements: makeItems(10, 10),
      scrollOffset: 0,
      viewportSize: 10,
      overscan: 0,
      rangeExtractor: () => [],
    });
    expect(empty.overscanStartIndex).toBe(0);
    expect(empty.overscanEndIndex).toBe(0);
  });
});

describe("VirtualizerCore: поиск и выравнивание", () => {
  it("indexAtOffset корректен на границах и в промежутках", () => {
    const core = makeCore(10, 10);

    expect(core.indexAtOffset(-5)).toBe(0);
    expect(core.indexAtOffset(0)).toBe(0);
    expect(core.indexAtOffset(9.99)).toBe(0);
    expect(core.indexAtOffset(10)).toBe(1);
    expect(core.indexAtOffset(15)).toBe(1);
    expect(core.indexAtOffset(95)).toBe(9);
    expect(core.indexAtOffset(100)).toBe(9);
    expect(core.indexAtOffset(1e9)).toBe(9);
    expect(core.indexAtOffset(Number.NaN)).toBe(0);
    expect(makeCore(0, 10).indexAtOffset(0)).toBe(-1);

    const gapped = makeCore(3, 10, { gap: 5 });
    expect(gapped.indexAtOffset(12)).toBe(0);
    expect(gapped.indexAtOffset(15)).toBe(1);
    expect(gapped.indexAtOffset(30)).toBe(2);
  });

  it("offsetForIndex поддерживает все варианты выравнивания", () => {
    const core = makeCore(5, 10);

    expect(core.offsetForIndex(0, "start")).toBe(0);
    expect(core.offsetForIndex(2, "start")).toBe(20);
    expect(core.offsetForIndex(2, "center")).toBe(25);
    expect(core.offsetForIndex(2, "end")).toBe(30);
    expect(core.offsetForIndex(4, "end")).toBe(50);
    expect(core.offsetForIndex(99, "start")).toBe(40);
    expect(core.offsetForIndex(2)).toBe(20);

    core.rangeFor(20, 20);
    expect(core.offsetForIndex(2, "auto")).toBe(20);
    expect(core.offsetForIndex(1, "auto")).toBe(10);
    expect(core.offsetForIndex(4, "auto")).toBe(30);
  });
});

describe("VirtualizerCore: измерения по ключу", () => {
  it("кэширует измерения по getItemKey и инвалидирует их", () => {
    const core = new VirtualizerCore({
      count: 3,
      estimateSize: () => 10,
      getItemKey: (index) => `key-${index}`,
    });

    expect(core.measurements().map((item) => item.key)).toEqual([
      "key-0",
      "key-1",
      "key-2",
    ]);

    core.measureItem(1, 40);
    expect(core.measurements().map((item) => item.size)).toEqual([10, 40, 10]);
    expect(core.totalSize()).toBe(60);
    expect(core.snapshot().entries).toEqual([["key-1", 40]]);

    core.invalidate(1);
    expect(core.measurements()[1]?.size).toBe(10);
    expect(core.totalSize()).toBe(30);
  });

  it("игнорирует индексы вне диапазона", () => {
    const core = makeCore(2, 10);

    core.measureItem(5, 100);
    core.measureItem(-1, 100);
    core.invalidate(9);
    core.invalidate(-3);

    expect(core.totalSize()).toBe(20);
  });

  it("defaultKey возвращает индекс", () => {
    expect(defaultKey(7)).toBe(7);
  });
});

describe("VirtualizerCore: дорожки", () => {
  it("lanes = 2 распределяет по самой короткой дорожке", () => {
    const core = makeCore(6, 10, { lanes: 2, gap: 2 });
    const items = core.measurements();

    expect(items.map((item) => item.lane)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(items.map((item) => item.start)).toEqual([0, 0, 12, 12, 24, 24]);
    expect(items.map((item) => item.end)).toEqual([10, 10, 22, 22, 34, 34]);
    expect(core.totalSize()).toBe(34);

    expect(core.rangeFor(12, 10)).toEqual({
      startIndex: 2,
      endIndex: 3,
      overscanStartIndex: 0,
      overscanEndIndex: 5,
      count: 6,
    });
  });

  it("lanes = 3: estimate раскладывает сразу, measured ждёт измерений", () => {
    const estimate = makeCore(4, 10, { lanes: 3 });
    expect(estimate.measurements().map((item) => item.lane)).toEqual([
      0, 1, 2, 0,
    ]);
    expect(estimate.measurements().map((item) => item.start)).toEqual([
      0, 0, 0, 10,
    ]);
    expect(estimate.totalSize()).toBe(20);

    const measured = makeCore(4, 10, {
      lanes: 3,
      laneAssignmentMode: "measured",
    });
    expect(measured.totalSize()).toBe(0);
    expect(measured.measurements().map((item) => item.start)).toEqual([
      0, 0, 0, 0,
    ]);

    for (const index of [0, 1, 2, 3]) {
      measured.measureItem(index, 10);
    }
    expect(measured.measurements().map((item) => item.lane)).toEqual([
      0, 1, 2, 0,
    ]);
    expect(measured.measurements().map((item) => item.start)).toEqual([
      0, 0, 0, 10,
    ]);
    expect(measured.totalSize()).toBe(20);
  });

  it("setLanes и setOptions({ lanes }) пересобирают раскладку", () => {
    const core = makeCore(4, 10);
    expect(core.totalSize()).toBe(40);

    core.setLanes(2);
    expect(core.measurements().map((item) => item.lane)).toEqual([0, 1, 0, 1]);
    expect(core.measurements().map((item) => item.start)).toEqual([
      0, 0, 10, 10,
    ]);
    expect(core.totalSize()).toBe(20);

    core.setLanes(0);
    expect(core.getOptions().lanes).toBe(1);
    expect(core.totalSize()).toBe(40);

    const viaOptions = makeCore(4, 10);
    viaOptions.setOptions({ lanes: 3 });
    expect(viaOptions.measurements().map((item) => item.start)).toEqual([
      0, 0, 0, 10,
    ]);
    expect(viaOptions.totalSize()).toBe(20);
  });
});

describe("VirtualizerCore: enabled", () => {
  it("отключается и включается без остаточного кэша", () => {
    const core = makeCore(5, 10, { enabled: false });

    expect(core.measurements()).toEqual([]);
    expect(core.totalSize()).toBe(0);
    expect(core.rangeFor(0, 100)).toEqual(EMPTY_RANGE);
    expect(core.indexAtOffset(50)).toBe(-1);
    expect(core.offsetForIndex(2, "start")).toBe(0);
    expect(core.snapshot().entries).toEqual([]);

    core.measureItem(0, 99);
    expect(core.measurements()).toEqual([]);

    core.setOptions({ enabled: true });
    expect(core.measurements().map((item) => item.size)).toEqual([
      10, 10, 10, 10, 10,
    ]);
    expect(core.totalSize()).toBe(50);

    core.measureItem(0, 99);
    expect(core.totalSize()).toBe(139);

    core.setOptions({ enabled: false });
    core.setOptions({ enabled: true });
    expect(core.measurements().map((item) => item.size)).toEqual([
      10, 10, 10, 10, 10,
    ]);
  });
});

describe("VirtualizerCore: snapshot/restore", () => {
  it("переживает JSON-сериализацию и восстанавливает размеры", () => {
    const core = new VirtualizerCore({
      count: 4,
      estimateSize: () => 10,
      getItemKey: (index) => `k${index}`,
    });
    core.measureItem(0, 25);
    core.measureItem(2, 5);
    core.rangeFor(20, 20);

    const snapshot = core.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.entries).toEqual([
      ["k0", 25],
      ["k2", 5],
    ]);
    expect(snapshot.scrollOffset).toBe(20);
    expect(snapshot.viewportSize).toBe(20);

    type Snapshot = Parameters<VirtualizerCore["restore"]>[0];
    const parsed = JSON.parse(JSON.stringify(snapshot)) as Snapshot;

    const restored = new VirtualizerCore({
      count: 4,
      estimateSize: () => 10,
      getItemKey: (index) => `k${index}`,
    });
    restored.restore(parsed);

    expect(restored.measurements().map((item) => item.size)).toEqual([
      25, 10, 5, 10,
    ]);
    expect(restored.measurements().map((item) => item.start)).toEqual([
      0, 25, 35, 40,
    ]);
    expect(restored.totalSize()).toBe(50);
    expect(restored.snapshot().scrollOffset).toBe(20);
  });

  it("отклоняет снапшот неизвестной версии", () => {
    const core = makeCore(2, 10);
    type Snapshot = Parameters<VirtualizerCore["restore"]>[0];

    expect(() =>
      core.restore({ version: 2, entries: [] } as unknown as Snapshot),
    ).toThrow(TypeError);
  });
});

describe("computeServerSlice", () => {
  it("детерминирован и корректен по totalSize и диапазону", () => {
    const options = {
      count: 5,
      estimateSize: () => 10,
      viewportSize: 20,
      scrollOffset: 10,
    };

    const first = computeServerSlice(options);
    const second = computeServerSlice({ ...options });

    expect(first).toEqual(second);
    expect(first.totalSize).toBe(50);
    expect(first.range).toEqual({
      startIndex: 1,
      endIndex: 2,
      overscanStartIndex: 1,
      overscanEndIndex: 2,
      count: 5,
    });
    expect(first.items).toEqual([
      { index: 1, key: 1, start: 10, end: 20, size: 10, lane: 0 },
      { index: 2, key: 2, start: 20, end: 30, size: 10, lane: 0 },
    ]);
  });

  it("учитывает gap и paddingStart", () => {
    const slice = computeServerSlice({
      count: 5,
      estimateSize: () => 10,
      viewportSize: 100,
      overscan: 0,
      gap: 2,
      paddingStart: 5,
    });

    expect(slice.totalSize).toBe(63);
    expect(slice.range).toEqual({
      startIndex: 0,
      endIndex: 4,
      overscanStartIndex: 0,
      overscanEndIndex: 4,
      count: 5,
    });
    expect(slice.items.map((item) => item.start)).toEqual([
      5, 17, 29, 41, 53,
    ]);
    expect(slice.items[4]?.end).toBe(63);
  });

  it("обрабатывает пустой список, overscan и нулевой вьюпорт", () => {
    expect(
      computeServerSlice({
        count: 0,
        estimateSize: () => 10,
        viewportSize: 100,
      }),
    ).toEqual({ items: [], totalSize: 0, range: EMPTY_RANGE });

    const overscanned = computeServerSlice({
      count: 10,
      estimateSize: () => 10,
      viewportSize: 10,
      overscan: 2,
    });
    expect(overscanned.range).toEqual({
      startIndex: 0,
      endIndex: 0,
      overscanStartIndex: 0,
      overscanEndIndex: 2,
      count: 10,
    });
    expect(overscanned.items.map((item) => item.index)).toEqual([0, 1, 2]);

    const zeroViewport = computeServerSlice({
      count: 10,
      estimateSize: () => 10,
      viewportSize: 0,
    });
    expect(zeroViewport.range.endIndex).toBe(-1);
    expect(zeroViewport.items).toEqual([]);
    expect(zeroViewport.totalSize).toBe(100);
  });
});

describe("VirtualizerCore: настройки", () => {
  it("подставляет значения по умолчанию и мержит setOptions", () => {
    const core = makeCore(3, 10);
    const options = core.getOptions();

    expect(options.count).toBe(3);
    expect(options.overscan).toBe(5);
    expect(options.lanes).toBe(1);
    expect(options.laneAssignmentMode).toBe("estimate");
    expect(options.enabled).toBe(true);
    expect(options.horizontal).toBe(false);
    expect(options.gap).toBe(0);
    expect(options.paddingStart).toBe(0);
    expect(options.paddingEnd).toBe(0);
    expect(options.scrollMargin).toBe(0);
    expect(options.getItemKey(2)).toBe(2);
    expect(options.estimateSize(0)).toBe(10);

    core.setOptions({ count: 4, overscan: 2, gap: 3 });
    expect(core.getOptions().count).toBe(4);
    expect(core.getOptions().overscan).toBe(2);
    expect(core.getOptions().gap).toBe(3);
    expect(core.measurements()).toHaveLength(4);
    expect(core.measurements().map((item) => item.start)).toEqual([
      0, 13, 26, 39,
    ]);
    expect(core.totalSize()).toBe(49);
  });

  it("горизонтальный флаг не меняет математику смещений", () => {
    const core = makeCore(4, 10, { horizontal: true });

    expect(core.totalSize()).toBe(40);
    expect(core.measurements().map((item) => item.start)).toEqual([
      0, 10, 20, 30,
    ]);
  });

  it("rangeExtractor с закреплённым индексом расширяет окно", () => {
    const core = new VirtualizerCore({
      count: 1000,
      estimateSize: () => 10,
      overscan: 1,
      rangeExtractor: (range) => [...defaultRangeExtractor(range), 0],
    });

    const range = core.rangeFor(500, 100);
    expect(range).toEqual({
      startIndex: 50,
      endIndex: 59,
      overscanStartIndex: 0,
      overscanEndIndex: 60,
      count: 1000,
    });
  });
});
