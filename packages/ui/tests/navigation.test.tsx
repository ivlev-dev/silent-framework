import { afterEach, describe, expect, it } from "vitest";
import {
  createComponent,
  createRoot,
  flushSync,
  hydrate,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { Breadcrumbs, BreadcrumbItem, type BreadcrumbItemData } from "../src/components/breadcrumbs/index.js";
import { Drawer } from "../src/components/drawer/index.js";
import { NavigationBar, type NavigationBarItemData } from "../src/components/navigation-bar/index.js";
import { NavigationRail, type NavigationRailItemData } from "../src/components/navigation-rail/index.js";
import { Pagination, paginationRange } from "../src/components/pagination/index.js";
import { Tabs, type TabItem } from "../src/components/tabs/index.js";
import { TopAppBar } from "../src/components/top-app-bar/index.js";
import { SearchIcon } from "../src/icons/search.js";

interface Handle {
  readonly node: Node;
  update(props: Record<string, unknown>): void;
  dispose(): void;
}

const handles: Handle[] = [];

function mount(component: AnyComponent, props: Record<string, unknown> = {}): Handle {
  let result: ReturnType<typeof createComponent> | null = null;
  const disposeRoot = createRoot((dispose) => {
    result = createComponent(component, props);
    return dispose;
  });
  const created = result as unknown as ReturnType<typeof createComponent>;
  document.body.appendChild(created.node);
  flushSync();
  const handle: Handle = {
    get node() {
      return created.node;
    },
    update: (next) => {
      created.update(next);
    },
    dispose: () => {
      created.dispose();
      disposeRoot();
    },
  };
  handles.push(handle);
  return handle;
}

function rootOf(handle: Handle): Element {
  const node = handle.node;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  throw new Error(`ожидался элемент, получен nodeType=${node.nodeType}`);
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flushSync();
}

function keydown(element: Element, key: string): void {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

function tabItems(): readonly TabItem[] {
  return [
    {
      key: "overview",
      label: "Обзор",
      content: () => <span data-panel="overview">Содержимое обзора</span>,
    },
    {
      key: "details",
      label: "Детали",
      content: () => <span data-panel="details">Содержимое деталей</span>,
    },
    {
      key: "settings",
      label: "Настройки",
      content: () => <span data-panel="settings">Содержимое настроек</span>,
      disabled: true,
    },
  ];
}

function barItems(): readonly NavigationBarItemData[] {
  return [
    { key: "home", label: "Главная", icon: () => <span data-icon="home" /> },
    {
      key: "search",
      label: "Поиск",
      icon: () => <SearchIcon />,
      badge: "3",
      badgeLabel: "3 новых",
    },
    { key: "profile", label: "Профиль", href: "/profile" },
    { key: "off", label: "Выключено", disabled: true },
  ];
}

function railItems(): readonly NavigationRailItemData[] {
  return [
    { key: "inbox", label: "Входящие", icon: () => <span data-icon="inbox" />, badge: "7" },
    { key: "archive", label: "Архив", icon: () => <span data-icon="archive" /> },
    { key: "settings", label: "Настройки", href: "/settings" },
  ];
}

const crumbs: readonly BreadcrumbItemData[] = [
  { key: "home", label: "Главная", href: "/" },
  { key: "docs", label: "Документы", href: "/docs" },
  { key: "file", label: "Инструкция" },
];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
});

describe("Tabs", () => {
  it("рендерит tablist/tab/tabpanel и связывает aria-атрибуты", () => {
    const root = rootOf(mount(Tabs, { items: tabItems(), defaultValue: "overview" }));
    const list = root.querySelector('[role="tablist"]');
    const tabs = root.querySelectorAll('[role="tab"]');
    const selected = root.querySelector('[role="tab"][aria-selected="true"]');
    const panel = root.querySelector('[role="tabpanel"][data-active]');

    expect(list).not.toBeNull();
    expect(tabs).toHaveLength(3);
    expect(selected?.textContent).toContain("Обзор");
    expect(selected?.getAttribute("tabindex")).toBe("0");
    expect(tabs[1]?.getAttribute("tabindex")).toBe("-1");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("id")).toBe(selected?.getAttribute("aria-controls"));
    expect(panel?.getAttribute("aria-labelledby")).toBe(selected?.getAttribute("id"));
    expect(panel?.textContent).toContain("Содержимое обзора");
  });

  it("ленивая панель: содержимое неактивных вкладок не монтируется", () => {
    const root = rootOf(mount(Tabs, { items: tabItems(), defaultValue: "overview" }));
    expect(root.querySelector('[data-panel="overview"]')).not.toBeNull();
    expect(root.querySelector('[data-panel="details"]')).toBeNull();
    expect(root.querySelector('[data-panel="settings"]')).toBeNull();
  });

  it("Arrow/Home/End перемещают фокус и активируют вкладку, пропуская disabled", () => {
    const root = rootOf(mount(Tabs, { items: tabItems(), defaultValue: "overview" }));
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
    const first = tabs[0] as HTMLElement;
    first.focus();

    keydown(first, "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector('[data-panel="details"]')).not.toBeNull();

    keydown(tabs[1] as HTMLElement, "End");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");

    keydown(tabs[1] as HTMLElement, "Home");
    expect(document.activeElement).toBe(tabs[0]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("размер задаёт data-size, а переполнение — data-overflow для fade", () => {
    const root = rootOf(
      mount(Tabs, { items: tabItems(), defaultValue: "overview", size: "sm" }),
    );
    expect(root.getAttribute("data-size")).toBe("sm");
    const list = root.querySelector('[role="tablist"]') as HTMLElement;
    expect(list).not.toBeNull();

    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 600 });
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(list, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });

    list.dispatchEvent(new Event("scroll"));
    flushSync();
    expect(list.getAttribute("data-overflow")).toBe("end");

    list.scrollLeft = 150;
    list.dispatchEvent(new Event("scroll"));
    flushSync();
    expect(list.getAttribute("data-overflow")).toBe("both");

    list.scrollLeft = 300;
    list.dispatchEvent(new Event("scroll"));
    flushSync();
    expect(list.getAttribute("data-overflow")).toBe("start");

    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 300 });
    list.dispatchEvent(new Event("scroll"));
    flushSync();
    expect(list.hasAttribute("data-overflow")).toBe(false);
  });

  it("вертикальные вкладки используют ArrowDown/ArrowUp", () => {    const root = rootOf(
      mount(Tabs, { items: tabItems(), defaultValue: "overview", orientation: "vertical" }),
    );
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
    tabs[0]?.focus();

    keydown(tabs[0] as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(tabs[1]);
    keydown(tabs[1] as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("controlled value: клик только сообщает, DOM меняется после обновления props", () => {
    const calls: string[] = [];
    const items = tabItems();
    const onValueChange = (value: string): void => {
      calls.push(value);
    };
    const handle = mount(Tabs, {
      items,
      value: "overview",
      onValueChange,
    });
    const root = rootOf(handle);
    const details = root.querySelectorAll('[role="tab"]')[1] as HTMLElement;

    click(details);
    expect(calls).toEqual(["details"]);
    expect(
      root.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("Обзор");

    handle.update({ items, value: "details", onValueChange });
    flushSync();
    expect(
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("Детали");
    expect(document.querySelector('[data-panel="details"]')).not.toBeNull();
  });
});

describe("TopAppBar", () => {
  it("small/medium/large, слоты, заголовок и scroll elevation", () => {
    const bar = rootOf(
      mount(TopAppBar, {
        title: "Проект",
        titleLevel: 2,
        variant: "large",
        leading: <button data-testid="nav">Меню</button>,
        actions: <button data-testid="action">Поиск</button>,
        elevated: true,
        sticky: true,
      }),
    );
    expect(bar.tagName).toBe("HEADER");
    expect(bar.getAttribute("data-variant")).toBe("large");
    expect(bar.hasAttribute("data-elevated")).toBe(true);
    expect(bar.hasAttribute("data-sticky")).toBe(true);
    expect(bar.hasAttribute("data-safe-area")).toBe(true);
    expect(bar.querySelector('[data-testid="nav"]')).not.toBeNull();
    expect(bar.querySelector('[data-testid="action"]')).not.toBeNull();
    const actions = bar.querySelector(".sui-top-app-bar__actions");
    expect(actions?.getAttribute("role")).toBe("group");
    expect(actions?.getAttribute("aria-label")).toBe("Действия");
    expect(actions?.getAttribute("tabindex")).toBe("0");
    const heading = bar.querySelector('[role="heading"]');
    expect(heading?.textContent).toBe("Проект");
    expect(heading?.getAttribute("aria-level")).toBe("2");
  });

  it("safeArea=false убирает отступ под вырез", () => {
    const bar = rootOf(mount(TopAppBar, { title: "x", safeArea: false }));
    expect(bar.hasAttribute("data-safe-area")).toBe(false);
  });
});

describe("NavigationBar", () => {
  it("aria-current, подписи, бейдж и выбранный пункт", () => {
    const nav = rootOf(mount(NavigationBar, { items: barItems(), value: "home" }));
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("Основная навигация");
    expect(nav.querySelectorAll("li")).toHaveLength(4);
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain("Главная");
    expect(nav.textContent).toContain("Поиск");
    expect(nav.textContent).toContain("Профиль");
    expect(nav.querySelector(".sui-navigation-bar__badge")?.textContent).toBe("3");
    expect(nav.querySelector('a[href="/profile"]')).not.toBeNull();
  });

  it("клик сообщает ключ; disabled не вызывает обработчик", () => {
    const calls: string[] = [];
    const nav = rootOf(
      mount(NavigationBar, {
        items: barItems(),
        onValueChange: (value: string) => calls.push(value),
      }),
    );
    const buttons = Array.from(nav.querySelectorAll("button"));
    click(buttons[1] as Element);
    expect(calls).toEqual(["search"]);
    click(buttons[buttons.length - 1] as Element);
    expect(calls).toEqual(["search"]);
  });
});

describe("NavigationRail", () => {
  it("expanded, FAB, aria-current и подписи в DOM", () => {
    const rail = rootOf(
      mount(NavigationRail, {
        items: railItems(),
        value: "inbox",
        expanded: true,
        fab: <button data-testid="compose">Создать</button>,
      }),
    );
    expect(rail.tagName).toBe("NAV");
    expect(rail.hasAttribute("data-expanded")).toBe(true);
    expect(rail.querySelector('[data-testid="compose"]')).not.toBeNull();
    expect(rail.textContent).toContain("Входящие");
    expect(rail.textContent).toContain("Архив");
    const current = rail.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain("Входящие");
    expect(rail.querySelector(".sui-navigation-rail__badge")?.textContent).toBe("7");
  });

  it("по умолчанию свёрнут и сообщает выбранный ключ", () => {
    const calls: string[] = [];
    const rail = rootOf(
      mount(NavigationRail, {
        items: railItems(),
        onValueChange: (value: string) => calls.push(value),
      }),
    );
    expect(rail.hasAttribute("data-expanded")).toBe(false);
    click(rail.querySelectorAll("button")[1] as Element);
    expect(calls).toEqual(["archive"]);
  });
});

describe("Drawer", () => {
  it("modal: dialog, aria-modal, скрим, header/footer и Escape", () => {
    const changes: boolean[] = [];
    const drawer = rootOf(
      mount(Drawer, {
        open: true,
        header: "Меню",
        footer: <button data-testid="save">Сохранить</button>,
        showCloseButton: true,
        onOpenChange: (open: boolean) => changes.push(open),
        children: <p>Содержимое</p>,
      }),
    );
    flushSync();
    const panel = drawer.querySelector("aside");
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    expect(panel?.getAttribute("aria-labelledby")).not.toBeNull();
    expect(drawer.querySelector(".sui-drawer__scrim")).not.toBeNull();
    expect(panel?.textContent).toContain("Меню");
    expect(panel?.textContent).toContain("Содержимое");
    expect(drawer.querySelector(".sui-drawer__content")?.getAttribute("tabindex")).toBe("0");
    expect(drawer.querySelector('[data-testid="save"]')).not.toBeNull();

    keydown(panel as Element, "Escape");
    expect(changes).toEqual([false]);

    click(drawer.querySelector(".sui-drawer__scrim") as Element);
    expect(changes).toEqual([false, false]);
  });

  it("standard: без scrim и aria-modal, панель inline", () => {
    const drawer = rootOf(
      mount(Drawer, { open: true, variant: "standard", header: "Навигация", children: "x" }),
    );
    const panel = drawer.querySelector("aside");
    expect(drawer.getAttribute("data-variant")).toBe("standard");
    expect(drawer.querySelector(".sui-drawer__scrim")).toBeNull();
    expect(panel?.hasAttribute("aria-modal")).toBe(false);
    expect(panel?.hasAttribute("hidden")).toBe(false);
  });

  it("modal: inert/aria-hidden фона и блокировка прокрутки body со снятием", () => {
    const sibling = document.createElement("div");
    sibling.setAttribute("data-testid", "page");
    document.body.appendChild(sibling);

    const base = { open: true, header: "Меню", children: "x" };
    const handle = mount(Drawer, base);
    const drawer = rootOf(handle);

    expect(drawer.hasAttribute("inert")).toBe(false);
    expect(sibling.hasAttribute("inert")).toBe(true);
    expect(sibling.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    handle.update({ ...base, open: false });
    flushSync();

    expect(sibling.hasAttribute("inert")).toBe(false);
    expect(sibling.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(drawer.hasAttribute("inert")).toBe(false);
  });

  it("standard: не блокирует фон и прокрутку body", () => {
    const sibling = document.createElement("div");
    document.body.appendChild(sibling);

    mount(Drawer, { open: true, variant: "standard", header: "Навигация", children: "x" });

    expect(sibling.hasAttribute("inert")).toBe(false);
    expect(sibling.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("закрытая панель скрыта, открытие/закрытие возвращает фокус триггеру", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Открыть";
    document.body.appendChild(trigger);
    trigger.focus();

    const base = {
      open: false,
      header: "Меню",
      showCloseButton: true,
      onOpenChange: () => undefined,
      children: "x",
    };
    const handle = mount(Drawer, base);
    flushSync();
    const panel = rootOf(handle).querySelector("aside");
    expect(panel?.hasAttribute("hidden")).toBe(true);

    handle.update({ ...base, open: true });
    flushSync();
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(panel?.contains(document.activeElement)).toBe(true);

    handle.update({ ...base, open: false });
    flushSync();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Breadcrumbs", () => {
  it("nav с aria-label, разделители и aria-current у последнего пункта", () => {
    const nav = rootOf(mount(Breadcrumbs, { items: crumbs }));
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("Хлебные крошки");
    expect(nav.querySelectorAll("li")).toHaveLength(3);
    expect(nav.querySelectorAll("a")).toHaveLength(2);
    expect(nav.querySelectorAll(".sui-breadcrumbs__separator")).toHaveLength(2);
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain("Инструкция");
  });

  it("maxItems сворачивает середину в многоточие без измерений", () => {
    const many: readonly BreadcrumbItemData[] = [
      { key: "a", label: "Главная", href: "/" },
      { key: "b", label: "Раздел 1", href: "/1" },
      { key: "c", label: "Раздел 2", href: "/2" },
      { key: "d", label: "Раздел 3", href: "/3" },
      { key: "e", label: "Файл" },
    ];
    const nav = rootOf(mount(Breadcrumbs, { items: many, maxItems: 3 }));
    expect(nav.querySelectorAll("li")).toHaveLength(3);
    expect(nav.querySelectorAll('[data-ellipsis]')).toHaveLength(1);
    expect(nav.textContent).toContain("Главная");
    expect(nav.textContent).toContain("Файл");
    expect(nav.textContent).not.toContain("Раздел 1");
  });

  it("кастомный разделитель и ARIA-текущая страница у BreadcrumbItem", () => {
    const nav = rootOf(
      mount(Breadcrumbs, { items: crumbs, separator: "›", label: "Путь" }),
    );
    expect(nav.getAttribute("aria-label")).toBe("Путь");
    expect(nav.querySelectorAll(".sui-breadcrumbs__separator")[0]?.textContent).toBe("›");

    const item = rootOf(mount(BreadcrumbItem, { current: true, children: "Страница" }));
    expect(item.textContent).toBe("Страница");
    expect(item.querySelector('[aria-current="page"]')).not.toBeNull();
  });
});

describe("Pagination", () => {
  it("границы: prev/next отключаются, onChange получает соседнюю страницу", () => {
    const calls: number[] = [];
    const nav = rootOf(
      mount(Pagination, {
        page: 1,
        pageCount: 5,
        onChange: (page: number) => calls.push(page),
      }),
    );
    const previous = nav.querySelector('[data-direction="previous"]') as HTMLButtonElement;
    const next = nav.querySelector('[data-direction="next"]') as HTMLButtonElement;
    expect(nav.getAttribute("aria-label")).toBe("Постраничная навигация");
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    expect(previous.getAttribute("aria-label")).toBe("Назад");
    expect(next.getAttribute("aria-label")).toBe("Вперёд");

    click(next);
    expect(calls).toEqual([2]);
    click(nav.querySelectorAll(".sui-pagination__page")[3] as Element);
    expect(calls).toEqual([2, 4]);
  });

  it("последняя страница: next disabled, клик не меняет страницу", () => {
    const calls: number[] = [];
    const nav = rootOf(
      mount(Pagination, {
        page: 5,
        pageCount: 5,
        onChange: (page: number) => calls.push(page),
      }),
    );
    const next = nav.querySelector('[data-direction="next"]') as HTMLButtonElement;
    const previous = nav.querySelector('[data-direction="previous"]') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(previous.disabled).toBe(false);
    click(next);
    expect(calls).toEqual([]);
  });

  it("aria-current и RU-подпись текущей страницы", () => {
    const nav = rootOf(mount(Pagination, { page: 3, pageCount: 5 }));
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe("3");
    expect(current?.getAttribute("aria-label")).toBe("Страница 3 из 5");
    expect(nav.querySelector(".sui-pagination__status")?.textContent).toBe(
      "Страница 3 из 5",
    );
  });

  it("диапазон страниц и многоточия", () => {
    expect(paginationRange(1, 20, 1)).toEqual([
      1, 2, 3, 4, 5, "ellipsis-end", 20,
    ]);
    expect(paginationRange(10, 20, 1)).toEqual([
      1, "ellipsis-start", 9, 10, 11, "ellipsis-end", 20,
    ]);
    expect(paginationRange(20, 20, 1)).toEqual([
      1, "ellipsis-start", 16, 17, 18, 19, 20,
    ]);

    const nav = rootOf(mount(Pagination, { page: 10, pageCount: 20 }));
    expect(nav.querySelectorAll("[data-ellipsis]")).toHaveLength(2);
    expect(nav.textContent).toContain("20");
  });

  it("disabled блокирует все кнопки", () => {
    const nav = rootOf(mount(Pagination, { page: 2, pageCount: 4, disabled: true }));
    for (const button of nav.querySelectorAll("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });
});

function NavigationDemo(): Node {
  return (
    <div>
      <TopAppBar title="Приложение" />
      <Breadcrumbs items={crumbs} />
      <Tabs items={tabItems()} defaultValue="details" label="Разделы" />
      <Pagination page={2} pageCount={10} />
      <NavigationBar items={barItems()} defaultValue="home" />
      <NavigationRail items={railItems()} expanded />
      <Drawer open header="Меню">
        <p>Содержимое меню</p>
      </Drawer>
    </div>
  );
}

describe("SSR и гидрация навигации", () => {
  it("Tabs: активная панель и tablist попадают в SSR, неактивные — нет", async () => {
    function App(): Node {
      return <Tabs items={tabItems()} defaultValue="details" label="Разделы" />;
    }
    const { html } = await renderToString(App);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('data-panel="details"');
    expect(html).not.toContain('data-panel="overview"');
    expect(html).not.toContain("jsx(");
  });

  it("Drawer в SSR рендерится inline с dialog/aria-modal", async () => {
    function App(): Node {
      return (
        <Drawer open header="Меню" footer="Подвал">
          <p>Пункт</p>
        </Drawer>
      );
    }
    const { html } = await renderToString(App);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Меню");
    expect(html).toContain("Пункт");
  });

  it("композитная навигация гидрируется без mismatch", async () => {
    const { html } = await renderToString(NavigationDemo);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, NavigationDemo, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    flushSync();

    expect(mismatches).toEqual([]);
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('[aria-current="page"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("Страница 2 из 10");
    handle.dispose();
  });
});
