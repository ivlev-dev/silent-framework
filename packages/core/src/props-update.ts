export type PropsUpdater = (props: Record<string, unknown>) => void;

const updaters = new WeakMap<Node, PropsUpdater>();

export function registerPropsUpdater(
  node: Node | null | undefined,
  updater: PropsUpdater,
): void {
  if (node === null || node === undefined) {
    return;
  }
  updaters.set(node, updater);
}

export function getPropsUpdater(node: Node): PropsUpdater | null {
  return updaters.get(node) ?? null;
}

export function updateProps(
  node: Node,
  props: Record<string, unknown>,
): boolean {
  const updater = updaters.get(node);
  if (updater === undefined) {
    return false;
  }
  updater(props);
  return true;
}
