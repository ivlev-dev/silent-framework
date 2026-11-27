import { createSignal, onCleanup } from "@ivlev-dev/silent-core";

export function createMediaQuery(query: string): () => boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => false;
  }
  const media = window.matchMedia(query);
  const [matches, setMatches] = createSignal(media.matches);
  const listener = (event: MediaQueryListEvent): void => {
    setMatches(event.matches);
  };
  media.addEventListener("change", listener);
  onCleanup(() => {
    media.removeEventListener("change", listener);
  });
  return matches;
}
