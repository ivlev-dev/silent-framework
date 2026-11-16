export interface HistoryLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly state: unknown;
}

export type HistoryListener = (location: HistoryLocation) => void;

export interface RouterHistory {
  readonly location: HistoryLocation;
  push(to: string, state?: unknown): void;
  replace(to: string, state?: unknown): void;
  back(): void;
  forward(): void;
  listen(listener: HistoryListener): () => void;
  dispose(): void;
}

function splitUrl(url: string): { pathname: string; search: string; hash: string } {
  let rest = url;
  let hash = "";
  const hashIndex = rest.indexOf("#");
  if (hashIndex !== -1) {
    hash = rest.slice(hashIndex);
    rest = rest.slice(0, hashIndex);
  }
  let search = "";
  const queryIndex = rest.indexOf("?");
  if (queryIndex !== -1) {
    search = rest.slice(queryIndex);
    rest = rest.slice(0, queryIndex);
  }
  return {
    pathname: rest === "" ? "/" : rest,
    search,
    hash,
  };
}

export class MemoryHistory implements RouterHistory {
  private entries: { url: string; state: unknown }[];
  private index = 0;
  private listeners = new Set<HistoryListener>();
  private disposed = false;

  constructor(initial: string | { url: string; state?: unknown } = "/") {
    const url = typeof initial === "string" ? initial : initial.url;
    const state = typeof initial === "string" ? null : initial.state ?? null;
    this.entries = [{ url, state }];
  }

  get length(): number {
    return this.entries.length;
  }

  get position(): number {
    return this.index;
  }

  get location(): HistoryLocation {
    const entry = this.entries[this.index];
    if (entry === undefined) {
      return { pathname: "/", search: "", hash: "", state: null };
    }
    const parts = splitUrl(entry.url);
    return { ...parts, state: entry.state };
  }

  push(to: string, state?: unknown): void {
    if (this.disposed) {
      return;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ url: to, state: state ?? null });
    this.index = this.entries.length - 1;
  }

  replace(to: string, state?: unknown): void {
    if (this.disposed) {
      return;
    }
    this.entries[this.index] = { url: to, state: state ?? null };
  }

  back(): void {
    if (this.disposed || this.index === 0) {
      return;
    }
    this.index -= 1;
    this.emit();
  }

  forward(): void {
    if (this.disposed || this.index >= this.entries.length - 1) {
      return;
    }
    this.index += 1;
    this.emit();
  }

  listen(listener: HistoryListener): () => void {
    if (this.disposed) {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private emit(): void {
    const location = this.location;
    for (const listener of [...this.listeners]) {
      listener(location);
    }
  }
}

export function createMemoryHistory(
  initial: string | { url: string; state?: unknown } = "/",
): MemoryHistory {
  return new MemoryHistory(initial);
}

export class BrowserHistory implements RouterHistory {
  private listeners = new Set<HistoryListener>();
  private disposed = false;
  private lastUrl: string;
  private readonly win: Window;

  constructor(win: Window = window) {
    this.win = win;
    this.lastUrl = this.currentUrl();
    this.win.addEventListener("popstate", this.handle);
    this.win.addEventListener("hashchange", this.handle);
  }

  get location(): HistoryLocation {
    const { pathname, search, hash } = this.win.location;
    return {
      pathname,
      search,
      hash,
      state: this.win.history.state,
    };
  }

  push(to: string, state?: unknown): void {
    if (this.disposed) {
      return;
    }
    this.win.history.pushState(state ?? null, "", to);
    this.lastUrl = this.currentUrl();
  }

  replace(to: string, state?: unknown): void {
    if (this.disposed) {
      return;
    }
    this.win.history.replaceState(state ?? null, "", to);
    this.lastUrl = this.currentUrl();
  }

  back(): void {
    if (this.disposed) {
      return;
    }
    this.win.history.back();
  }

  forward(): void {
    if (this.disposed) {
      return;
    }
    this.win.history.forward();
  }

  listen(listener: HistoryListener): () => void {
    if (this.disposed) {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.listeners.clear();
    this.win.removeEventListener("popstate", this.handle);
    this.win.removeEventListener("hashchange", this.handle);
  }

  private currentUrl(): string {
    const { pathname, search, hash } = this.win.location;
    return `${pathname}${search}${hash}`;
  }

  private readonly handle = (): void => {
    if (this.disposed) {
      return;
    }
    const url = this.currentUrl();
    if (url === this.lastUrl) {
      return;
    }
    this.lastUrl = url;
    const location = this.location;
    for (const listener of [...this.listeners]) {
      listener(location);
    }
  };
}

export function createBrowserHistory(win?: Window): BrowserHistory {
  return new BrowserHistory(win);
}
