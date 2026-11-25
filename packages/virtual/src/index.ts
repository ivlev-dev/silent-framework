export { VirtualizerCore } from "./core/engine.js";
export { defaultKey } from "./core/keys.js";
export {
  computeRange,
  defaultRangeExtractor,
} from "./core/range.js";
export { computeServerSlice } from "./core/ssr.js";
export type {
  LaneAssignmentMode,
  Range,
  ScrollAlignment,
  VirtualItem,
  VirtualizerOptions,
} from "./core/types.js";

export {
  createVirtualizer,
  type CreateVirtualizerOptions,
  type Virtualizer,
} from "./adapter/create-virtualizer.js";
export {
  VirtualList,
  type VirtualListProps,
} from "./components/virtual-list.js";
export {
  VirtualGrid,
  type VirtualGridProps,
} from "./components/virtual-grid.js";
