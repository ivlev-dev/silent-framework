export interface HydrationApi {
  prepare?(): void;
  hydrate(container: Element): Promise<() => void>;
}

declare global {
  interface Window {
    __hydrateBench?: HydrationApi;
  }
}
