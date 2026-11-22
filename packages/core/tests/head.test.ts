import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSignal, flushSync } from "@ivlev-dev/silent-reactivity";
import { templateHoles } from "../src/dom.js";
import { Head } from "../src/head.js";
import { hydrate } from "../src/hydrate.js";
import { HydrationMismatchError } from "../src/hydration.js";
import { mount, type MountHandle } from "../src/mount.js";
import type { AnyComponent } from "../src/types.js";

const handles: MountHandle[] = [];
const hosts: HTMLElement[] = [];
let baseHead: Node[] = [];

beforeAll(() => {
  baseHead = Array.from(document.head.childNodes);
});

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const host of hosts.splice(0)) {
    host.remove();
  }
  document.body.replaceChildren();
  document.head.replaceChildren(...baseHead);
});

function titles(): string[] {
  return Array.from(document.head.querySelectorAll("title")).map(
    (title) => title.textContent ?? "",
  );
}

function metas(name: string): Element[] {
  return Array.from(document.head.querySelectorAll(`meta[name="${name}"]`));
}

function createHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

async function mountPage(
  page: AnyComponent,
  props: Record<string, unknown> = {},
): Promise<HTMLElement> {
  const host = createHost();
  const handle = await mount(host, page, { props });
  handles.push(handle);
  return host;
}

describe("Head: регистрация", () => {
  it("переносит title, meta, link и style в head", async () => {
    function Page(): Node {
      Head({
        title: "Page",
        meta: [
          { name: "description", content: "desc" },
          { property: "og:title", content: "OG" },
          { charset: "utf-8" },
          { httpEquiv: "refresh", content: "30" },
        ],
        link: [
          { rel: "stylesheet", href: "/app.css" },
          { rel: "icon", href: "/favicon.ico" },
        ],
        style: [{ css: "body{margin:0}" }],
      });
      return templateHoles("<main><h1>Body</h1></main>")().node;
    }

    const host = await mountPage(Page as unknown as AnyComponent);

    expect(document.title).toBe("Page");
    expect(titles()).toEqual(["Page"]);
    expect(
      document.head
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe("desc");
    expect(
      document.head
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content"),
    ).toBe("OG");
    expect(
      document.head.querySelector("meta[charset]")?.getAttribute("charset"),
    ).toBe("utf-8");
    expect(
      document.head
        .querySelector('meta[http-equiv="refresh"]')
        ?.getAttribute("content"),
    ).toBe("30");
    expect(
      document.head
        .querySelector('link[rel="stylesheet"]')
        ?.getAttribute("href"),
    ).toBe("/app.css");
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull();
    expect(document.head.querySelector("style")?.textContent).toBe(
      "body{margin:0}",
    );
    expect(host.querySelector("title")).toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("Body");
  });

  it("возвращает пустой фрагмент и не оставляет узлов в разметке", async () => {
    const host = createHost();
    const handle = await mount(host, Head as unknown as AnyComponent, {
      props: { title: "Direct" },
    });
    handles.push(handle);

    expect(document.title).toBe("Direct");
    expect(host.childNodes).toHaveLength(0);

    handle.dispose();
    handles.pop();
    expect(document.title).toBe("");
    expect(titles()).toEqual([]);
  });

  it("очищает head при unmount", async () => {
    function Page(): Node {
      Head({
        title: "Temp",
        meta: [{ name: "keywords", content: "a,b" }],
        link: [{ rel: "stylesheet", href: "/temp.css" }],
        style: [{ id: "temp-style", css: ".temp{color:red}" }],
      });
      return templateHoles("<p>body</p>")().node;
    }

    await mountPage(Page as unknown as AnyComponent);

    expect(document.head.querySelector('meta[name="keywords"]')).not.toBeNull();
    expect(document.head.querySelector("style#temp-style")).not.toBeNull();

    handles.pop()?.dispose();

    expect(titles()).toEqual([]);
    expect(document.head.querySelector('meta[name="keywords"]')).toBeNull();
    expect(document.head.querySelector('link[href="/temp.css"]')).toBeNull();
    expect(document.head.querySelector("style#temp-style")).toBeNull();
  });
});

describe("Head: дедупликация", () => {
  it("держит один title: последний смонтированный побеждает", async () => {
    function First(): Node {
      Head({ title: "First" });
      return templateHoles("<p>first</p>")().node;
    }
    function Second(): Node {
      Head({ title: "Second" });
      return templateHoles("<p>second</p>")().node;
    }

    await mountPage(First as unknown as AnyComponent);
    await mountPage(Second as unknown as AnyComponent);

    expect(titles()).toEqual(["Second"]);
    expect(document.title).toBe("Second");

    handles.pop()?.dispose();

    expect(titles()).toEqual(["First"]);
    expect(document.title).toBe("First");
  });

  it("дедуплицирует meta по name и восстанавливает предыдущее значение", async () => {
    function First(): Node {
      Head({ meta: [{ name: "description", content: "first" }] });
      return templateHoles("<p>first</p>")().node;
    }
    function Second(): Node {
      Head({ meta: [{ name: "description", content: "second" }] });
      return templateHoles("<p>second</p>")().node;
    }

    await mountPage(First as unknown as AnyComponent);
    await mountPage(Second as unknown as AnyComponent);

    expect(metas("description")).toHaveLength(1);
    expect(metas("description")[0]?.getAttribute("content")).toBe("second");

    handles.pop()?.dispose();

    expect(metas("description")).toHaveLength(1);
    expect(metas("description")[0]?.getAttribute("content")).toBe("first");
  });

  it("дедуплицирует одинаковые link и style", async () => {
    function Page(props: { href: string }): Node {
      Head({
        link: [{ rel: "stylesheet", href: props.href }],
        style: [{ css: ".same{color:red}" }],
      });
      return templateHoles("<p>page</p>")().node;
    }

    await mountPage(Page as unknown as AnyComponent, { href: "/same.css" });
    await mountPage(Page as unknown as AnyComponent, { href: "/same.css" });

    expect(
      document.head.querySelectorAll('link[rel="stylesheet"][href="/same.css"]'),
    ).toHaveLength(1);
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
  });

  it("возвращает заголовок предыдущего Head, когда верхний снял свой", async () => {
    const [base, setBase] = createSignal("A1");
    const [top, setTop] = createSignal<string | null>("B");
    function First(): Node {
      Head({ title: () => base() });
      return templateHoles("<p>first</p>")().node;
    }
    function Second(): Node {
      Head({ title: () => top() });
      return templateHoles("<p>second</p>")().node;
    }

    await mountPage(First as unknown as AnyComponent);
    await mountPage(Second as unknown as AnyComponent);
    expect(document.title).toBe("B");

    setTop(null);
    flushSync();
    expect(document.title).toBe("A1");

    setBase("A2");
    flushSync();
    expect(document.title).toBe("A2");

    setTop("B2");
    flushSync();
    expect(document.title).toBe("B2");
  });

  it("не перетирает title верхнего Head реактивным обновлением нижнего", async () => {
    const [title, setTitle] = createSignal("A1");
    function First(): Node {
      Head({ title: () => title() });
      return templateHoles("<p>first</p>")().node;
    }
    function Second(): Node {
      Head({ title: "B" });
      return templateHoles("<p>second</p>")().node;
    }

    await mountPage(First as unknown as AnyComponent);
    await mountPage(Second as unknown as AnyComponent);

    expect(document.title).toBe("B");

    setTitle("A2");
    flushSync();
    expect(document.title).toBe("B");

    handles.pop()?.dispose();
    expect(document.title).toBe("A2");
  });
});

describe("Head: реактивность", () => {
  it("обновляет title и meta по сигналам", async () => {
    const [title, setTitle] = createSignal("One");
    const [content, setContent] = createSignal("first");
    function Page(): Node {
      Head({
        title: () => title(),
        meta: [{ name: "description", content: () => content() }],
      });
      return templateHoles("<p>body</p>")().node;
    }

    await mountPage(Page as unknown as AnyComponent);

    expect(document.title).toBe("One");
    expect(metas("description")[0]?.getAttribute("content")).toBe("first");

    setTitle("Two");
    setContent("second");
    flushSync();

    expect(document.title).toBe("Two");
    expect(metas("description")[0]?.getAttribute("content")).toBe("second");
  });

  it("снимает title, когда реактивный аксессор вернул null", async () => {
    const [title, setTitle] = createSignal<string | null>("Visible");
    function Page(): Node {
      Head({ title: () => title() });
      return templateHoles("<p>body</p>")().node;
    }

    await mountPage(Page as unknown as AnyComponent);
    expect(document.title).toBe("Visible");

    setTitle(null);
    flushSync();
    expect(titles()).toEqual([]);

    setTitle("Back");
    flushSync();
    expect(document.title).toBe("Back");
  });
});

describe("Head: children", () => {
  it("регистрирует элементы из children и удаляет дубликаты", async () => {
    function Page(): Node {
      const first = document.createElement("meta");
      first.setAttribute("name", "robots");
      first.setAttribute("content", "index");
      const duplicate = document.createElement("meta");
      duplicate.setAttribute("name", "robots");
      duplicate.setAttribute("content", "noindex");
      Head({ children: [first, duplicate] });
      return templateHoles("<p>body</p>")().node;
    }

    await mountPage(Page as unknown as AnyComponent);

    expect(metas("robots")).toHaveLength(1);
    expect(metas("robots")[0]?.getAttribute("content")).toBe("index");
  });
});

describe("Head: гидрация", () => {
  it("адоптирует разметку и регистрирует head без mismatch", async () => {
    function Page(): Node {
      Head({ title: "Hydrated" });
      return templateHoles("<main><h1>Body</h1></main>")().node;
    }

    const target = createHost();
    target.innerHTML = "<main><h1>Body</h1></main>";
    const mismatches: HydrationMismatchError[] = [];
    const handle = await hydrate(target, Page as unknown as AnyComponent, {
      onMismatch: (error) => mismatches.push(error),
    });
    handles.push(handle);

    expect(mismatches).toEqual([]);
    expect(document.title).toBe("Hydrated");
    expect(target.querySelector("h1")?.textContent).toBe("Body");
  });

  it("не дублирует SSR-теги meta, link и style после гидрации", async () => {
    const serverMeta = document.createElement("meta");
    serverMeta.setAttribute("name", "description");
    serverMeta.setAttribute("content", "ssr");
    const serverLink = document.createElement("link");
    serverLink.setAttribute("rel", "stylesheet");
    serverLink.setAttribute("href", "/ssr.css");
    const serverStyle = document.createElement("style");
    serverStyle.setAttribute("id", "ssr-style");
    serverStyle.textContent = ".x{color:red}";
    document.head.append(serverMeta, serverLink, serverStyle);

    function Page(): Node {
      Head({
        meta: [{ name: "description", content: "client" }],
        link: [{ rel: "stylesheet", href: "/ssr.css" }],
        style: [{ id: "ssr-style", css: ".x{color:red}" }],
      });
      return templateHoles("<main><h1>Body</h1></main>")().node;
    }

    const target = createHost();
    target.innerHTML = "<main><h1>Body</h1></main>";
    const handle = await hydrate(target, Page as unknown as AnyComponent, {
      onMismatch: () => {},
    });
    handles.push(handle);

    expect(metas("description")).toHaveLength(1);
    expect(metas("description")[0]?.getAttribute("content")).toBe("client");
    expect(
      document.head.querySelectorAll('link[rel="stylesheet"][href="/ssr.css"]'),
    ).toHaveLength(1);
    expect(document.head.querySelectorAll("style#ssr-style")).toHaveLength(1);
  });
});

describe("Head: безопасность имён атрибутов", () => {
  it("не пропускает breakout и on*-атрибуты из meta", async () => {
    function Page(): Node {
      Head({
        title: "safe",
        meta: [
          {
            name: "description",
            content: "ok",
            "x><script>alert(1)</script><meta y": "z",
            onload: "alert(2)",
          },
        ],
      });
      return templateHoles("<main>x</main>")().node;
    }

    await mountPage(Page as unknown as AnyComponent);

    expect(document.head.querySelector("script")).toBeNull();
    expect(document.head.innerHTML).not.toContain("alert(");
    expect(metas("description")[0]?.getAttribute("content")).toBe("ok");
    expect(document.head.querySelector("meta")?.hasAttribute("onload")).toBe(false);
  });

  it("сохраняет валидные data-*, aria-* и namespace-атрибуты", async () => {
    function Page(): Node {
      Head({
        meta: [
          {
            name: "x",
            content: "y",
            "data-custom": "1",
            "aria-label": "label",
            "xml:lang": "ru",
          },
        ],
      });
      return templateHoles("<main>x</main>")().node;
    }

    await mountPage(Page as unknown as AnyComponent);

    const meta = document.head.querySelector('meta[name="x"]');
    expect(meta?.getAttribute("data-custom")).toBe("1");
    expect(meta?.getAttribute("aria-label")).toBe("label");
    expect(meta?.getAttribute("xml:lang")).toBe("ru");
  });

  it("нормализует camelCase и namespace-атрибуты, отбрасывает события", async () => {
    function Page(): Node {
      Head({
        meta: [
          {
            name: "camel",
            content: "y",
            xlinkHref: "#icon",
            "aria-Label": "label",
            "aria-Description": "desc",
            onClick: "alert(1)",
          },
        ],
      });
      return templateHoles("<main>x</main>")().node;
    }

    await mountPage(Page as unknown as AnyComponent);

    const meta = document.head.querySelector('meta[name="camel"]');
    expect(meta?.getAttribute("xlink:href")).toBe("#icon");
    expect(meta?.getAttribute("aria-label")).toBe("label");
    expect(meta?.getAttribute("aria-description")).toBe("desc");
    expect(meta?.hasAttribute("xlink-href")).toBe(false);
    expect(meta?.hasAttribute("aria--label")).toBe(false);
    expect(meta?.hasAttribute("onclick")).toBe(false);
    expect(meta?.hasAttribute("on-click")).toBe(false);
  });
});
