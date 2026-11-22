import { afterEach, describe, expect, it } from "vitest";
import { expectTypeOf } from "vitest";
import { setServerMode } from "@ivlev-dev/silent-core";
import {
  Route,
  Router,
  RouterView,
  createMemoryHistory,
  type RouteInput,
  type RouteViewProps,
} from "../src/index";
import { buildQuery, parseQuery } from "../src/match";
import { leaf, render, type Rendered } from "./support";

const routers: Router[] = [];
const rendered: Rendered[] = [];

function createRouter(routes: readonly RouteInput[], initial = "/"): Router {
  const router = new Router({ routes, history: createMemoryHistory(initial) });
  routers.push(router);
  return router;
}

function mount(factory: () => Node): Rendered {
  const result = render(factory);
  rendered.push(result);
  return result;
}

afterEach(() => {
  while (rendered.length > 0) {
    rendered.pop()?.dispose();
  }
  while (routers.length > 0) {
    routers.pop()?.dispose();
  }
  setServerMode(false);
  document.body.replaceChildren();
});

type EditQuery = {
  page: number;
  active: boolean;
  tags: string[];
};

function editView(props: RouteViewProps<"/edit-{id}", EditQuery>): HTMLElement {
  const element = document.createElement("section");
  element.dataset.view = "edit";
  element.dataset.page = String(props.query.page);
  element.dataset.active = String(props.query.active);
  element.dataset.tags = props.query.tags.join(",");
  element.dataset.id = props.params.id;
  return element;
}

class EditRoute extends Route<"/edit-{id}", EditQuery> {
  readonly path = "/edit-{id}";
  readonly name = "edit";
  readonly component = editView;
  readonly query = {
    page: "number",
    active: "boolean",
    tags: "string[]",
  } as const;
}

class CustomRoute extends Route<"/custom", { slug: string }> {
  readonly path = "/custom";
  readonly name = "custom";
  readonly component = leaf("custom");
  readonly query = {
    slug: (raw: string | string[] | undefined): string | undefined => {
      if (typeof raw === "string") {
        return raw.toUpperCase();
      }
      if (Array.isArray(raw)) {
        return raw[raw.length - 1]?.toUpperCase();
      }
      return undefined;
    },
  };
}

const routes: readonly RouteInput[] = [
  { path: "/", name: "home", component: leaf("home") },
  EditRoute,
  CustomRoute,
  {
    path: "/plain",
    name: "plain",
    component: leaf("plain"),
    query: { page: "number", active: "boolean", tags: "string[]" },
  },
];

describe("runtime-схема query", () => {
  it("типизирует query в RouteViewProps", () => {
    expectTypeOf<RouteViewProps<"/edit-{id}", EditQuery>["query"]>()
      .toEqualTypeOf<EditQuery>();
  });

  it("приводит числа, boolean и массивы по схеме route-класса", async () => {
    const router = createRouter(routes, "/edit-7?page=2&active=true&tags=a&tags=b");
    await router.start();
    expect(router.query).toEqual({ page: 2, active: true, tags: ["a", "b"] });
    expect(router.route?.query).toEqual({ page: 2, active: true, tags: ["a", "b"] });
  });

  it("применяет схему object-route и отдаёт значения в RouterView", async () => {
    const router = createRouter(routes, "/plain?page=3&active=false&tags=x&tags=y");
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    expect(host.querySelector("[data-view=plain]")).not.toBeNull();
    const state = router.state();
    expect(state.query).toEqual({ page: 3, active: false, tags: ["x", "y"] });
    expect(router.query).toEqual({ page: 3, active: false, tags: ["x", "y"] });
  });

  it("рендерит распарсенный query в route-компоненте", async () => {
    const router = createRouter(routes, "/edit-4?page=9&active=true&tags=one&tags=two");
    await router.start();
    const { host } = mount(() => RouterView({ router }));
    const view = host.querySelector("[data-view=edit]");
    expect(view?.getAttribute("data-page")).toBe("9");
    expect(view?.getAttribute("data-active")).toBe("true");
    expect(view?.getAttribute("data-tags")).toBe("one,two");
    expect(view?.getAttribute("data-id")).toBe("4");
  });

  it("пропускает невалидные number и boolean и отсутствующие ключи", async () => {
    const router = createRouter(routes, "/edit-8?page=abc&active=maybe");
    await router.start();
    expect(router.query).toEqual({});
    expect(router.query["page"]).toBeUndefined();
    expect(router.query["active"]).toBeUndefined();
  });

  it("поддерживает function-parser", async () => {
    const router = createRouter(routes, "/custom?slug=hello");
    await router.start();
    expect(router.query).toEqual({ slug: "HELLO" });
    expect(router.route?.fullPath).toBe("/custom?slug=hello");
  });

  it("объединяет схемы вложенных маршрутов от корня к листу", async () => {
    const nested: readonly RouteInput[] = [
      {
        path: "/parent",
        name: "parent",
        component: leaf("parent"),
        query: { page: "number", active: "boolean" },
        children: [
          {
            path: "child",
            name: "nested-child",
            component: leaf("nested-child"),
            query: { active: "boolean" },
          },
        ],
      },
    ];
    const router = createRouter(nested, "/parent/child?page=4&active=true");
    await router.start();
    expect(router.query).toEqual({ page: 4, active: true });
    expect(router.route?.name).toBe("nested-child");
  });

  it("сохраняет ключи __proto__ и constructor как данные", () => {
    const query = parseQuery("?__proto__=value&constructor=first&constructor=second");
    expect(Object.getPrototypeOf(query)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(query, "__proto__")).toBe(true);
    expect(query["__proto__"]).toBe("value");
    expect(Object.prototype.hasOwnProperty.call(query, "constructor")).toBe(true);
    expect(query["constructor"]).toEqual(["first", "second"]);
  });

  it("сериализует числа, boolean и массивы и переживает roundtrip", () => {
    const query = {
      page: 2,
      active: false,
      tags: ["a", "b"],
      ratio: 1.5,
      enabled: true,
    };
    expect(buildQuery(query)).toBe(
      "?page=2&active=false&tags=a&tags=b&ratio=1.5&enabled=true",
    );
    expect(parseQuery(buildQuery(query))).toEqual({
      page: "2",
      active: "false",
      tags: ["a", "b"],
      ratio: "1.5",
      enabled: "true",
    });
  });

  it("строит URL из типизированного query и парсит его обратно", () => {
    const router = createRouter(routes);
    const location = router.resolve({
      name: "edit",
      params: { id: 7 },
      query: { page: 2, active: false, tags: ["a", "b"] },
    });
    expect(location.fullPath).toBe("/edit-7?page=2&active=false&tags=a&tags=b");
    expect(location.query).toEqual({ page: 2, active: false, tags: ["a", "b"] });
  });

  it("работает на SSR с MemoryHistory", async () => {
    setServerMode(true);
    const router = createRouter(routes, "/edit-5?page=6&active=false&tags=ssr");
    await router.start();
    const host = document.createElement("div");
    host.appendChild(RouterView({ router }));
    const view = host.querySelector("[data-view=edit]");
    expect(view?.getAttribute("data-page")).toBe("6");
    expect(view?.getAttribute("data-active")).toBe("false");
    expect(view?.getAttribute("data-tags")).toBe("ssr");
    expect(router.query).toEqual({ page: 6, active: false, tags: ["ssr"] });
  });
});
