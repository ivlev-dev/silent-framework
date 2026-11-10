export const MATCH_DESCRIPTOR = Symbol.for("silent.match.descriptor");

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
