import { afterEach, describe, expect, it } from "vitest";
import feedbackMeta, {
  Playground as AlertPlayground,
  ProgressPlayground,
  SkeletonPlayground,
} from "../src/feedback.stories.js";
import dataMeta, {
  AvatarPlayground,
  CardPlayground,
  ListPlayground,
  Playground as BadgePlayground,
} from "../src/data-display.stories.js";
import { disposeStory, mountStory } from "../src/silent-story.js";

function canvas(): Element {
  const element = document.createElement("section");
  document.body.appendChild(element);
  return element;
}

function mount(story: unknown, args: object): Element {
  const element = canvas();
  mountStory(story, { ...args }, element);
  return element;
}

afterEach(() => {
  disposeStory();
  document.body.replaceChildren();
});

describe("feedback/data stories", () => {
  it("meta описывает controls", () => {
    for (const meta of [feedbackMeta, dataMeta] as Array<Record<string, unknown>>) {
      expect(typeof meta["title"]).toBe("string");
      expect(Object.keys(meta["argTypes"] as object).length).toBeGreaterThan(0);
      expect(meta["args"]).toBeTypeOf("object");
    }
  });

  it("Alert Playground монтируется с args", () => {
    const element = mount(AlertPlayground.render, {
      variant: "error",
      title: "Ошибка",
      message: "Текст",
      dismissible: true,
    });
    expect(element.querySelector(".sui-alert")?.getAttribute("data-variant")).toBe("error");
    expect(element.querySelector(".sui-alert__close")).not.toBeNull();
    expect(element.textContent).toContain("Текст");
  });

  it("Progress и Skeleton Playground слушают args", () => {
    const progress = mount(ProgressPlayground.render, {
      variant: "circular",
      size: "lg",
      value: 55,
      determinate: true,
      label: "Загрузка",
      showValue: true,
    });
    expect(progress.querySelector(".sui-progress")?.getAttribute("data-variant")).toBe("circular");
    expect(progress.querySelector(".sui-progress__circle-value")).not.toBeNull();
    expect(progress.textContent).toContain("55%");

    const skeleton = mount(SkeletonPlayground.render, {
      variant: "text",
      animation: "none",
      lines: 3,
      width: 200,
      height: 16,
    });
    expect(skeleton.querySelectorAll(".sui-skeleton__line")).toHaveLength(3);
    expect(skeleton.querySelector(".sui-skeleton")?.getAttribute("data-animation")).toBe("none");
  });

  it("Badge/Card/List/Avatar Playground монтируются", () => {
    const badge = mount(BadgePlayground.render, {
      count: 120,
      max: 99,
      dot: false,
      variant: "error",
      label: "Непрочитанные",
    });
    expect(badge.querySelector(".sui-badge")?.textContent).toBe("99+");

    const card = mount(CardPlayground.render, {
      variant: "filled",
      padding: 6,
      interactive: true,
      disabled: false,
      header: "Заголовок",
      body: "Тело",
    });
    expect(card.querySelector(".sui-card")?.getAttribute("role")).toBe("button");

    const list = mount(ListPlayground.render, {
      selected: 2,
      interactive: true,
      divider: true,
      dense: false,
    });
    const selected = list.querySelectorAll(".sui-list-item[data-selected]");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain("Черновики");

    const avatar = mount(AvatarPlayground.render, {
      kind: "initials",
      size: "xl",
      shape: "square",
      status: "online",
      initials: "АБ",
    });
    expect(avatar.querySelector(".sui-avatar")?.getAttribute("data-size")).toBe("xl");
    expect(avatar.querySelector(".sui-avatar__status")).not.toBeNull();
  });
});
