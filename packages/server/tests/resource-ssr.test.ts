import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearResourceCache,
  createResource,
  createResourceCache,
  Suspense,
  text,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "../src/render.js";

afterEach(() => {
  clearResourceCache();
});

function textView(resource: {
  data(): string | undefined;
  error(): unknown;
}): Node {
  const paragraph = document.createElement("p");
  const label = document.createTextNode("");
  paragraph.appendChild(label);
  text(label, () => {
    if (resource.error() !== undefined) {
      return "failed";
    }
    return resource.data() ?? "loading";
  });
  return paragraph;
}

describe("SSR Resource", () => {
  it("дожидается ресурса и рендерит финальные данные", async () => {
    function View(): Node {
      const resource = createResource(async () => {
        await Promise.resolve();
        return "server-data";
      });
      return textView(resource);
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});

    expect(html).toBe("<p>server-data</p>");
  });

  it("дожидается отложенного ответа", async () => {
    let release: (value: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });

    function View(): Node {
      const resource = createResource(() => gate);
      return textView(resource);
    }

    const pending = renderToString(View as unknown as AnyComponent, {});
    release("late-data");
    const { html } = await pending;

    expect(html).toBe("<p>late-data</p>");
  });

  it("рендерит состояние ошибки без падения рендера", async () => {
    function View(): Node {
      const resource = createResource(async () => {
        throw new Error("ssr failure");
      });
      return textView(resource);
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});

    expect(html).toBe("<p>failed</p>");
  });

  it("использует кэш по ключу между запросами", async () => {
    const cache = createResourceCache();
    const fetcher = vi.fn(async () => "cached-data");

    function View(): Node {
      const resource = createResource(fetcher, { key: "page", cache });
      return textView(resource);
    }

    const first = await renderToString(View as unknown as AnyComponent, {});
    const second = await renderToString(View as unknown as AnyComponent, {});

    expect(first.html).toBe("<p>cached-data</p>");
    expect(second.html).toBe("<p>cached-data</p>");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("дедуплицирует in-flight между ресурсами одного рендера", async () => {
    const cache = createResourceCache();
    const fetcher = vi.fn(async () => {
      await Promise.resolve();
      return "shared-data";
    });

    function View(): Node {
      const first = createResource(fetcher, { key: "same", cache });
      const second = createResource(fetcher, { key: "same", cache });
      const wrapper = document.createElement("div");
      wrapper.appendChild(textView(first));
      wrapper.appendChild(textView(second));
      return wrapper;
    }

    const { html } = await renderToString(View as unknown as AnyComponent, {});

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(html).toBe("<div><p>shared-data</p><p>shared-data</p></div>");
  });

  it("не переиспользует общий кэш между SSR-рендерами без явного cache", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? "secret-for-alice" : "secret-for-bob";
    });

    function View(): Node {
      const resource = createResource(fetcher, { key: "user" });
      return textView(resource);
    }

    const first = await renderToString(View as unknown as AnyComponent, {});
    const second = await renderToString(View as unknown as AnyComponent, {});

    expect(first.html).toBe("<p>secret-for-alice</p>");
    expect(second.html).toBe("<p>secret-for-bob</p>");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("дедуплицирует ресурсы внутри одного SSR-рендера без явного cache", async () => {
    let release: (value: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(() => gate);

    function View(): Node {
      const first = createResource(fetcher, { key: "same-render" });
      const second = createResource(fetcher, { key: "same-render" });
      const wrapper = document.createElement("div");
      wrapper.appendChild(textView(first));
      wrapper.appendChild(textView(second));
      return wrapper;
    }

    const pending = renderToString(View as unknown as AnyComponent, {});
    release("scoped-data");
    const { html } = await pending;

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(html).toBe("<div><p>scoped-data</p><p>scoped-data</p></div>");
  });

  it("Suspense на сервере дожидается ресурса", async () => {
    function View(): Node {
      const resource = createResource(async () => "suspense-data");
      return textView(resource);
    }
    function Loading(): Node {
      const paragraph = document.createElement("p");
      paragraph.textContent = "waiting";
      return paragraph;
    }
    function Page(): Node {
      return Suspense({
        fallback: Loading(),
        children: () => View(),
      });
    }

    const { html } = await renderToString(Page as unknown as AnyComponent, {});

    expect(html).toContain("<p>suspense-data</p>");
    expect(html).not.toContain("waiting");
  });
});
