import { afterEach, describe, expect, it, vi } from "vitest";
import { createComponent, createSignal, flushSync } from "@ivlev-dev/silent-core";
import { RichTextEditor } from "../src/components/rich-text-editor/index.js";
import { fakeField } from "./form-test-utils.js";

interface Handle {
  readonly node: Node;
  dispose(): void;
}

const handles: Handle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

function mount(props: Record<string, unknown> = {}): Handle {
  const result = createComponent(RichTextEditor, props);
  document.body.appendChild(result.node);
  flushSync();
  handles.push(result);
  return result;
}

function parts(handle: Handle): {
  field: Element;
  root: HTMLElement;
  content: HTMLDivElement;
  hidden: HTMLInputElement;
  toolbar: HTMLElement | null;
} {
  const field = handle.node as Element;
  const root = field.querySelector<HTMLElement>(".sui-rte");
  const content = field.querySelector<HTMLDivElement>(".sui-rte__content");
  const hidden = field.querySelector<HTMLInputElement>('input[type="hidden"]');
  if (root === null || content === null || hidden === null) {
    throw new Error("RichTextEditor: не найдены части разметки");
  }
  return {
    field,
    root,
    content,
    hidden,
    toolbar: field.querySelector<HTMLElement>(".sui-rte__toolbar"),
  };
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flushSync();
}

function fireInput(element: Element): void {
  element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  flushSync();
}

function fireKey(element: Element, init: KeyboardEventInit): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
  flushSync();
}

function firstText(root: Node, value: string): Text {
  const documentRef = root.ownerDocument;
  if (documentRef === null) throw new Error("узел вне документа");
  const walker = documentRef.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    if ((node as Text).data.includes(value)) return node as Text;
    node = walker.nextNode();
  }
  throw new Error(`не найден текст ${value}`);
}

function selectText(root: HTMLElement, value: string, from = 0, to = value.length): void {
  const node = firstText(root, value);
  const start = node.data.indexOf(value) + from;
  const range = root.ownerDocument.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + (to - from));
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  flushSync();
}

function selectAll(root: HTMLElement): void {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  flushSync();
}

function selectRange(
  root: HTMLElement,
  startText: string,
  startOffset: number,
  endText: string,
  endOffset: number,
): void {
  const startNode = firstText(root, startText);
  const endNode = firstText(root, endText);
  const range = root.ownerDocument.createRange();
  range.setStart(startNode, startNode.data.indexOf(startText) + startOffset);
  range.setEnd(endNode, endNode.data.indexOf(endText) + endOffset);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  flushSync();
}

function caret(root: HTMLElement, value: string, offset = 0): void {
  const node = firstText(root, value);
  const start = node.data.indexOf(value) + offset;
  const range = root.ownerDocument.createRange();
  range.setStart(node, start);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  flushSync();
}

function toolbarButton(root: Element, command: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(
    `button[data-command="${command}"]`,
  );
  if (button === null) throw new Error(`нет кнопки ${command}`);
  return button;
}

describe("RichTextEditor: разметка и доступность", () => {
  it("рендерит textbox, toolbar и связи label/hint", () => {
    const field = fakeField("<p>Hello</p>", {
      id: "bio",
      name: "bio",
      label: "Биография",
      hint: "Коротко о себе",
      required: true,
    });
    const { root, content, hidden, toolbar } = parts(
      mount({ id: "bio", field: field.field }),
    );

    expect(root.className).toBe("sui-rte");
    expect(root.getAttribute("data-size")).toBe("md");
    expect(root.hasAttribute("data-mounted")).toBe(true);

    expect(content.getAttribute("role")).toBe("textbox");
    expect(content.getAttribute("aria-multiline")).toBe("true");
    expect(content.getAttribute("aria-labelledby")).toBe("bio-label");
    expect(content.getAttribute("aria-describedby")).toBe("bio-hint");
    expect(content.getAttribute("aria-required")).toBe("true");
    expect(content.getAttribute("tabindex")).toBe("0");
    expect(content.getAttribute("spellcheck")).toBe("true");
    expect(content.innerHTML).toBe("<p>Hello</p>");
    expect(content.querySelector("p")?.textContent).toBe("Hello");

    expect(toolbar?.getAttribute("role")).toBe("toolbar");
    expect(toolbar?.getAttribute("aria-label")).toBe("Форматирование текста");
    const bold = toolbarButton(root, "bold");
    expect(bold.getAttribute("type")).toBe("button");
    expect(bold.getAttribute("aria-label")).toBe("Полужирный");
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    expect(toolbarButton(root, "undo").hasAttribute("aria-pressed")).toBe(false);

    expect(hidden.getAttribute("type")).toBe("hidden");
    expect(hidden.getAttribute("name")).toBe("bio");
    expect(hidden.value).toBe("<p>Hello</p>");
  });

  it("уважает настраиваемый toolbar и разделители", () => {
    const { toolbar } = parts(
      mount({ toolbar: ["bold", "|", "undo"], defaultValue: "" }),
    );
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelectorAll("button")).toHaveLength(2);
    expect(toolbar?.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(toolbarButton(toolbar as Element, "bold")).toBeTruthy();
  });

  it("readOnly: редактирование запрещено, но значение остаётся и отправляется", () => {
    const changes: string[] = [];
    const { root, content, hidden } = parts(
      mount({
        value: "<p>locked</p>",
        readOnly: true,
        onValueChange: (value: string) => changes.push(value),
      }),
    );
    expect(root.hasAttribute("data-readonly")).toBe(true);
    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(content.getAttribute("aria-readonly")).toBe("true");
    expect(hidden.disabled).toBe(false);
    expect(toolbarButton(root, "bold").disabled).toBe(true);

    content.innerHTML = "<p>hack</p>";
    fireInput(content);
    expect(changes).toEqual([]);
    expect(hidden.value).toBe("<p>locked</p>");
  });

  it("disabled: недоступен с клавиатуры, скрытый input disabled", () => {
    const { root, content, hidden } = parts(
      mount({ value: "<p>x</p>", disabled: true }),
    );
    expect(root.hasAttribute("data-disabled")).toBe(true);
    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(content.getAttribute("aria-disabled")).toBe("true");
    expect(content.getAttribute("tabindex")).toBe("-1");
    expect(hidden.disabled).toBe(true);
    expect(toolbarButton(root, "bold").disabled).toBe(true);
  });
});

describe("RichTextEditor: значение и форма", () => {
  it("onValueChange и hidden input обновляются по input", () => {
    const changes: string[] = [];
    const { content, hidden } = parts(
      mount({
        value: "<p>old</p>",
        onValueChange: (value: string) => changes.push(value),
      }),
    );
    content.innerHTML = "<p>new</p>";
    caret(content, "new", 3);
    fireInput(content);
    expect(changes.at(-1)).toBe("<p>new</p>");
    expect(hidden.value).toBe("<p>new</p>");
  });

  it("field получает синтетический change с HTML и типом text", () => {
    const fake = fakeField("<p>old</p>", { name: "body" });
    const events: Array<Record<string, unknown>> = [];
    const original = fake.field.onChange.bind(fake.field);
    fake.field.onChange = (event) => {
      events.push(event.currentTarget as Record<string, unknown>);
      original(event);
    };
    const { content, hidden } = parts(mount({ field: fake.field }));
    content.innerHTML = "<p><strong>new</strong></p>";
    fireInput(content);
    expect(fake.field.value).toBe("<p><strong>new</strong></p>");
    expect(events.at(-1)).toMatchObject({
      value: "<p><strong>new</strong></p>",
      type: "text",
    });
    expect(hidden.value).toBe("<p><strong>new</strong></p>");
  });

  it("внешний value обновляет DOM, если редактор не в фокусе", () => {
    const [value, setValue] = createSignal("<p>one</p>");
    const handle = mount({
      get value() {
        return value();
      },
    });
    const { content } = parts(handle);
    expect(content.innerHTML).toBe("<p>one</p>");

    setValue("<p>two <strong>bold</strong></p>");
    flushSync();
    expect(content.innerHTML).toBe("<p>two <strong>bold</strong></p>");
  });

  it("не затирает ввод, пока редактор в фокусе, и применяет после blur", async () => {
    const [value, setValue] = createSignal("<p>one</p>");
    const { root, content } = parts(
      mount({
        get value() {
          return value();
        },
      }),
    );
    content.focus();
    expect(document.activeElement).toBe(content);

    setValue("<p>two</p>");
    flushSync();
    expect(content.innerHTML).toBe("<p>one</p>");

    content.blur();
    content.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    await Promise.resolve();
    flushSync();
    expect(content.innerHTML).toBe("<p>two</p>");
    expect(root.contains(document.activeElement)).toBe(false);
  });

  it("SSR-значение санитайзится при монтировании", () => {
    const { content, hidden } = parts(
      mount({
        defaultValue:
          '<p>ok</p><img src="x" onerror="alert(1)"><script>alert(1)</script>',
      }),
    );
    expect(content.innerHTML).toBe("<p>ok</p>");
    expect(hidden.value).toBe("<p>ok</p>");
  });

  it("onBlur срабатывает только при выходе фокуса из корня", () => {
    const blurs = vi.fn();
    const { root } = parts(
      mount({ defaultValue: "<p>x</p>", onBlur: blurs }),
    );

    root.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: toolbarButton(root, "bold"),
      }),
    );
    expect(blurs).not.toHaveBeenCalled();

    root.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    expect(blurs).toHaveBeenCalledTimes(1);
  });

  it("reset формы возвращает defaultValue, если редактор не в фокусе", async () => {
    const form = document.createElement("form");
    document.body.appendChild(form);
    const result = createComponent(RichTextEditor, {
      name: "bio",
      defaultValue: "<p>start</p>",
    });
    form.appendChild(result.node);
    flushSync();
    handles.push(result);

    const { content, hidden } = parts(result);
    content.innerHTML = "<p>changed</p>";
    fireInput(content);
    expect(hidden.value).toBe("<p>changed</p>");

    form.dispatchEvent(new Event("reset", { bubbles: true }));
    await Promise.resolve();
    flushSync();

    expect(content.innerHTML).toBe("<p>start</p>");
    expect(hidden.value).toBe("<p>start</p>");
  });

  it("санитайз всегда включён и не отключается пропсом", () => {
    const changes: string[] = [];
    const { content, hidden } = parts(
      mount({
        sanitize: false,
        defaultValue:
          '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
        onValueChange: (html: string) => changes.push(html),
      }),
    );
    expect(content.innerHTML).toBe("<p>ok</p>");
    expect(hidden.value).toBe("<p>ok</p>");

    content.innerHTML = '<p onclick="alert(1)">ok2</p><script>alert(1)</script>';
    fireInput(content);
    expect(changes.at(-1)).toBe("<p>ok2</p>");
    expect(hidden.value).toBe("<p>ok2</p>");
  });

  it("без id два экземпляра получают разные id и корректные ARIA-связи", () => {
    const first = parts(
      mount({ label: "Первый", hint: "Подсказка 1", defaultValue: "<p>A</p>" }),
    );
    const second = parts(
      mount({ label: "Второй", hint: "Подсказка 2", defaultValue: "<p>B</p>" }),
    );

    const firstId = first.content.id;
    const secondId = second.content.id;
    expect(firstId).not.toBe(secondId);
    expect(firstId).toMatch(/^sui-rte-\d+$/u);
    expect(secondId).toMatch(/^sui-rte-\d+$/u);

    expect(first.content.getAttribute("aria-labelledby")).toBe(`${firstId}-label`);
    expect(first.content.getAttribute("aria-describedby")).toBe(`${firstId}-hint`);
    expect(document.getElementById(`${firstId}-label`)?.getAttribute("for")).toBe(
      firstId,
    );
    expect(document.getElementById(`${firstId}-hint`)?.textContent).toBe("Подсказка 1");
    expect(first.hidden.name).toBe(firstId);

    selectText(first.content, "A");
    click(toolbarButton(first.root, "link"));
    expect(
      first.root.querySelector(".sui-rte__link-panel")?.getAttribute("id"),
    ).toBe(`${firstId}-link`);
    expect(toolbarButton(first.root, "link").getAttribute("aria-controls")).toBe(
      `${firstId}-link`,
    );
  });
});

describe("RichTextEditor: команды через Range", () => {
  it("bold оборачивает выделение и разворачивает повторным нажатием", () => {
    const { root, content } = parts(mount({ value: "<p>Hello world</p>" }));
    selectText(content, "world");
    click(toolbarButton(root, "bold"));
    expect(content.innerHTML).toBe("<p>Hello <strong>world</strong></p>");
    expect(toolbarButton(root, "bold").getAttribute("aria-pressed")).toBe("true");

    click(toolbarButton(root, "bold"));
    expect(content.innerHTML).toBe("<p>Hello world</p>");
    expect(toolbarButton(root, "bold").getAttribute("aria-pressed")).toBe("false");
  });

  it("collapsed caret вставляет маркер, а ввод убирает ZWSP", () => {
    const { root, content } = parts(mount({ value: "<p>Hello</p>" }));
    caret(content, "Hello", 5);
    click(toolbarButton(root, "bold"));
    const marker = content.querySelector("strong");
    expect(marker?.textContent).toBe("\u200B");

    const text = marker?.firstChild as Text;
    text.data = `\u200Bx`;
    const range = content.ownerDocument.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const selection = content.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireInput(content);

    expect(content.innerHTML).toBe("<p>Hello<strong>x</strong></p>");
    expect(content.textContent).not.toContain("\u200B");
  });

  it("h1 и ul преобразуют текущий блок", () => {
    const first = parts(mount({ value: "<p>Title</p>" }));
    caret(first.content, "Title", 2);
    click(toolbarButton(first.root, "h1"));
    expect(first.content.innerHTML).toBe("<h1>Title</h1>");

    const second = parts(mount({ value: "<p>Item</p>" }));
    caret(second.content, "Item", 2);
    click(toolbarButton(second.root, "ul"));
    expect(second.content.innerHTML).toBe("<ul><li>Item</li></ul>");
  });

  it("code и blockquote меняют тег блока", () => {
    const first = parts(mount({ value: "<p>Code</p>" }));
    caret(first.content, "Code", 2);
    click(toolbarButton(first.root, "code"));
    expect(first.content.innerHTML).toBe("<pre>Code</pre>");

    const second = parts(mount({ value: "<p>Quote</p>" }));
    caret(second.content, "Quote", 2);
    click(toolbarButton(second.root, "blockquote"));
    expect(second.content.innerHTML).toBe("<blockquote>Quote</blockquote>");
  });

  it("clear разворачивает inline-форматирование в текст", () => {
    const { root, content } = parts(
      mount({ value: "<p><strong>Hello</strong> <em>world</em></p>" }),
    );
    selectAll(content);
    click(toolbarButton(root, "clear"));
    expect(content.innerHTML).toBe("<p>Hello world</p>");
  });

  it("Tab вставляет табуляцию и не уводит фокус", () => {
    const { content } = parts(mount({ value: "<p>A</p>" }));
    content.focus();
    caret(content, "A", 1);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(tab);
    flushSync();
    expect(tab.defaultPrevented).toBe(true);
    expect(content.textContent).toContain("\t");

    const shiftTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(false);
  });

  it("align проставляет data-align на блоке", () => {
    const { root, content } = parts(mount({ value: "<p>Text</p>" }));
    caret(content, "Text", 2);
    click(toolbarButton(root, "align-center"));
    expect(content.querySelector("p")?.getAttribute("data-align")).toBe("center");
  });

  it("undo/redo работают на снапшотах HTML и каретки", () => {
    const { root, content } = parts(mount({ value: "<p>Hello</p>" }));
    selectText(content, "Hello");
    click(toolbarButton(root, "bold"));
    expect(content.innerHTML).toBe("<p><strong>Hello</strong></p>");

    fireKey(content, { key: "z", ctrlKey: true });
    expect(content.innerHTML).toBe("<p>Hello</p>");

    fireKey(content, { key: "z", ctrlKey: true, shiftKey: true });
    expect(content.innerHTML).toBe("<p><strong>Hello</strong></p>");
  });

  it("Ctrl/Cmd+B применяет bold без кнопки тулбара", () => {
    const { content } = parts(mount({ value: "<p>Hello</p>" }));
    selectText(content, "Hello");
    fireKey(content, { key: "b", ctrlKey: true });
    expect(content.innerHTML).toBe("<p><strong>Hello</strong></p>");
  });

  it("indent вкладывает li в предыдущий sibling, первый li не меняется", () => {
    const { root, content } = parts(
      mount({ value: "<ul><li>A</li><li>B</li><li>C</li></ul>" }),
    );
    caret(content, "B", 0);
    click(toolbarButton(root, "indent"));
    expect(content.innerHTML).toBe(
      "<ul><li>A<ul><li>B</li></ul></li><li>C</li></ul>",
    );

    const first = parts(mount({ value: "<ul><li>A</li><li>B</li></ul>" }));
    caret(first.content, "A", 0);
    click(toolbarButton(first.root, "indent"));
    expect(first.content.innerHTML).toBe("<ul><li>A</li><li>B</li></ul>");
  });

  it("outdent первого ребёнка сохраняет порядок и тип списка", () => {
    const { root, content } = parts(
      mount({
        value: "<ul><li>A<ul><li>B</li><li>C</li></ul></li><li>D</li></ul>",
      }),
    );
    caret(content, "B", 0);
    click(toolbarButton(root, "outdent"));
    expect(content.innerHTML).toBe(
      "<ul><li>A</li><li>B<ul><li>C</li></ul></li><li>D</li></ul>",
    );
  });

  it("Tab/Shift+Tab в списке делают indent/outdent", () => {
    const { content } = parts(
      mount({ value: "<ul><li>A</li><li>B</li></ul>" }),
    );
    caret(content, "B", 0);
    fireKey(content, { key: "Tab" });
    expect(content.innerHTML).toBe("<ul><li>A<ul><li>B</li></ul></li></ul>");

    const shiftTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(shiftTab);
    flushSync();
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(content.innerHTML).toBe("<ul><li>A</li><li>B</li></ul>");
  });

  it("h2 применяется ко всем абзацам выделения", () => {
    const { root, content } = parts(
      mount({ value: "<p>One</p><p>Two</p><p>Three</p>" }),
    );
    selectRange(content, "One", 0, "Three", 5);
    click(toolbarButton(root, "h2"));
    expect(content.innerHTML).toBe(
      "<h2>One</h2><h2>Two</h2><h2>Three</h2>",
    );
  });

  it("h2 по выделению li поднимает все пункты без потери порядка", () => {
    const { root, content } = parts(
      mount({
        value: "<ul><li>One</li><li>Two</li><li>Three</li></ul>",
      }),
    );
    selectRange(content, "One", 0, "Three", 5);
    click(toolbarButton(root, "h2"));
    expect(content.innerHTML).toBe("<h2>One</h2><h2>Two</h2><h2>Three</h2>");
    expect(content.querySelector("ul")).toBeNull();
  });

  it("align применяется ко всем блокам выделения", () => {
    const { root, content } = parts(
      mount({ value: "<p>One</p><p>Two</p><p>Three</p>" }),
    );
    selectRange(content, "One", 0, "Three", 5);
    click(toolbarButton(root, "align-center"));
    for (const block of content.querySelectorAll("p")) {
      expect(block.getAttribute("data-align")).toBe("center");
    }
  });

  it("ul объединяет несколько абзацев в один список без дублей", () => {
    const { root, content } = parts(
      mount({ value: "<p>One</p><p>Two</p><p>Three</p>" }),
    );
    selectRange(content, "One", 0, "Three", 5);
    click(toolbarButton(root, "ul"));
    expect(content.innerHTML).toBe(
      "<ul><li>One</li><li>Two</li><li>Three</li></ul>",
    );
    expect(content.querySelectorAll("ul")).toHaveLength(1);
    expect(content.querySelectorAll("li")).toHaveLength(3);
  });

  it("ul склеивает абзацы вокруг существующего списка в один список", () => {
    const { root, content } = parts(
      mount({
        value:
          "<p>Before</p><ul><li>One</li><li>Two</li></ul><p>After</p>",
      }),
    );
    selectRange(content, "Before", 0, "After", 5);
    click(toolbarButton(root, "ul"));
    expect(content.innerHTML).toBe(
      "<ul><li>Before</li><li>One</li><li>Two</li><li>After</li></ul>",
    );
    expect(content.querySelectorAll("ul")).toHaveLength(1);
    expect(content.querySelectorAll("li")).toHaveLength(4);
  });

  it("повторный ul по выделению поднимает все li без дублей", () => {
    const { root, content } = parts(
      mount({
        value: "<ul><li>One</li><li>Two</li><li>Three</li></ul>",
      }),
    );
    selectRange(content, "One", 0, "Three", 5);
    click(toolbarButton(root, "ul"));
    expect(content.innerHTML).toBe("<p>One</p><p>Two</p><p>Three</p>");
  });

  it("ol по выделению ul меняет тип одного списка", () => {
    const { root, content } = parts(
      mount({
        value: "<ul><li>One</li><li>Two</li><li>Three</li></ul>",
      }),
    );
    selectRange(content, "One", 0, "Three", 5);
    click(toolbarButton(root, "ol"));
    expect(content.innerHTML).toBe(
      "<ol><li>One</li><li>Two</li><li>Three</li></ol>",
    );
  });

  it("clear снимает inline-форматирование со всех выбранных блоков", () => {
    const { root, content } = parts(
      mount({
        value:
          "<p><strong>One</strong></p><p><em>Two</em></p><p><u>Three</u></p>",
      }),
    );
    selectRange(content, "One", 0, "Three", 5);
    click(toolbarButton(root, "clear"));
    expect(content.innerHTML).toBe("<p>One</p><p>Two</p><p>Three</p>");
  });

  it("clear превращает заголовки, списки и цитаты в абзацы", () => {
    const { root, content } = parts(
      mount({
        value:
          "<h2>One</h2><ul><li>Two</li></ul><blockquote>Three</blockquote>",
      }),
    );
    selectRange(content, "One", 0, "Three", 5);
    click(toolbarButton(root, "clear"));
    expect(content.innerHTML).toBe("<p>One</p><p>Two</p><p>Three</p>");
  });
});

describe("RichTextEditor: IME-композиция", () => {
  it("input внутри композиции не эмитит и не пересоздаёт DOM", () => {
    const changes: string[] = [];
    const { content, hidden } = parts(
      mount({
        value: "<p>start</p>",
        onValueChange: (html: string) => changes.push(html),
      }),
    );
    const paragraph = content.querySelector("p");
    const text = paragraph?.firstChild as Text;

    content.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    text.data = "你好";
    const composingInput = new InputEvent("input", { bubbles: true });
    Object.defineProperty(composingInput, "isComposing", { value: true });
    content.dispatchEvent(composingInput);
    flushSync();

    expect(changes).toEqual([]);
    expect(content.querySelector("p")).toBe(paragraph);
    expect(content.querySelector("p")?.firstChild).toBe(text);

    content.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "你好" }),
    );
    flushSync();

    expect(changes).toEqual(["<p>你好</p>"]);
    expect(hidden.value).toBe("<p>你好</p>");
    expect(content.querySelector("p")).toBe(paragraph);
    expect(content.querySelector("p")?.firstChild).toBe(text);

    fireKey(content, { key: "z", ctrlKey: true });
    expect(content.innerHTML).toBe("<p>start</p>");
  });

  it("keydown-команды не выполняются во время композиции", () => {
    const { content } = parts(mount({ value: "<p>Hello</p>" }));
    selectText(content, "Hello");
    content.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    fireKey(content, { key: "b", ctrlKey: true });
    expect(content.querySelector("strong")).toBeNull();
    content.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "" }),
    );
    expect(content.querySelector("strong")).toBeNull();
  });
});

describe("RichTextEditor: ссылки", () => {
  it("открывает inline-панель, применяет и удаляет ссылку", () => {
    const { root, content, hidden } = parts(
      mount({ value: "<p>link text</p>" }),
    );
    selectText(content, "link text");
    click(toolbarButton(root, "link"));

    const panel = root.querySelector<HTMLElement>(".sui-rte__link-panel");
    expect(panel).not.toBeNull();
    const input = panel?.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    expect(toolbarButton(root, "link").getAttribute("aria-expanded")).toBe("true");

    input!.value = "https://example.com/page";
    fireInput(input!);
    const apply = Array.from(panel!.querySelectorAll("button")).find(
      (button) => button.textContent === "Применить",
    );
    expect(apply).toBeTruthy();
    click(apply!);

    const anchor = content.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("https://example.com/page");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.textContent).toBe("link text");
    expect(hidden.value).toContain('href="https://example.com/page"');

    // Повторно открываем панель внутри ссылки и удаляем её.
    selectText(content, "link text");
    click(toolbarButton(root, "link"));
    const secondPanel = root.querySelector<HTMLElement>(".sui-rte__link-panel");
    const remove = Array.from(secondPanel!.querySelectorAll("button")).find(
      (button) => button.textContent === "Удалить",
    );
    click(remove!);
    expect(content.querySelector("a")).toBeNull();
    expect(content.innerHTML).toBe("<p>link text</p>");
  });

  it("не применяет опасный href и показывает ошибку", () => {
    const { root, content } = parts(mount({ value: "<p>text</p>" }));
    selectText(content, "text");
    click(toolbarButton(root, "link"));
    const panel = root.querySelector<HTMLElement>(".sui-rte__link-panel");
    const input = panel?.querySelector<HTMLInputElement>("input");
    input!.value = "javascript:alert(1)";
    fireInput(input!);
    const apply = Array.from(panel!.querySelectorAll("button")).find(
      (button) => button.textContent === "Применить",
    );
    click(apply!);

    expect(content.querySelector("a")).toBeNull();
    expect(panel?.querySelector('[role="alert"]')?.textContent).toContain(
      "безопасную ссылку",
    );
    expect(input?.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("RichTextEditor: вставка", () => {
  it("paste HTML санитайзит и вставляет, paste текста экранирует", () => {
    const { content } = parts(mount({ value: "<p>start</p>" }));
    caret(content, "start", 5);
    const clipboard = {
      getData: (type: string) =>
        type === "text/html"
          ? "<b>bold</b><img src=x onerror=alert(1)><script>x</script>"
          : "",
    };
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    content.dispatchEvent(paste);
    flushSync();
    expect(content.innerHTML).toBe("<p>start<b>bold</b></p>");

    caret(content, "start", 5);
    const textClipboard = {
      getData: (type: string) => (type === "text/plain" ? "<i>x</i>\ny" : ""),
    };
    const textPaste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(textPaste, "clipboardData", { value: textClipboard });
    content.dispatchEvent(textPaste);
    flushSync();
    expect(content.innerHTML).toBe(
      "<p>start&lt;i&gt;x&lt;/i&gt;<br>y<b>bold</b></p>",
    );
  });
});
