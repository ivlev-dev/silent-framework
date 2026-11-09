export const DI_CREATE: unique symbol = Symbol.for("silent.di.create");

export type Token<T> = symbol & { readonly __type?: T };

export function createToken<T>(name: string): Token<T> {
  return Symbol(name) as Token<T>;
}
