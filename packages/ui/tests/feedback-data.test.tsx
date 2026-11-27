import { afterEach, describe, expect, it } from "vitest";
import { For, createComponent, flushSync, hydrate, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Alert, type AlertVariant } from "../src/components/alert/index.js";
import { Progress } from "../src/components/progress/index.js";
import { Badge, type BadgeVariant } from "../src/components/badge/index.js";
import { Skeleton } from "../src/components/skeleton/index.js";
import { Card, type CardVariant } from "../src/components/card/index.js";
import { List, ListItem } from "../src/components/list/index.js";
import { Avatar } from "../src/components/avatar/index.js";

interface Handle {
  readonly node: Node;
  update(props: Record<string, unknown>): void;
  dispose(): void;
}

const handles: Handle[] = [];

function mount(component: AnyComponent, props: Record<string, unknown> = {}): Handle {
  const result = createComponent(component, props);
  document.body.appendChild(result.node);
  handles.push(result);
  return result;
}

function rootOf(handle: Handle): Element {
  const node = handle.node;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  throw new Error(`ожидался элемент, получен nodeType=${node.nodeType}`);
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function press(element: Element, key: string): void {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
});

const here = dirname(fileURLToPath(import.meta.url));

function readCss(relative: string): string {
  return readFileSync(join(here, "..", "src", "components", relative), "utf8");
}

describe("Alert", () => {
  it.each(["info", "success", "warning", "error"] as const)(
    "вариант %s: data-variant и роль объявления",
    (variant: AlertVariant) => {
      const alert = rootOf(mount(Alert, { variant, children: "Текст" }));
      expect(alert.className).toBe("sui-alert");
      expect(alert.getAttribute("data-variant")).toBe(variant);
      expect(alert.getAttribute("role")).toBe(
        variant === "warning" || variant === "error" ? "alert" : "status",
      );
    },
  );

  it("renders title, message, icon and actions", () => {
    const alert = rootOf(
      mount(Alert, {
        title: "Заголовок",
        icon: <span data-testid="glyph" />,
        actions: <button type="button">Повторить</button>,
        children: "Сообщение",
      }),
    );
    expect(alert.querySelector(".sui-alert__title")?.textContent).toBe("Заголовок");
    expect(alert.querySelector(".sui-alert__message")?.textContent).toBe("Сообщение");
    expect(alert.querySelector("[data-testid='glyph']")).not.toBeNull();
    expect(alert.querySelector(".sui-alert__actions button")?.textContent).toBe("Повторить");
  });

  it("иконка по умолчанию есть у каждого варианта, icon=null её убирает", () => {
    for (const variant of ["info", "success", "warning", "error"] as const) {
      const alert = rootOf(mount(Alert, { variant, children: "x" }));
      expect(alert.querySelector(".sui-alert__icon svg"), variant).not.toBeNull();
    }
    const bare = rootOf(mount(Alert, { variant: "info", icon: null, children: "x" }));
    expect(bare.querySelector(".sui-alert__icon svg")).toBeNull();
  });

  it("dismissible: RU-подпись, onClose и переопределение строки", () => {
    let closed = 0;
    const alert = rootOf(
      mount(Alert, {
        dismissible: true,
        children: "x",
        onClose: () => {
          closed += 1;
        },
      }),
    );
    expect(alert.hasAttribute("data-dismissible")).toBe(true);
    const close = alert.querySelector(".sui-alert__close");
    expect(close?.getAttribute("aria-label")).toBe("Закрыть");
    click(close as Element);
    expect(closed).toBe(1);

    const custom = rootOf(
      mount(Alert, { dismissible: true, closeLabel: "Dismiss", children: "x" }),
    );
    expect(custom.querySelector(".sui-alert__close")?.getAttribute("aria-label")).toBe("Dismiss");
  });

  it("без dismissible кнопки закрытия нет", () => {
    const alert = rootOf(mount(Alert, { children: "x" }));
    expect(alert.querySelector(".sui-alert__close")).toBeNull();
    expect(alert.hasAttribute("data-dismissible")).toBe(false);
  });

  it("role можно переопределить", () => {
    expect(rootOf(mount(Alert, { variant: "error", role: "status", children: "x" })).getAttribute("role")).toBe(
      "status",
    );
  });
});

describe("Progress", () => {
  it("определённое значение: aria-valuenow с округлением и ширина", () => {
    const progress = rootOf(mount(Progress, { value: 42.6, label: "Загрузка" }));
    expect(progress.getAttribute("role")).toBe("progressbar");
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(progress.getAttribute("aria-valuenow")).toBe("43");
    expect(progress.getAttribute("aria-label")).toBe("Загрузка");
    expect(progress.hasAttribute("data-indeterminate")).toBe(false);
    const bar = progress.querySelector(".sui-progress__bar") as HTMLElement;
    expect(bar.style.width).toBe("42.6%");
  });

  it("значение зажимается в 0..100", () => {
    expect(rootOf(mount(Progress, { value: 250 })).getAttribute("aria-valuenow")).toBe("100");
    expect(rootOf(mount(Progress, { value: -20 })).getAttribute("aria-valuenow")).toBe("0");
  });

  it("без label берёт доступное имя из UiConfigProvider", () => {
    const progress = rootOf(mount(Progress, { value: 10 }));
    expect(progress.getAttribute("aria-label")).toBe("Загрузка");
    expect(progress.getAttribute("aria-valuetext")).toBeNull();
  });

  it("без значения — indeterminate без aria-valuenow", () => {
    const progress = rootOf(mount(Progress, { label: "Ожидание" }));
    expect(progress.hasAttribute("data-indeterminate")).toBe(true);
    expect(progress.getAttribute("aria-valuenow")).toBeNull();
    expect(progress.querySelector(".sui-progress__bar")?.getAttribute("style")).toBeNull();
  });

  it.each(["sm", "md", "lg"] as const)("size=%s", (size) => {
    expect(rootOf(mount(Progress, { size, value: 1 })).getAttribute("data-size")).toBe(size);
  });

  it("circular: SVG-кольцо и stroke-dashoffset", () => {
    const progress = rootOf(mount(Progress, { variant: "circular", value: 30 }));
    expect(progress.getAttribute("data-variant")).toBe("circular");
    const value = progress.querySelector(".sui-progress__circle-value");
    expect(value).not.toBeNull();
    expect(value?.getAttribute("stroke-dashoffset")).toBe("70");
    expect(progress.querySelector(".sui-progress__track")).toBeNull();
  });

  it("showValue выводит процент рядом с подписью", () => {
    const progress = rootOf(mount(Progress, { value: 7, label: "Файл", showValue: true }));
    expect(progress.querySelector(".sui-progress__label")?.textContent).toBe("Файл");
    expect(progress.querySelector(".sui-progress__value")?.textContent).toBe("7%");
    expect(progress.getAttribute("aria-valuetext")).toBe("7%");
  });

  it("reduced motion: анимация indeterminate отключается в CSS", () => {
    const css = readCss("progress/progress.css");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("animation: none");
  });
});

describe("Badge", () => {
  it.each(["neutral", "primary", "accent", "success", "warning", "error", "info"] as const)(
    "вариант %s",
    (variant: BadgeVariant) => {
      const badge = rootOf(mount(Badge, { variant, count: 3 }));
      expect(badge.getAttribute("data-variant")).toBe(variant);
      expect(badge.textContent).toBe("3");
      expect(badge.getAttribute("aria-hidden")).toBeNull();
    },
  );

  it("max сворачивает счётчик в 99+ и поддерживает свой порог", () => {
    expect(rootOf(mount(Badge, { count: 120 })).textContent).toBe("99+");
    expect(rootOf(mount(Badge, { count: 100, max: 9 })).textContent).toBe("9+");
    expect(rootOf(mount(Badge, { count: 9, max: 9 })).textContent).toBe("9");
  });

  it("dot: пустой, декоративный по умолчанию, с label — доступный", () => {
    const dot = rootOf(mount(Badge, { dot: true }));
    expect(dot.hasAttribute("data-dot")).toBe(true);
    expect(dot.textContent).toBe("");
    expect(dot.getAttribute("aria-hidden")).toBe("true");

    const labeled = rootOf(mount(Badge, { dot: true, label: "Новые уведомления" }));
    expect(labeled.getAttribute("role")).toBe("status");
    expect(labeled.getAttribute("aria-label")).toBe("Новые уведомления");
    expect(labeled.getAttribute("aria-hidden")).toBeNull();
  });

  it("label на счётчике даёт role=status, без label роли нет", () => {
    const labeled = rootOf(mount(Badge, { count: 5, label: "Пять новых" }));
    expect(labeled.getAttribute("role")).toBe("status");
    expect(labeled.getAttribute("aria-label")).toBe("Пять новых");
    expect(rootOf(mount(Badge, { count: 5 })).hasAttribute("role")).toBe(false);
  });

  it("decorative=true принудительно скрывает", () => {
    const badge = rootOf(mount(Badge, { count: 2, label: "Два", decorative: true }));
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(badge.getAttribute("role")).toBeNull();
    expect(badge.getAttribute("aria-label")).toBeNull();
  });

  it("мержит class и attrs", () => {
    const badge = rootOf(mount(Badge, { count: 1, class: "custom", attrs: { "data-testid": "b" } }));
    expect(badge.classList.contains("sui-badge")).toBe(true);
    expect(badge.classList.contains("custom")).toBe(true);
    expect(badge.getAttribute("data-testid")).toBe("b");
  });

  it("position задаёт угол поверх родителя, по умолчанию inline", () => {
    expect(rootOf(mount(Badge, { count: 1 })).hasAttribute("data-position")).toBe(false);
    const positioned = rootOf(mount(Badge, { count: 1, position: "top-end" }));
    expect(positioned.getAttribute("data-position")).toBe("top-end");
  });

  it("длинный счётчик не ломает разметку и остаётся целым", () => {
    expect(rootOf(mount(Badge, { count: 999_999 })).textContent).toBe("99+");
    expect(rootOf(mount(Badge, { count: 999_999, max: 999_999 })).textContent).toBe("999999");
  });
});

describe("Skeleton", () => {
  it("по умолчанию text + pulse и aria-hidden", () => {
    const skeleton = rootOf(mount(Skeleton, {}));
    expect(skeleton.getAttribute("data-variant")).toBe("text");
    expect(skeleton.getAttribute("data-animation")).toBe("pulse");
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    expect((skeleton as HTMLElement).style.height).toBe("");
  });

  it("варианты и размеры: число → px, строка — как есть", () => {
    const circle = rootOf(mount(Skeleton, { variant: "circle", width: 40, height: 40 }));
    expect(circle.getAttribute("data-variant")).toBe("circle");
    expect((circle as HTMLElement).style.width).toBe("40px");
    expect((circle as HTMLElement).style.height).toBe("40px");

    const rect = rootOf(mount(Skeleton, { variant: "rect", width: "12rem" }));
    expect((rect as HTMLElement).style.width).toBe("12rem");
  });

  it("lines > 1 рендерит строки и режим multi", () => {
    const skeleton = rootOf(mount(Skeleton, { lines: 3 }));
    expect(skeleton.getAttribute("data-lines")).toBe("multi");
    expect(skeleton.querySelectorAll(".sui-skeleton__line")).toHaveLength(3);
  });

  it("size задаёт высоту строки (sm/md/lg), по умолчанию md", () => {
    expect(rootOf(mount(Skeleton, {})).getAttribute("data-size")).toBe("md");
    expect(rootOf(mount(Skeleton, { size: "lg" })).getAttribute("data-size")).toBe("lg");
  });

  it("animation=none отключает пульсацию, CSS уважает reduced motion", () => {
    expect(rootOf(mount(Skeleton, { animation: "none" })).getAttribute("data-animation")).toBe("none");
    const css = readCss("skeleton/skeleton.css");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("animation: none");
  });
});

describe("Card", () => {
  it.each(["elevated", "filled", "outlined"] as const)("вариант %s", (variant: CardVariant) => {
    const card = rootOf(mount(Card, { variant, children: "x" }));
    expect(card.className).toBe("sui-card");
    expect(card.getAttribute("data-variant")).toBe(variant);
    expect(card.getAttribute("role")).toBeNull();
  });

  it("padding по умолчанию 5 и переопределяется", () => {
    expect(rootOf(mount(Card, { children: "x" })).getAttribute("data-padding")).toBe("5");
    expect(rootOf(mount(Card, { padding: 6, children: "x" })).getAttribute("data-padding")).toBe("6");
  });

  it("mediaAspect и headerLines задают пропорции и обрезку заголовка", () => {
    expect(rootOf(mount(Card, { children: "x" })).getAttribute("data-media-aspect")).toBe("auto");
    const card = rootOf(
      mount(Card, { mediaAspect: "video", headerLines: 2, header: "Очень длинный заголовок", children: "x" }),
    );
    expect(card.getAttribute("data-media-aspect")).toBe("video");
    expect(card.getAttribute("data-header-lines")).toBe("2");
  });

  it("слоты media/header/actions/footer и тело", () => {
    const card = rootOf(
      mount(Card, {
        media: <img src="/cover.png" alt="" />,
        header: "Заголовок",
        actions: <button type="button">Действие</button>,
        footer: <span>Подвал</span>,
        children: "Тело",
      }),
    );
    expect(card.querySelector(".sui-card__media img")).not.toBeNull();
    expect(card.querySelector(".sui-card__header")?.textContent).toBe("Заголовок");
    expect(card.querySelector(".sui-card__body")?.textContent).toBe("Тело");
    expect(card.querySelector(".sui-card__actions button")?.textContent).toBe("Действие");
    expect(card.querySelector(".sui-card__footer")?.textContent).toBe("Подвал");
  });

  it("interactive: role=button, tabindex, клик и Enter/Space", () => {
    let clicks = 0;
    const card = rootOf(
      mount(Card, {
        interactive: true,
        children: "x",
        onClick: () => {
          clicks += 1;
        },
      }),
    );
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");
    click(card);
    press(card, "Enter");
    press(card, " ");
    expect(clicks).toBe(3);
  });

  it("interactive disabled: aria-disabled, без tabindex и кликов", () => {
    let clicks = 0;
    const card = rootOf(
      mount(Card, {
        interactive: true,
        disabled: true,
        children: "x",
        onClick: () => {
          clicks += 1;
        },
      }),
    );
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(card.getAttribute("tabindex")).toBeNull();
    click(card);
    expect(clicks).toBe(0);
  });
});

describe("List", () => {
  it("selectable ставит role=listbox и divider/dense", () => {
    const list = rootOf(mount(List, { selectable: true, divider: true, dense: true, children: "x" }));
    expect(list.tagName).toBe("UL");
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.hasAttribute("data-divider")).toBe(true);
    expect(list.hasAttribute("data-dense")).toBe(true);
  });

  it("ListItem: selected/current/aria и слоты", () => {
    const list = rootOf(
      mount(List, {
        selectable: true,
        children: (
          <ListItem selected leading={<span data-testid="lead" />} trailing={<span data-testid="tail" />}>
            Строка
          </ListItem>
        ),
      }),
    );
    const item = list.querySelector("li") as Element;
    expect(item.getAttribute("role")).toBe("option");
    expect(item.getAttribute("aria-selected")).toBe("true");
    expect(item.hasAttribute("data-selected")).toBe(true);
    expect(item.querySelector("[data-testid='lead']")).not.toBeNull();
    expect(item.querySelector("[data-testid='tail']")).not.toBeNull();

    const current = rootOf(mount(ListItem, { current: true, children: "x" }));
    expect(current.getAttribute("aria-current")).toBe("page");
  });

  it("интерактивная строка: role=button, клик и клавиатура", () => {
    let clicks = 0;
    const item = rootOf(
      mount(ListItem, {
        interactive: true,
        children: "x",
        onClick: () => {
          clicks += 1;
        },
      }),
    );
    expect(item.getAttribute("role")).toBe("button");
    expect(item.getAttribute("tabindex")).toBe("0");
    click(item);
    press(item, "Enter");
    expect(clicks).toBe(2);
  });

  it("divider на элементе и disabled-семантика", () => {
    const item = rootOf(mount(ListItem, { divider: true, disabled: true, children: "x" }));
    expect(item.hasAttribute("data-divider")).toBe(true);
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });

  it("lines и current дают data-атрибуты для обрезки и золотой метки", () => {
    const item = rootOf(mount(ListItem, { lines: 2, current: true, children: "Очень длинный текст" }));
    expect(item.getAttribute("data-lines")).toBe("2");
    expect(item.hasAttribute("data-current")).toBe(true);
    expect(item.getAttribute("aria-current")).toBe("page");
    expect(rootOf(mount(ListItem, { children: "x" })).hasAttribute("data-lines")).toBe(false);
  });

  it("совместим с keyed For", () => {
    const items = ["alpha", "beta", "gamma"];
    function KeyedList() {
      return (
        <List selectable>
          <For each={items} keyOf={(item: string) => item}>
            {(item: string) => <ListItem selected={item === "beta"}>{item}</ListItem>}
          </For>
        </List>
      );
    }
    const list = rootOf(mount(KeyedList));
    const rows = [...list.querySelectorAll("li")];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual(items);
    expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("Avatar", () => {
  it("SSR-изображение: src/alt/loading/decoding", () => {
    const avatar = rootOf(mount(Avatar, { src: "/me.png", alt: "Анна" }));
    const image = avatar.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/me.png");
    expect(image?.getAttribute("alt")).toBe("Анна");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("decoding")).toBe("async");
  });

  it("fallback: инициалы, затем иконка", () => {
    const initials = rootOf(mount(Avatar, { initials: "АБ", alt: "Анна Борисова" }));
    expect(initials.querySelector(".sui-avatar__initials")?.textContent).toBe("АБ");
    expect(initials.querySelector("img")).toBeNull();
    expect(initials.getAttribute("role")).toBe("img");
    expect(initials.getAttribute("aria-label")).toBe("Анна Борисова");

    const icon = rootOf(mount(Avatar, {}));
    expect(icon.querySelector(".sui-avatar__icon svg")).not.toBeNull();
    expect(icon.getAttribute("aria-label")).toBeNull();
  });

  it("битый src переключает на fallback, новый src возвращает изображение", () => {
    const handle = mount(Avatar, {
      src: "/broken.png",
      alt: "Анна",
      initials: "АБ",
    });
    const avatar = rootOf(handle);
    const image = avatar.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/broken.png");

    image?.dispatchEvent(new Event("error"));
    flushSync();

    expect(avatar.querySelector("img")).toBeNull();
    expect(avatar.querySelector(".sui-avatar__initials")?.textContent).toBe("АБ");
    expect(avatar.getAttribute("role")).toBe("img");
    expect(avatar.getAttribute("aria-label")).toBe("Анна");

    handle.update({ src: "/fresh.png", alt: "Анна", initials: "АБ" });
    flushSync();

    const restored = avatar.querySelector("img");
    expect(restored?.getAttribute("src")).toBe("/fresh.png");
    expect(avatar.hasAttribute("role")).toBe(false);
    expect(avatar.hasAttribute("aria-label")).toBe(false);
  });

  it("битый src без инициалов показывает иконку", () => {
    const handle = mount(Avatar, { src: "/broken.png", alt: "Анна" });
    const avatar = rootOf(handle);
    avatar.querySelector("img")?.dispatchEvent(new Event("error"));
    flushSync();

    expect(avatar.querySelector("img")).toBeNull();
    expect(avatar.querySelector(".sui-avatar__icon svg")).not.toBeNull();
    expect(avatar.getAttribute("role")).toBe("img");
    expect(avatar.getAttribute("aria-label")).toBe("Анна");
  });

  it("размер, форма и статус", () => {
    const avatar = rootOf(
      mount(Avatar, { size: "xl", shape: "square", initials: "AB", status: "online" }),
    );
    expect(avatar.getAttribute("data-size")).toBe("xl");
    expect(avatar.getAttribute("data-shape")).toBe("square");
    expect(avatar.getAttribute("data-status")).toBe("online");
    const status = avatar.querySelector(".sui-avatar__status");
    expect(status?.getAttribute("aria-hidden")).toBe("true");

    const labeled = rootOf(mount(Avatar, { status: "busy", statusLabel: "Занят" }));
    expect(labeled.querySelector(".sui-avatar__status")?.getAttribute("aria-label")).toBe("Занят");
    expect(labeled.querySelector(".sui-avatar__status")?.getAttribute("role")).toBe("img");
  });

  it("CSS держит квадрат aspect-ratio и логическое позиционирование статуса", () => {
    const css = readCss("avatar/avatar.css");
    expect(css).toContain("aspect-ratio: 1 / 1");
    expect(css).toContain("inset-inline-end");
    expect(css).toContain("--sui-avatar-size");
    expect(css).toContain("object-fit: cover");
  });
});

describe("SSR и гидрация feedback/data", () => {
  function Demo() {
    return (
      <div>
        <Alert variant="success" title="Готово" dismissible>
          Данные сохранены
        </Alert>
        <Progress value={40} label="Загрузка" showValue />
        <Badge count={5} />
        <Skeleton lines={2} />
        <Card variant="outlined" header="Карточка">
          Тело
        </Card>
        <List selectable divider>
          <ListItem selected>Один</ListItem>
          <ListItem>Два</ListItem>
        </List>
        <Avatar src="/avatar.png" alt="Профиль" status="online" />
      </div>
    );
  }

  it("renderToString даёт корректную разметку", async () => {
    const { html } = await renderToString(Demo);
    expect(html).toContain("sui-alert");
    expect(html).toContain('role="status"');
    expect(html).toContain("Данные сохранены");
    expect(html).toContain("sui-progress");
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("sui-badge");
    expect(html).toContain("sui-skeleton__line");
    expect(html).toContain("sui-card");
    expect(html).toContain("sui-list");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("sui-avatar");
    expect(html).toContain('alt="Профиль"');
    expect(html).not.toContain("jsx(");
  });

  it("hydrate проходит без mismatch", async () => {
    const { html } = await renderToString(Demo);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const mismatches: string[] = [];
    const handle = await hydrate(container, Demo, {
      onMismatch: (error) => {
        mismatches.push(error.message);
      },
    });
    expect(mismatches).toEqual([]);
    expect(container.querySelector(".sui-alert__title")?.textContent).toBe("Готово");
    expect(container.querySelector(".sui-card__header")?.textContent).toBe("Карточка");
    expect(container.querySelectorAll(".sui-list-item")).toHaveLength(2);
    expect(container.querySelector("img.sui-avatar__image")?.getAttribute("src")).toBe(
      "/avatar.png",
    );
    handle.dispose();
  });
});
