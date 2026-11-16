import { afterEach, describe, expect, it } from "vitest";
import { expectTypeOf } from "vitest";
import {
  Router,
  createMemoryHistory,
  type PathParams,
  type RouteRecord,
} from "../src/index";
import { leaf } from "./support";

const routers: Router[] = [];

function createRouter(routes: readonly RouteRecord[]): Router {
  const router = new Router({ routes, history: createMemoryHistory("/") });
  routers.push(router);
  return router;
}

afterEach(() => {
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  document.body.replaceChildren();
});

const routes: readonly RouteRecord[] = [
  { path: "/", name: "home", component: leaf("home") },
  { path: "/edit-{id}", name: "edit", component: leaf("edit") },
  { path: "/edit-{id}-{tab}", name: "edit-tab", component: leaf("edit-tab") },
  { path: "/v{version}.{ext}", name: "versioned", component: leaf("versioned") },
  { path: "/prefix-{id}", name: "prefixed", component: leaf("prefixed") },
  { path: "/legacy-:id", name: "legacy-prefixed", component: leaf("legacy-prefixed") },
  { path: "/prefix-static", name: "prefix-static", component: leaf("prefix-static") },
  { path: "/files/*", name: "files", component: leaf("files") },
  { path: "/:slug", name: "slug", component: leaf("slug") },
];

describe("mixed-сегменты", () => {
  it("выводит параметры из mixed-сегментов", () => {
    expectTypeOf<PathParams<"/edit-{id}">>().toEqualTypeOf<{
      readonly id: string;
    }>();
    expectTypeOf<PathParams<"/edit-{id}-{tab}">>().toEqualTypeOf<{
      readonly id: string;
      readonly tab: string;
    }>();
    expectTypeOf<PathParams<"/v{version}.{ext}">>().toEqualTypeOf<{
      readonly version: string;
      readonly ext: string;
    }>();
    expectTypeOf<PathParams<"/edit-:id-:tab">>().toEqualTypeOf<{
      readonly id: string;
      readonly tab: string;
    }>();
  });

  it("сопоставляет prefix, несколько параметров и расширение", () => {
    const router = createRouter(routes);
    expect(router.resolve("/prefix-42").params).toEqual({ id: "42" });
    expect(router.resolve("/legacy-42").params).toEqual({ id: "42" });
    expect(router.resolve("/edit-42").params).toEqual({ id: "42" });
    expect(router.resolve("/edit-42-settings").params).toEqual({
      id: "42",
      tab: "settings",
    });
    expect(router.resolve("/v1.2.tar").params).toEqual({
      version: "1.2",
      ext: "tar",
    });
  });

  it("декодирует и кодирует параметры mixed-сегмента", () => {
    const router = createRouter(routes);
    const decoded = router.resolve("/prefix-%D0%BC%D0%B8%D1%80");
    expect(decoded.name).toBe("prefixed");
    expect(decoded.params).toEqual({ id: "мир" });

    const encoded = router.resolve({ name: "prefixed", params: { id: "мир" } });
    expect(encoded.path).toBe("/prefix-%D0%BC%D0%B8%D1%80");

    const versioned = router.resolve({
      name: "versioned",
      params: { version: "1.2", ext: "tar" },
    });
    expect(versioned.path).toBe("/v1.2.tar");

    const edited = router.resolve({
      name: "edit-tab",
      params: { id: 42, tab: "settings" },
    });
    expect(edited.path).toBe("/edit-42-settings");
  });

  it("оставляет последнее значение при дублирующихся параметрах", () => {
    const router = createRouter([
      { path: "/dup-{id}-{id}", name: "dup", component: leaf("dup") },
    ]);
    expect(router.resolve("/dup-first-second").params).toEqual({ id: "second" });
  });

  it("ставит mixed между static и чистым param", () => {
    const router = createRouter(routes);
    expect(router.resolve("/prefix-static").name).toBe("prefix-static");
    expect(router.resolve("/prefix-value").name).toBe("prefixed");
    expect(router.resolve("/other").name).toBe("slug");
  });

  it("не смешивает wildcard с mixed-сегментом", () => {
    const router = createRouter(routes);
    expect(router.resolve("/files/a/b.txt").params).toEqual({ "*": "a/b.txt" });
  });
});
