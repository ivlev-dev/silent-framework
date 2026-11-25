import { describe, expect, it } from "vitest";
import {
  applyModifiers,
  arrayMove,
  arraySwap,
  closestCenter,
  closestCorners,
  createSnapModifier,
  defaultCoordinates,
  distanceBetween,
  getCenter,
  getClientRect,
  getFirstCollision,
  horizontalListSortingStrategy,
  pointerWithin,
  rectIntersection,
  rectSortingStrategy,
  rectSwappingStrategy,
  restrictToFirstScrollableAncestor,
  restrictToHorizontalAxis,
  restrictToParentElement,
  restrictToVerticalAxis,
  restrictToWindowEdges,
  snapCenterToCursor,
  verticalListSortingStrategy,
} from "../src/index.js";
import {
  adjustTranslate,
  applyTransform,
  clamp,
  intersectionRatio,
  inverseTransform,
  isPointWithinRect,
  rectsIntersect,
} from "../src/core/geometry.js";
import type {
  Active,
  ClientRect,
  Collision,
  CollisionArgs,
  Coordinates,
  DroppableContainer,
  Modifier,
  ModifierArgs,
  SortingStrategy,
  Transform,
  UniqueIdentifier,
} from "../src/index.js";

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): ClientRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function makeActive(
  rectValue: ClientRect | null = null,
  id: UniqueIdentifier = "active",
): Active {
  return { id, data: {}, rect: rectValue };
}

function makeCollisionArgs(options: {
  collisionRect: ClientRect;
  containers: readonly DroppableContainer[];
  rects: Map<UniqueIdentifier, ClientRect>;
  pointerCoordinates?: Coordinates | null;
}): CollisionArgs {
  return {
    active: makeActive(options.collisionRect),
    collisionRect: options.collisionRect,
    droppableRects: options.rects,
    droppableContainers: options.containers,
    pointerCoordinates: options.pointerCoordinates ?? null,
  };
}

function makeModifierArgs(overrides: Partial<ModifierArgs> = {}): ModifierArgs {
  return {
    transform: { x: 0, y: 0 },
    draggingNodeRect: null,
    activatorEvent: null,
    active: makeActive(),
    over: null,
    ...overrides,
  };
}

describe("geometry", () => {
  it("exposes frozen zero coordinates", () => {
    expect(defaultCoordinates).toEqual({ x: 0, y: 0 });
    expect(Object.isFrozen(defaultCoordinates)).toBe(true);
  });

  it("normalizes rect likes from edges and from width/height", () => {
    expect(getClientRect({ top: 10, left: 20, width: 30, height: 40 })).toEqual({
      top: 10,
      left: 20,
      right: 50,
      bottom: 50,
      width: 30,
      height: 40,
    });

    expect(getClientRect({ top: 0, left: 0, right: 100, bottom: 50 })).toEqual({
      top: 0,
      left: 0,
      right: 100,
      bottom: 50,
      width: 100,
      height: 50,
    });
  });

  it("computes centers and euclidean distances", () => {
    expect(getCenter(rect(10, 20, 40, 60))).toEqual({ x: 30, y: 50 });
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("treats rect boundaries as inside for points", () => {
    const bounds = rect(0, 0, 10, 10);

    expect(isPointWithinRect({ x: 0, y: 0 }, bounds)).toBe(true);
    expect(isPointWithinRect({ x: 10, y: 10 }, bounds)).toBe(true);
    expect(isPointWithinRect({ x: 5, y: 5 }, bounds)).toBe(true);
    expect(isPointWithinRect({ x: 10.0001, y: 5 }, bounds)).toBe(false);
  });

  it("detects overlapping, nested and touching rectangles", () => {
    const target = rect(0, 0, 100, 100);

    expect(rectsIntersect(target, rect(50, 50, 100, 100))).toBe(true);
    expect(rectsIntersect(target, rect(10, 10, 20, 20))).toBe(true);
    expect(rectsIntersect(target, rect(100, 0, 10, 10))).toBe(false);
    expect(rectsIntersect(target, rect(200, 200, 10, 10))).toBe(false);
  });

  it("computes intersection ratio as IoU", () => {
    expect(intersectionRatio(rect(0, 0, 10, 10), rect(0, 0, 10, 10))).toBe(1);
    expect(
      intersectionRatio(rect(0, 0, 10, 10), rect(5, 0, 10, 10)),
    ).toBeCloseTo(1 / 3, 10);
    expect(intersectionRatio(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(0);
    expect(intersectionRatio(rect(0, 0, 10, 10), rect(50, 50, 10, 10))).toBe(0);
  });

  it("applies translation about the rect origin", () => {
    expect(applyTransform(rect(0, 0, 10, 10), { x: 5, y: -3 })).toEqual(
      rect(5, -3, 10, 10),
    );
  });

  it("applies scale about the rect center", () => {
    const scaled = applyTransform(rect(0, 0, 10, 10), {
      x: 0,
      y: 0,
      scaleX: 2,
      scaleY: 3,
    });

    expect(scaled).toEqual({
      left: -5,
      top: -10,
      right: 15,
      bottom: 20,
      width: 20,
      height: 30,
    });
  });

  it("round-trips applyTransform through inverseTransform", () => {
    const original = rect(12, 34, 80, 40);
    const transform: Transform = { x: 7, y: -11, scaleX: 2, scaleY: 0.5 };
    const transformed = applyTransform(original, transform);
    const restored = inverseTransform(transform, transformed);

    expect(restored.left).toBeCloseTo(original.left, 10);
    expect(restored.top).toBeCloseTo(original.top, 10);
    expect(restored.width).toBeCloseTo(original.width, 10);
    expect(restored.height).toBeCloseTo(original.height, 10);
  });

  it("treats missing or zero scale as 1 in inverseTransform", () => {
    const original = rect(0, 0, 10, 10);
    const restored = inverseTransform({ x: 5, y: 5, scaleX: 0 }, original);

    expect(restored.width).toBe(10);
    expect(restored.height).toBe(10);
    expect(restored.left).toBe(-5);
    expect(restored.top).toBe(-5);
  });

  it("adds translation deltas without mutating the input", () => {
    const transform: Transform = { x: 1, y: 2, scaleX: 3 };
    const adjusted = adjustTranslate(transform, { x: 10, y: -5 });

    expect(adjusted).toEqual({ x: 11, y: -3, scaleX: 3 });
    expect(transform).toEqual({ x: 1, y: 2, scaleX: 3 });
  });

  it("clamps values to the inclusive range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(5, 10, 0)).toBe(0);
  });
});

describe("collision detection", () => {
  it("rectIntersection keeps only overlapping rects and sorts by ratio", () => {
    const collisionRect = rect(0, 0, 100, 100);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["large", rect(0, 0, 60, 60)],
      ["small", rect(50, 0, 100, 50)],
      ["edge", rect(100, 50, 50, 50)],
      ["far", rect(500, 500, 10, 10)],
      ["disabled", rect(0, 0, 100, 100)],
    ]);
    const containers: DroppableContainer[] = [
      { id: "small", data: { kind: "small" } },
      { id: "large" },
      { id: "edge" },
      { id: "far" },
      { id: "disabled", disabled: true },
      { id: "missing" },
    ];

    const result = rectIntersection(
      makeCollisionArgs({ collisionRect, containers, rects }),
    );

    expect(result.map((collision) => collision.id)).toEqual(["large", "small"]);
    expect(result[1]?.data).toEqual({ kind: "small" });
  });

  it("rectIntersection supports containment and empty input", () => {
    const collisionRect = rect(0, 0, 100, 100);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["inner", rect(10, 10, 20, 20)],
      ["outer", rect(-50, -50, 300, 300)],
    ]);

    expect(
      rectIntersection(
        makeCollisionArgs({
          collisionRect,
          containers: [{ id: "inner" }],
          rects,
        }),
      ).map((collision) => collision.id),
    ).toEqual(["inner"]);

    expect(
      rectIntersection(
        makeCollisionArgs({ collisionRect, containers: [], rects }),
      ),
    ).toEqual([]);
  });

  it("rectIntersection preserves container order for equal ratios", () => {
    const collisionRect = rect(0, 0, 100, 100);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      [2, rect(0, 0, 50, 50)],
      [10, rect(0, 0, 50, 50)],
    ]);

    expect(
      rectIntersection(
        makeCollisionArgs({
          collisionRect,
          containers: [{ id: 2 }, { id: 10 }],
          rects,
        }),
      ).map((collision) => collision.id),
    ).toEqual([2, 10]);
  });

  it("closestCenter orders containers by center distance", () => {
    const collisionRect = rect(0, 0, 10, 10);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["near", rect(20, 0, 10, 10)],
      ["mid", rect(0, 30, 10, 10)],
      ["far", rect(100, 0, 10, 10)],
      ["disabled", rect(11, 0, 10, 10)],
    ]);

    expect(
      closestCenter(
        makeCollisionArgs({
          collisionRect,
          containers: [
            { id: "far" },
            { id: "mid" },
            { id: "near" },
            { id: "disabled", disabled: true },
            { id: "missing" },
          ],
          rects,
        }),
      ).map((collision) => collision.id),
    ).toEqual(["near", "mid", "far"]);
  });

  it("closestCenter preserves container order for equal distances", () => {
    const collisionRect = rect(0, 0, 10, 10);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["b", rect(-10, 0, 10, 10)],
      ["a", rect(10, 0, 10, 10)],
    ]);

    expect(
      closestCenter(
        makeCollisionArgs({
          collisionRect,
          containers: [{ id: "b" }, { id: "a" }],
          rects,
        }),
      ).map((collision) => collision.id),
    ).toEqual(["b", "a"]);
  });

  it("closestCorners orders by the minimum corner distance", () => {
    const collisionRect = rect(0, 0, 10, 10);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["near", rect(12, 0, 10, 10)],
      ["diagonal", rect(12, 12, 10, 10)],
      ["far", rect(100, 100, 10, 10)],
    ]);

    expect(
      closestCorners(
        makeCollisionArgs({
          collisionRect,
          containers: [{ id: "far" }, { id: "diagonal" }, { id: "near" }],
          rects,
        }),
      ).map((collision) => collision.id),
    ).toEqual(["near", "diagonal", "far"]);
  });

  it("closestCorners preserves container order for equal corner distances", () => {
    const collisionRect = rect(0, 0, 10, 10);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["b", rect(-12, 0, 10, 10)],
      ["a", rect(12, 0, 10, 10)],
    ]);

    expect(
      closestCorners(
        makeCollisionArgs({
          collisionRect,
          containers: [{ id: "b" }, { id: "a" }],
          rects,
        }),
      ).map((collision) => collision.id),
    ).toEqual(["b", "a"]);
  });

  it("closestCorners averages corresponding corners, not the closest pair", () => {
    const collisionRect = rect(0, 0, 10, 10);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["big", rect(0, 0, 100, 100)],
      ["diagonal", rect(20, 20, 10, 10)],
    ]);

    // Минимум по 16 парам углов дал бы "big" (0px), но эталон считает
    // среднее по соответствующим углам:
    // diagonal ≈ 28.2843 < big ≈ 76.8198.
    expect(
      closestCorners(
        makeCollisionArgs({
          collisionRect,
          containers: [{ id: "big" }, { id: "diagonal" }],
          rects,
        }),
      ).map((collision) => collision.id),
    ).toEqual(["diagonal", "big"]);
  });

  it("pointerWithin returns containers under the pointer, closest first", () => {
    const collisionRect = rect(0, 0, 10, 10);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["z-inner", rect(40, 40, 20, 20)],
      ["a-outer", rect(0, 0, 100, 100)],
      ["m-edge", rect(50, 50, 10, 10)],
      ["outside", rect(51, 51, 10, 10)],
      ["disabled", rect(0, 0, 100, 100)],
    ]);

    expect(
      pointerWithin(
        makeCollisionArgs({
          collisionRect,
          containers: [
            { id: "a-outer" },
            { id: "z-inner" },
            { id: "m-edge" },
            { id: "outside" },
            { id: "disabled", disabled: true },
          ],
          rects,
          pointerCoordinates: { x: 50, y: 50 },
        }),
      ).map((collision) => collision.id),
    ).toEqual(["m-edge", "z-inner", "a-outer"]);
  });

  it("pointerWithin includes the rect boundary and handles null pointer", () => {
    const collisionRect = rect(0, 0, 10, 10);
    const rects = new Map<UniqueIdentifier, ClientRect>([
      ["target", rect(0, 0, 100, 100)],
    ]);

    expect(
      pointerWithin(
        makeCollisionArgs({
          collisionRect,
          containers: [{ id: "target" }],
          rects,
          pointerCoordinates: { x: 100, y: 100 },
        }),
      ).map((collision) => collision.id),
    ).toEqual(["target"]);

    expect(
      pointerWithin(
        makeCollisionArgs({
          collisionRect,
          containers: [{ id: "target" }],
          rects,
          pointerCoordinates: null,
        }),
      ),
    ).toEqual([]);
  });

  it("getFirstCollision returns the first or the requested collision", () => {
    const collisions: Collision[] = [
      { id: "a" },
      { id: "b", data: { value: 1 } },
    ];

    expect(getFirstCollision(null)).toBeNull();
    expect(getFirstCollision([])).toBeNull();
    expect(getFirstCollision(collisions)).toEqual({ id: "a" });
    expect(getFirstCollision(collisions, "b")).toEqual({
      id: "b",
      data: { value: 1 },
    });
    expect(getFirstCollision(collisions, "missing")).toBeNull();
  });
});

describe("modifiers", () => {
  it("restrictToVerticalAxis zeroes horizontal translation", () => {
    const transform: Transform = { x: 12, y: 34, scaleX: 2 };

    expect(
      restrictToVerticalAxis(makeModifierArgs({ transform })),
    ).toEqual({ x: 0, y: 34, scaleX: 2 });
  });

  it("restrictToHorizontalAxis zeroes vertical translation", () => {
    const transform: Transform = { x: 12, y: 34, scaleY: 3 };

    expect(
      restrictToHorizontalAxis(makeModifierArgs({ transform })),
    ).toEqual({ x: 12, y: 0, scaleY: 3 });
  });

  it("restrictToWindowEdges clamps to the window rect", () => {
    const transform: Transform = { x: 500, y: -500 };

    expect(
      restrictToWindowEdges(
        makeModifierArgs({
          transform,
          draggingNodeRect: rect(100, 100, 50, 50),
          windowRect: rect(0, 0, 300, 300),
        }),
      ),
    ).toEqual({ x: 150, y: -100 });
  });

  it("restrictToWindowEdges can be preconfigured with a window rect", () => {
    const modifier = restrictToWindowEdges({
      windowRect: rect(0, 0, 300, 300),
    });

    expect(
      modifier(
        makeModifierArgs({
          transform: { x: 500, y: -500 },
          draggingNodeRect: rect(100, 100, 50, 50),
        }),
      ),
    ).toEqual({ x: 150, y: -100 });
  });

  it("restrictToWindowEdges returns the input without a window rect", () => {
    const transform: Transform = { x: 5, y: 6 };
    const args = makeModifierArgs({ transform });

    expect(restrictToWindowEdges(args)).toBe(transform);
  });

  it("restrictToParentElement clamps to the parent container", () => {
    const transform: Transform = { x: 100, y: -100 };

    expect(
      restrictToParentElement(
        makeModifierArgs({
          transform,
          draggingNodeRect: rect(50, 50, 100, 100),
          containerRect: rect(0, 0, 200, 200),
        }),
      ),
    ).toEqual({ x: 50, y: -50 });
  });

  it("restrictToFirstScrollableAncestor clamps to the scroll container", () => {
    const transform: Transform = { x: 100, y: -100 };

    expect(
      restrictToFirstScrollableAncestor(
        makeModifierArgs({
          transform,
          draggingNodeRect: rect(50, 50, 20, 20),
          scrollableAncestorRect: rect(10, 10, 100, 100),
        }),
      ),
    ).toEqual({ x: 40, y: -40 });
  });

  it("createSnapModifier rounds translation to the grid", () => {
    const snap = createSnapModifier(10);

    expect(snap(makeModifierArgs({ transform: { x: 14, y: 26 } }))).toEqual({
      x: 10,
      y: 30,
    });
    expect(snap(makeModifierArgs({ transform: { x: -14, y: -26 } }))).toEqual({
      x: -10,
      y: -30,
    });
  });

  it("createSnapModifier rejects invalid grid sizes", () => {
    expect(() => createSnapModifier(0)).toThrow(RangeError);
    expect(() => createSnapModifier(-5)).toThrow(RangeError);
    expect(() => createSnapModifier(Number.NaN)).toThrow(RangeError);
  });

  it("snapCenterToCursor centers the node under the pointer", () => {
    expect(
      snapCenterToCursor(
        makeModifierArgs({
          transform: { x: 5, y: 5 },
          draggingNodeRect: rect(100, 100, 40, 20),
          pointerCoordinates: { x: 200, y: 150 },
        }),
      ),
    ).toEqual({ x: 85, y: 45 });
  });

  it("snapCenterToCursor is a no-op without pointer coordinates", () => {
    const transform: Transform = { x: 5, y: 5 };
    const args = makeModifierArgs({
      transform,
      draggingNodeRect: rect(100, 100, 40, 20),
    });

    expect(snapCenterToCursor(args)).toBe(transform);
  });

  it("applyModifiers composes modifiers in order", () => {
    const args = makeModifierArgs({ transform: { x: 37, y: 23 } });

    expect(
      applyModifiers([restrictToVerticalAxis, createSnapModifier(10)], args),
    ).toEqual({ x: 0, y: 20 });

    const addTen: Modifier = ({ transform }) => ({
      ...transform,
      x: transform.x + 10,
    });
    const doubleX: Modifier = ({ transform }) => ({
      ...transform,
      x: transform.x * 2,
    });
    const base = makeModifierArgs({ transform: { x: 1, y: 0 } });

    expect(applyModifiers([addTen, doubleX], base)).toEqual({ x: 22, y: 0 });
    expect(applyModifiers([doubleX, addTen], base)).toEqual({ x: 12, y: 0 });
  });

  it("applyModifiers preserves identity for empty or missing lists", () => {
    const transform: Transform = { x: 1, y: 2 };
    const args = makeModifierArgs({ transform });

    expect(applyModifiers([], args)).toBe(transform);
    expect(applyModifiers(undefined, args)).toBe(transform);
  });
});

describe("sortable", () => {
  it("arrayMove moves forward and backward immutably", () => {
    const source = ["a", "b", "c", "d"];

    expect(arrayMove(source, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(arrayMove(source, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(source).toEqual(["a", "b", "c", "d"]);
  });

  it("arrayMove normalizes negative and out-of-range indexes", () => {
    expect(arrayMove(["a", "b", "c"], -1, 0)).toEqual(["c", "a", "b"]);
    expect(arrayMove(["a", "b", "c"], 0, -1)).toEqual(["b", "c", "a"]);
    expect(arrayMove(["a", "b", "c", "d"], 10, 0)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
    expect(arrayMove(["a", "b", "c", "d"], 0, 100)).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
  });

  it("arrayMove returns a fresh copy for empty, single and same-index lists", () => {
    expect(arrayMove([], 0, 0)).toEqual([]);
    expect(arrayMove(["a"], 0, 0)).toEqual(["a"]);

    const source = ["a", "b"];
    const result = arrayMove(source, 1, 1);

    expect(result).toEqual(["a", "b"]);
    expect(result).not.toBe(source);
  });

  it("arraySwap swaps items immutably and normalizes indexes", () => {
    const source = ["a", "b", "c"];

    expect(arraySwap(source, 0, 2)).toEqual(["c", "b", "a"]);
    expect(arraySwap(source, -1, 0)).toEqual(["c", "b", "a"]);
    expect(arraySwap(source, 10, 0)).toEqual(["c", "b", "a"]);
    expect(arraySwap([], 0, 1)).toEqual([]);
    expect(source).toEqual(["a", "b", "c"]);
  });

  it("arraySwap returns a fresh copy for equal indexes", () => {
    const source = ["a", "b"];
    const result = arraySwap(source, 1, 1);

    expect(result).toEqual(["a", "b"]);
    expect(result).not.toBe(source);
  });

  const v0 = rect(0, 0, 100, 20);
  const v1 = rect(0, 30, 100, 20);
  const v2 = rect(0, 60, 100, 20);
  const v3 = rect(0, 90, 100, 20);
  const verticalRects = [v0, v1, v2, v3];

  it("verticalListSortingStrategy shifts items while moving down", () => {
    const args = {
      activeIndex: 0,
      overIndex: 2,
      rects: verticalRects,
      activeNodeRect: v0,
    };

    expect(
      verticalListSortingStrategy({ ...args, index: 0 }),
    ).toEqual({ x: 0, y: 60 });
    expect(
      verticalListSortingStrategy({ ...args, index: 1 }),
    ).toEqual({ x: 0, y: -30 });
    expect(
      verticalListSortingStrategy({ ...args, index: 2 }),
    ).toEqual({ x: 0, y: -30 });
    expect(
      verticalListSortingStrategy({ ...args, index: 3 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("verticalListSortingStrategy shifts items while moving up", () => {
    const args = {
      activeIndex: 2,
      overIndex: 0,
      rects: verticalRects,
      activeNodeRect: v2,
    };

    expect(
      verticalListSortingStrategy({ ...args, index: 2 }),
    ).toEqual({ x: 0, y: -60 });
    expect(
      verticalListSortingStrategy({ ...args, index: 1 }),
    ).toEqual({ x: 0, y: 30 });
    expect(
      verticalListSortingStrategy({ ...args, index: 0 }),
    ).toEqual({ x: 0, y: 30 });
    expect(
      verticalListSortingStrategy({ ...args, index: 3 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("verticalListSortingStrategy falls back to overRect", () => {
    expect(
      verticalListSortingStrategy({
        activeIndex: 0,
        overIndex: 1,
        index: 0,
        rects: [v0, null],
        activeNodeRect: v0,
        overRect: v1,
      }),
    ).toEqual({ x: 0, y: 30 });
  });

  const h0 = rect(0, 0, 100, 20);
  const h1 = rect(110, 0, 100, 20);
  const h2 = rect(220, 0, 100, 20);
  const h3 = rect(330, 0, 100, 20);
  const horizontalRects = [h0, h1, h2, h3];

  it("horizontalListSortingStrategy shifts items while moving forward", () => {
    const args = {
      activeIndex: 0,
      overIndex: 2,
      rects: horizontalRects,
      activeNodeRect: h0,
    };

    expect(
      horizontalListSortingStrategy({ ...args, index: 0 }),
    ).toEqual({ x: 220, y: 0 });
    expect(
      horizontalListSortingStrategy({ ...args, index: 1 }),
    ).toEqual({ x: -110, y: 0 });
    expect(
      horizontalListSortingStrategy({ ...args, index: 2 }),
    ).toEqual({ x: -110, y: 0 });
    expect(
      horizontalListSortingStrategy({ ...args, index: 3 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("horizontalListSortingStrategy shifts items while moving backward", () => {
    const args = {
      activeIndex: 2,
      overIndex: 0,
      rects: horizontalRects,
      activeNodeRect: h2,
    };

    expect(
      horizontalListSortingStrategy({ ...args, index: 2 }),
    ).toEqual({ x: -220, y: 0 });
    expect(
      horizontalListSortingStrategy({ ...args, index: 1 }),
    ).toEqual({ x: 110, y: 0 });
    expect(
      horizontalListSortingStrategy({ ...args, index: 0 }),
    ).toEqual({ x: 110, y: 0 });
  });

  const g0 = rect(0, 0, 10, 10);
  const g1 = rect(10, 0, 10, 10);
  const g2 = rect(20, 0, 10, 10);
  const g3 = rect(30, 0, 10, 10);
  const gridRects = [g0, g1, g2, g3];

  it("rectSortingStrategy moves rectangles into reordered slots", () => {
    const args = {
      activeIndex: 0,
      overIndex: 2,
      rects: gridRects,
      activeNodeRect: g0,
    };

    // Классическая семантика: arrayMove(rects, overIndex, activeIndex)
    // даёт [g2, g0, g1, g3], поэтому g0→+20, g1→-10, g2→-10, g3→0.
    expect(rectSortingStrategy({ ...args, index: 0 })).toEqual({
      x: 20,
      y: 0,
    });
    expect(rectSortingStrategy({ ...args, index: 1 })).toEqual({
      x: -10,
      y: 0,
    });
    expect(rectSortingStrategy({ ...args, index: 2 })).toEqual({
      x: -10,
      y: 0,
    });
    expect(rectSortingStrategy({ ...args, index: 3 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("rectSwappingStrategy swaps only the active and over items", () => {
    const args = {
      activeIndex: 0,
      overIndex: 2,
      rects: gridRects,
      activeNodeRect: g0,
    };

    expect(rectSwappingStrategy({ ...args, index: 0 })).toEqual({
      x: 20,
      y: 0,
    });
    expect(rectSwappingStrategy({ ...args, index: 1 })).toBeNull();
    expect(rectSwappingStrategy({ ...args, index: 2 })).toEqual({
      x: -20,
      y: 0,
    });
    expect(rectSwappingStrategy({ ...args, index: 3 })).toBeNull();
  });

  it("all strategies handle empty lists", () => {
    const strategies: SortingStrategy[] = [
      verticalListSortingStrategy,
      horizontalListSortingStrategy,
      rectSortingStrategy,
      rectSwappingStrategy,
    ];

    for (const strategy of strategies) {
      expect(
        strategy({
          activeIndex: 0,
          overIndex: 0,
          index: 0,
          rects: [],
          activeNodeRect: null,
        }),
      ).toBeNull();
    }
  });

  it("all strategies handle a single-item list", () => {
    const only = rect(0, 0, 100, 20);
    const strategies: SortingStrategy[] = [
      verticalListSortingStrategy,
      horizontalListSortingStrategy,
      rectSortingStrategy,
      rectSwappingStrategy,
    ];

    for (const strategy of strategies) {
      expect(
        strategy({
          activeIndex: 0,
          overIndex: 0,
          index: 0,
          rects: [only],
          activeNodeRect: only,
        }),
      ).toEqual({ x: 0, y: 0 });
    }
  });

  it("verticalListSortingStrategy returns null when the over rect is missing", () => {
    expect(
      verticalListSortingStrategy({
        activeIndex: 0,
        overIndex: 1,
        index: 0,
        rects: [v0],
        activeNodeRect: v0,
      }),
    ).toBeNull();
  });
});
