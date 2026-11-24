import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createComponent, hydrate, type AnyComponent } from "@ivlev-dev/silent-core";
import { renderToString } from "@ivlev-dev/silent-server";
import {
  Box,
  Button,
  Container,
  Divider,
  Grid,
  Heading,
  Icon,
  IconButton,
  Inline,
  Label,
  Spinner,
  Stack,
  Surface,
  Text,
  ThemeScript,
  UiConfigProvider,
  applyTheme,
  readStoredTheme,
  resetThemePalette,
  themeScriptSource,
  useUiConfig,
} from "../src/index.js";
import { CloseIcon } from "../src/icons/index.js";

interface Handle {
  readonly node: Node;
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

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  localStorage.clear();
});

describe("Button", () => {
  it.each(["filled", "accent", "tonal", "outlined", "text", "elevated"] as const)(
    "вариант %s выставляется через data-variant",
    (variant) => {
      const button = rootOf(mount(Button, { variant, children: "Кнопка" }));
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("data-variant")).toBe(variant);
      expect(button.className).toBe("sui-button");
    },
  );

  it.each(["sm", "md", "lg"] as const)("размер %s", (size) => {
    const button = rootOf(mount(Button, { size, children: "x" }));
    expect(button.getAttribute("data-size")).toBe(size);
  });

  it("по умолчанию type=button", () => {
    expect(rootOf(mount(Button, { children: "x" })).getAttribute("type")).toBe("button");
    expect(rootOf(mount(Button, { type: "submit", children: "x" })).getAttribute("type")).toBe("submit");
  });

  it("loading: aria-busy, disabled, спиннер вместо leading", () => {
    const button = rootOf(mount(Button, { loading: true, children: "Сохранить" }));
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("data-loading")).toBe(true);
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(button.textContent).toContain("Сохранить");
  });

  it("disabled не включает aria-busy и не вызывает onClick", () => {
    let clicks = 0;
    const button = rootOf(
      mount(Button, {
        disabled: true,
        children: "x",
        onClick: () => {
          clicks += 1;
        },
      }),
    );
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.hasAttribute("aria-busy")).toBe(false);
    click(button);
    expect(clicks).toBe(0);
  });

  it("вызывает onClick и мержит class/style/attrs", () => {
    let clicks = 0;
    const button = rootOf(
      mount(Button, {
        class: "custom",
        style: { color: "red" },
        attrs: { "data-testid": "save", "aria-describedby": "hint" },
        children: "x",
        onClick: () => {
          clicks += 1;
        },
      }),
    );
    click(button);
    expect(clicks).toBe(1);
    expect(button.classList.contains("sui-button")).toBe(true);
    expect(button.classList.contains("custom")).toBe(true);
    expect((button as HTMLElement).style.color).toBe("red");
    expect(button.getAttribute("data-testid")).toBe("save");
    expect(button.getAttribute("aria-describedby")).toBe("hint");
  });

  it("full-width", () => {
    expect(rootOf(mount(Button, { fullWidth: true, children: "x" })).hasAttribute("data-full-width")).toBe(true);
  });

  it("длинный текст: лейбл с ellipsis-слотом и title только для строки", () => {
    const button = rootOf(mount(Button, { children: "Очень длинное действие" }));
    const label = button.querySelector(".sui-button__label");
    expect(label?.getAttribute("title")).toBe("Очень длинное действие");

    const rich = rootOf(mount(Button, { children: <span>rich</span> }));
    expect(rich.querySelector(".sui-button__label")?.hasAttribute("title")).toBe(false);
  });

  it("вызывает ref-колбэк и снимает его при dispose", () => {
    const seen: Array<Element | null> = [];
    const handle = mount(Button, {
      children: "x",
      ref: (node: Element | null) => {
        seen.push(node);
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(handle.node);
    handle.dispose();
    handles.splice(handles.indexOf(handle), 1);
    expect(seen.at(-1)).toBeNull();
  });
});

describe("IconButton", () => {
  it("ставит aria-label и круглый класс", () => {
    const button = rootOf(mount(IconButton, { label: "Закрыть", children: <CloseIcon /> }));
    expect(button.getAttribute("aria-label")).toBe("Закрыть");
    expect(button.classList.contains("sui-icon-button")).toBe(true);
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("варианты и размеры", () => {
    const button = rootOf(
      mount(IconButton, { label: "Меню", variant: "tonal", size: "lg", children: <CloseIcon /> }),
    );
    expect(button.getAttribute("data-variant")).toBe("tonal");
    expect(button.getAttribute("data-size")).toBe("lg");

    const accent = rootOf(
      mount(IconButton, { label: "Избранное", variant: "accent", children: <CloseIcon /> }),
    );
    expect(accent.getAttribute("data-variant")).toBe("accent");
  });

  it("loading: aria-busy, disabled и спиннер вместо иконки", () => {
    let clicks = 0;
    const button = rootOf(
      mount(IconButton, {
        label: "Сохранить",
        loading: true,
        children: <CloseIcon />,
        onClick: () => {
          clicks += 1;
        },
      }),
    );
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("data-loading")).toBe(true);
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(button.querySelector("svg.sui-icon")).toBeNull();
    click(button);
    expect(clicks).toBe(0);
  });
});

describe("Typography", () => {
  it("Heading выбирает тег по уровню", () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const heading = rootOf(mount(Heading, { level, children: "Заголовок" }));
      expect(heading.tagName).toBe(`H${level}`);
      expect(heading.getAttribute("data-level")).toBe(String(level));
    }
  });

  it("Heading: вариант по умолчанию зависит от уровня", () => {
    expect(rootOf(mount(Heading, { level: 1, children: "x" })).getAttribute("data-variant")).toBe("display-medium");
    expect(rootOf(mount(Heading, { level: 6, children: "x" })).getAttribute("data-variant")).toBe("title-small");
    expect(
      rootOf(mount(Heading, { level: 1, variant: "display-large", children: "x" })).getAttribute("data-variant"),
    ).toBe("display-large");
  });

  it("Text: вариант, тон, выравнивание, clamp", () => {
    const text = rootOf(
      mount(Text, { variant: "body-small", tone: "muted", align: "center", clamp: 2, children: "text" }),
    );
    expect(text.tagName).toBe("SPAN");
    expect(text.getAttribute("data-variant")).toBe("body-small");
    expect(text.getAttribute("data-tone")).toBe("muted");
    expect(text.getAttribute("data-align")).toBe("center");
    expect(text.getAttribute("data-clamp")).toBe("2");
  });

  it("Text: truncate и measure дают классы и data-атрибуты", () => {
    const truncated = rootOf(mount(Text, { truncate: true, children: "Очень длинная строка" }));
    expect(truncated.classList.contains("sui-truncate")).toBe(true);
    expect(truncated.hasAttribute("data-truncate")).toBe(true);

    const measured = rootOf(mount(Text, { measure: true, children: "Абзац" }));
    expect(measured.classList.contains("sui-measure")).toBe(true);
    expect(measured.hasAttribute("data-measure")).toBe(true);
  });

  it("Heading: display/headline переключаются на serif в CSS", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, "..", "src", "components", "heading", "heading.css"), "utf8");
    expect(css).toContain('[data-variant^="display"]');
    expect(css).toContain('[data-variant^="headline"]');
    expect(css).toContain("var(--sui-font-display)");
    expect(css).toContain("var(--sui-font-sans)");
  });

  it("Label связывает for и маркер обязательности", () => {
    const label = rootOf(mount(Label, { for: "email", required: true, children: "Email" }));
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe("email");
    expect(label.textContent).toContain("Email");
    expect(label.textContent).toContain("*");
  });

  it("Label: uppercase — только по явному флагу", () => {
    expect(rootOf(mount(Label, { children: "Почта" })).hasAttribute("data-case")).toBe(false);
    expect(
      rootOf(mount(Label, { uppercase: true, children: "Раздел" })).getAttribute("data-case"),
    ).toBe("upper");
  });

  it("Icon: декоративная по умолчанию, с label — role=img", () => {
    const decorative = rootOf(mount(Icon, { children: <path d="M0 0" /> }));
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    expect(decorative.getAttribute("role")).toBeNull();

    const labeled = rootOf(mount(Icon, { label: "Закрыть", children: <path d="M0 0" /> }));
    expect(labeled.getAttribute("role")).toBe("img");
    expect(labeled.getAttribute("aria-label")).toBe("Закрыть");
    expect(labeled.getAttribute("aria-hidden")).toBeNull();
  });

  it("иконки Material Symbols рендерятся в svg", () => {
    const svg = rootOf(mount(CloseIcon, {}));
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelector("path")).not.toBeNull();
  });
});

describe("Layout", () => {
  it("Box: padding/background/border/radius/elevation", () => {
    const box = rootOf(
      mount(Box, {
        padding: 4,
        background: "surface-container",
        border: "outline-variant",
        radius: "md",
        elevation: 2,
        children: "x",
      }),
    );
    expect(box.className).toBe("sui-box");
    expect(box.getAttribute("data-padding")).toBe("4");
    expect(box.getAttribute("data-background")).toBe("surface-container");
    expect(box.getAttribute("data-border")).toBe("outline-variant");
    expect(box.getAttribute("data-radius")).toBe("md");
    expect(box.getAttribute("data-elevation")).toBe("2");
  });

  it("Stack и Inline: gap/align/justify/wrap", () => {
    const stack = rootOf(mount(Stack, { gap: 3, align: "center", justify: "between", children: "x" }));
    expect(stack.getAttribute("data-gap")).toBe("3");
    expect(stack.getAttribute("data-align")).toBe("center");
    expect(stack.getAttribute("data-justify")).toBe("between");

    const inline = rootOf(mount(Inline, { wrap: true, children: "x" }));
    expect(inline.hasAttribute("data-wrap")).toBe(true);
  });

  it("Grid и Container", () => {
    const grid = rootOf(mount(Grid, { columns: 3, gap: 2, min: "sm", children: "x" }));
    expect(grid.getAttribute("data-columns")).toBe("3");
    expect(grid.getAttribute("data-gap")).toBe("2");
    expect(grid.getAttribute("data-min")).toBe("sm");

    const container = rootOf(mount(Container, { size: "wide", gutter: false, children: "x" }));
    expect(container.getAttribute("data-size")).toBe("wide");
    expect(container.getAttribute("data-gutter")).toBe("none");
  });

  it("Surface и Divider", () => {
    const surface = rootOf(mount(Surface, { tone: "primary-container", radius: "lg", children: "x" }));
    expect(surface.className).toBe("sui-surface");
    expect(surface.getAttribute("data-tone")).toBe("primary-container");

    const divider = rootOf(mount(Divider, { orientation: "vertical", inset: "both" }));
    expect(divider.tagName).toBe("HR");
    expect(divider.getAttribute("data-orientation")).toBe("vertical");
    expect(divider.getAttribute("aria-hidden")).toBe("true");
  });

  it("attrs добавляет произвольные атрибуты", () => {
    const stack = rootOf(mount(Stack, { attrs: { "data-testid": "stack", role: "list" }, children: "x" }));
    expect(stack.getAttribute("data-testid")).toBe("stack");
    expect(stack.getAttribute("role")).toBe("list");
  });
});

describe("Тема и конфигурация", () => {
  it("applyTheme ставит data-theme и палитру, resetThemePalette снимает", () => {
    applyTheme({ theme: "dark", palette: { primary: "#123456" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--sui-color-primary")).toBe("#123456");
    resetThemePalette();
    expect(document.documentElement.style.getPropertyValue("--sui-color-primary")).toBe("");
  });

  it("applyTheme сохраняет выбор и readStoredTheme его читает", () => {
    applyTheme({ theme: "light", persist: true });
    expect(readStoredTheme()).toBe("light");
    expect(readStoredTheme("other-key")).toBeNull();
  });

  it("themeScriptSource ставит data-theme до отрисовки", () => {
    const source = themeScriptSource();
    expect(source).toContain("data-theme");
    expect(source).toContain("sui-theme");
    expect(source).toContain("\"auto\"");
  });

  it("ThemeScript рендерит script с nonce и кодом темы", () => {
    const script = rootOf(mount(ThemeScript, { nonce: "n0nce", defaultTheme: "dark" }));
    expect(script.tagName).toBe("SCRIPT");
    expect(script.getAttribute("nonce")).toBe("n0nce");
    expect(script.textContent).toContain("data-theme");
    expect(script.textContent).toContain("\"dark\"");
  });

  it("UiConfigProvider переопределяет RU-строки", () => {
    const defaultSpinner = rootOf(mount(Spinner, {}));
    expect(defaultSpinner.getAttribute("aria-label")).toBe("Загрузка");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const result = createComponent(UiConfigProvider, {
      strings: { loading: "Loading" },
      children: () => <Spinner />,
    });
    container.appendChild(result.node);
    handles.push(result);
    const spinner = container.querySelector('[role="progressbar"]');
    expect(spinner?.getAttribute("aria-label")).toBe("Loading");
  });

  it("useUiConfig возвращает строки по умолчанию вне провайдера", () => {
    expect(useUiConfig().strings.close).toBe("Закрыть");
    expect(useUiConfig().locale).toBe("ru-RU");
  });
});

describe("SSR и гидрация", () => {
  function Demo(props: { label?: string }) {
    return (
      <Stack gap={2} attrs={{ "data-testid": "demo" }}>
        <Heading level={2}>Заголовок</Heading>
        <Button variant="tonal" attrs={{ "data-testid": "action" }}>
          {props.label ?? "Действие"}
        </Button>
        <Spinner />
      </Stack>
    );
  }

  it("renderToString даёт корректную разметку", async () => {
    const { html } = await renderToString(Demo);
    expect(html).toContain('class="sui-stack"');
    expect(html).toContain("data-testid=\"demo\"");
    expect(html).toContain("<h2");
    expect(html).toContain("sui-button");
    expect(html).toContain("data-variant=\"tonal\"");
    expect(html).toContain("Действие");
    expect(html).toContain("Загрузка");
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
    expect(container.querySelector('[data-testid="action"]')?.textContent).toContain("Действие");
    handle.dispose();
  });
});
