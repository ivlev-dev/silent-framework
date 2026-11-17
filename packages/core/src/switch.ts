import { createRenderEffect, createSignal, onCleanup } from "@ivlev-dev/silent-reactivity";
import type { Children } from "./jsx.js";
import {
  MATCH_DESCRIPTOR,
  attachMatch,
  isMatchNode,
  markDirectComponent,
} from "./match-node.js";
import { collectNodes, createMountPoint, isServerMode } from "./dom.js";
import { extractMetadata } from "./metadata.js";
import { settleNodes } from "./dom-hydration-state.js";
import { beginRegion, regionMatches, settleWindow } from "./hydration-cursor.js";
import {
  SWITCH,
  collectBetween,
  currentWindow,
  isHydrating,
  isMarker,
  mismatch,
  withWindow,
} from "./hydration-proxy.js";

declare const __SILENT_SERVER__: boolean | undefined;

const SERVER = typeof __SILENT_SERVER__ === "undefined" || __SILENT_SERVER__;

export interface MatchProps {
  readonly when: unknown | (() => unknown);
  readonly children?: unknown;
}

export interface SwitchProps {
  readonly fallback?: unknown;
  readonly children: unknown | (() => unknown);
}

function truthy(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && value !== 0 && value !== "";
}

function resolve(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  return current;
}

interface Branch {
  readonly key: number;
  readonly read: () => unknown;
}

interface ScanState {
  index: number;
}

function scanBranch(value: unknown, state: ScanState): Branch | null {
  let current = value;
  while (typeof current === "function") {
    current = (current as () => unknown)();
  }
  if (Array.isArray(current)) {
    for (let index = 0; index < current.length; index += 1) {
      const found = scanBranch(current[index], state);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (!isMatchNode(current)) {
    return null;
  }
  const key = state.index;
  state.index += 1;
  const descriptor = current[MATCH_DESCRIPTOR];
  if (!truthy(descriptor.when())) {
    return null;
  }
  return { key, read: descriptor.children };
}

function findBranch(children: unknown): Branch | null {
  return scanBranch(children, { index: 0 });
}

function select(props: SwitchProps): unknown {
  const branch = findBranch(props.children);
  return branch === null ? resolve(props.fallback) : branch.read();
}

interface BranchBinding {
  read: () => unknown;
  readonly version: () => number;
}

function bindBranch(props: SwitchProps): BranchBinding {
  const [epoch, setEpoch] = createSignal(0);
  const binding: BranchBinding = {
    read: () => resolve(props.fallback),
    version: epoch,
  };
  let selected: number | null | undefined = undefined;
  createRenderEffect(() => {
    const branch = findBranch(props.children);
    const key = branch === null ? null : branch.key;
    if (selected === key) {
      return;
    }
    selected = key;
    binding.read = branch === null ? () => resolve(props.fallback) : branch.read;
    setEpoch((value) => value + 1);
  });
  return binding;
}

export function Match(props: MatchProps): Node {
  const node = document.createComment("silent-match");
  attachMatch(node, {
    when: () => resolve(props.when),
    children: () => resolve(props.children),
  });
  return node;
}

markDirectComponent(Match);
markDirectComponent(Switch);

export function Switch(props: SwitchProps): Node {
  if (SERVER && isServerMode()) {
    const container = document.createDocumentFragment();
    const nodes = extractMetadata(collectNodes(select(props) as Children));
    for (const node of nodes) {
      container.appendChild(node);
    }
    container.appendChild(document.createComment(SWITCH));
    return container;
  }
  if (isHydrating()) {
    const outer = currentWindow();
    if (outer === null) {
      return mismatch("Switch вне окна гидрации");
    }
    const anchor = outer.end.previousSibling;
    if (!isMarker(anchor, SWITCH)) {
      return mismatch("не найден якорь Switch");
    }
    const parent = anchor.parentNode;
    if (parent === null) {
      return mismatch("якорь Switch отсоединён");
    }
    const mount = createMountPoint(parent, anchor, collectBetween(outer.start, anchor));
    const binding = bindBranch(props);
    let initialized = false;
    createRenderEffect(() => {
      binding.version();
      if (!initialized) {
        initialized = true;
        const window = beginRegion(outer, anchor);
        const value = withWindow(window, binding.read);
        settleNodes(anchor, value);
        if (!regionMatches(window, anchor, value)) {
          mismatch("содержимое Switch не совпало");
        }
        settleWindow(outer, anchor);
        return;
      }
      mount.render(binding.read());
    });
    onCleanup(mount.clear);
    return document.createDocumentFragment();
  }

  const container = document.createDocumentFragment();
  const anchor = document.createComment(SWITCH);
  container.appendChild(anchor);
  const mount = createMountPoint(container, anchor);
  const binding = bindBranch(props);
  createRenderEffect(() => {
    binding.version();
    mount.render(binding.read());
  });
  onCleanup(mount.clear);
  return container;
}
