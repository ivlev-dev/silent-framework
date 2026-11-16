import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserHistory,
  MemoryHistory,
  createBrowserHistory,
  createMemoryHistory,
  type HistoryLocation,
} from "../src/index";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("MemoryHistory", () => {
  it("хранит начальную локацию и разбирает URL", () => {
    const history = createMemoryHistory("/users/1?tab=a#top");
    expect(history.location).toEqual({
      pathname: "/users/1",
      search: "?tab=a",
      hash: "#top",
      state: null,
    });
    expect(history.length).toBe(1);
    expect(history.position).toBe(0);
  });

  it("поддерживает push, replace и state", () => {
    const history = createMemoryHistory({ url: "/", state: { initial: true } });
    history.push("/a", { page: 1 });
    expect(history.length).toBe(2);
    expect(history.location.pathname).toBe("/a");
    expect(history.location.state).toEqual({ page: 1 });
    history.replace("/b", { page: 2 });
    expect(history.length).toBe(2);
    expect(history.location.pathname).toBe("/b");
    expect(history.location.state).toEqual({ page: 2 });
  });

  it("уведомляет подписчиков только при back и forward", () => {
    const history = createMemoryHistory("/");
    const seen: string[] = [];
    const unlisten = history.listen((location: HistoryLocation) => {
      seen.push(location.pathname);
    });
    history.push("/a");
    history.push("/b");
    expect(seen).toEqual([]);
    history.back();
    expect(seen).toEqual(["/a"]);
    history.back();
    expect(seen).toEqual(["/a", "/"]);
    history.forward();
    expect(seen).toEqual(["/a", "/", "/a"]);
    unlisten();
    history.back();
    expect(seen).toEqual(["/a", "/", "/a"]);
  });

  it("обрезает forward-ветку при push после back", () => {
    const history = createMemoryHistory("/");
    history.push("/a");
    history.push("/b");
    history.back();
    history.push("/c");
    expect(history.length).toBe(3);
    expect(history.location.pathname).toBe("/c");
    history.forward();
    expect(history.location.pathname).toBe("/c");
  });

  it("игнорирует операции после dispose", () => {
    const history = createMemoryHistory("/");
    const listener = vi.fn();
    history.listen(listener);
    history.dispose();
    history.push("/a");
    history.back();
    expect(history.location.pathname).toBe("/");
    expect(listener).not.toHaveBeenCalled();
    expect(history.listen(listener)()).toBeUndefined();
  });
});

describe("BrowserHistory", () => {
  it("пишет в history браузера и читает состояние", () => {
    window.history.replaceState(null, "", "/");
    const history = createBrowserHistory(window);
    expect(history).toBeInstanceOf(BrowserHistory);
    expect(history.location.pathname).toBe("/");
    history.push("/a?x=1#h", { from: "test" });
    expect(window.location.pathname).toBe("/a");
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("#h");
    expect(history.location.state).toEqual({ from: "test" });
    history.replace("/b");
    expect(window.location.pathname).toBe("/b");
    history.dispose();
  });

  it("реагирует на popstate и не дублирует события", () => {
    window.history.replaceState(null, "", "/");
    const history = createBrowserHistory(window);
    const listener = vi.fn();
    history.listen(listener);
    window.history.replaceState(null, "", "/next");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ pathname: "/next" });
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(listener).toHaveBeenCalledTimes(1);
    history.dispose();
  });

  it("реагирует на hashchange", () => {
    window.history.replaceState(null, "", "/page");
    const history = createBrowserHistory(window);
    const listener = vi.fn();
    history.listen(listener);
    window.history.replaceState(null, "", "/page#section");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      pathname: "/page",
      hash: "#section",
    });
    history.dispose();
  });

  it("снимает слушатели при dispose и unlisten", () => {
    window.history.replaceState(null, "", "/");
    const history = new BrowserHistory(window);
    const listener = vi.fn();
    const unlisten = history.listen(listener);
    unlisten();
    window.history.replaceState(null, "", "/ignored");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(listener).not.toHaveBeenCalled();
    history.dispose();
    window.history.replaceState(null, "", "/also-ignored");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("MemoryHistory подходит для SSR без window", () => {
    const history: MemoryHistory = createMemoryHistory("/ssr?x=1");
    expect(history.location.pathname).toBe("/ssr");
    expect(history.location.search).toBe("?x=1");
    history.push("/ssr/2");
    expect(history.location.pathname).toBe("/ssr/2");
  });
});
