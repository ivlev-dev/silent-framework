export const MATCH_DESCRIPTOR = Symbol.for("silent.match.descriptor");
export const DIRECT_COMPONENT = Symbol.for("silent.directComponent");

export function markDirectComponent(component: unknown): void {
  (component as Record<PropertyKey, unknown>)[DIRECT_COMPONENT] = true;
}

export function isDirectComponent(component: unknown): boolean {
  return (component as Record<PropertyKey, unknown>)[DIRECT_COMPONENT] === true;
}

export interface MatchDescriptor {
  readonly when: () => unknown;
  readonly children: () => unknown;
}

export interface MatchNode extends Comment {
  [MATCH_DESCRIPTOR]: MatchDescriptor;
}

export function attachMatch(node: Comment, descriptor: MatchDescriptor): void {
  (node as MatchNode)[MATCH_DESCRIPTOR] = descriptor;
}

export function isMatchNode(value: unknown): value is MatchNode {
  return (
    value instanceof Node &&
    (value as unknown as Partial<MatchNode>)[MATCH_DESCRIPTOR] !== undefined
  );
}
