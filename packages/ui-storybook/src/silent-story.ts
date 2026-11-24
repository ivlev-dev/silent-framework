import type { ComponentResult, AnyComponent } from "@ivlev-dev/silent-core";
import { createComponent } from "@ivlev-dev/silent-core";

/** Метка: функция создана через `silentStory`. */
export const SILENT_STORY = Symbol.for("silent.ui.story");

export type StoryArgs = object;

export type StoryRender<Args extends StoryArgs> = (args: Args) => Node;

/**
 * Story-render для CSF: помечает функцию как Silent-компонент, чтобы
 * `mountStory` знал, что результат можно монтировать через `createComponent`
 * и затем корректно освободить.
 */
export function silentStory<Args extends StoryArgs>(
  render: StoryRender<Args>,
): StoryRender<Args> {
  const story: StoryRender<Args> = (args) => render(args);
  Object.defineProperty(story, SILENT_STORY, { value: true, enumerable: false });
  return story;
}

let activeHandles = new Set<ComponentResult>();
const canvasHandles = new WeakMap<Element, ComponentResult>();

/**
 * Освобождает story: эффекты, ref-колбэки, подписки.
 *
 * Без аргумента — все смонтированные stories (после каждого теста). С
 * аргументом — только конкретный canvas: Docs-страница монтирует несколько
 * Canvas одновременно, и общий «последний» handle стирал бы предыдущие.
 */
export function disposeStory(canvasElement?: Element): void {
  if (canvasElement !== undefined) {
    const result = canvasHandles.get(canvasElement);
    if (result !== undefined) {
      result.dispose();
      canvasHandles.delete(canvasElement);
      activeHandles.delete(result);
    }
    return;
  }
  for (const result of activeHandles) result.dispose();
  activeHandles = new Set();
}

export interface MountStoryOptions {
  readonly theme?: string | undefined;
  readonly density?: string | undefined;
  readonly padding?: string | undefined;
}

/**
 * Монтирует story через `createComponent` и запоминает handle.
 * Перед следующей story `disposeStory()` снимет эффекты и DOM.
 */
export function mountStory(
  story: unknown,
  args: Record<string, unknown> | undefined,
  canvasElement: Element,
  options: MountStoryOptions = {},
): ComponentResult | null {
  disposeStory(canvasElement);
  if (typeof story !== "function") {
    canvasElement.replaceChildren();
    return null;
  }
  let result: ComponentResult;
  try {
    result = createComponent(story as AnyComponent, args ?? {});
  } catch (error) {
    canvasElement.replaceChildren();
    throw error;
  }
  // Handle привязан к canvas: Docs может держать несколько Canvas сразу.
  canvasHandles.set(canvasElement, result);
  activeHandles.add(result);

  const wrapper = document.createElement("div");
  wrapper.className = "sui-story-canvas";
  wrapper.setAttribute("data-theme", options.theme ?? "light");
  if (options.density !== undefined) wrapper.setAttribute("data-density", options.density);
  if (options.padding !== undefined) wrapper.style.padding = options.padding;
  wrapper.appendChild(result.node);
  canvasElement.replaceChildren(wrapper);
  return result;
}
