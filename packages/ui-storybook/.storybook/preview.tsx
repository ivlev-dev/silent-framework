import type { Preview } from "@storybook/html-vite";
import { mountStory } from "../src/silent-story.js";
import "@ivlev-dev/silent-ui/styles.css";
import "./preview.css";
import "./preview-docs.css";

/**
 * Storybook 10 передаёт в `renderToCanvas` render-context: `storyFn`, `showMain`
 * и вложенный `storyContext` с `args`/`globals`. Поля описаны локально,
 * потому что публичный тип `RenderContext` не покрывает `storyContext`.
 */
interface RenderToCanvasContext {
  readonly storyFn?: unknown;
  readonly showMain?: (() => void) | undefined;
  readonly args?: Record<string, unknown> | undefined;
  readonly globals?: Record<string, unknown> | undefined;
  readonly storyContext?:
    | {
        readonly args?: Record<string, unknown> | undefined;
        readonly globals?: Record<string, unknown> | undefined;
      }
    | undefined;
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Тема дизайн-системы",
      toolbar: {
        title: "Тема",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
          { value: "auto", title: "System (auto)" },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: "Плотность контролов",
      toolbar: {
        title: "Плотность",
        icon: "component",
        items: [
          { value: "compact", title: "Compact" },
          { value: "default", title: "Default" },
          { value: "comfortable", title: "Comfortable" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
    density: "default",
  },
  parameters: {
    layout: "fullscreen",
    controls: {
      expanded: true,
      matchers: { color: /(background|color)$/i, date: /Date$/i },
      // Обязательные props — первыми в таблице controls.
      sort: "requiredFirst",
    },
    docs: {
      toc: true,
      canvas: { sourceState: "shown" },
    },
    backgrounds: {
      options: {
        surface: { name: "surface", value: "var(--sui-color-surface)" },
        dim: { name: "surface-dim", value: "var(--sui-color-surface-dim)" },
        inverse: { name: "inverse-surface", value: "var(--sui-color-inverse-surface)" },
      },
    },
    viewport: {
      options: {
        mobile360: {
          name: "Mobile 360×800",
          styles: { width: "360px", height: "800px" },
          type: "mobile",
        },
        tablet600: {
          name: "Tablet 600×960",
          styles: { width: "600px", height: "960px" },
          type: "tablet",
        },
        tablet840: {
          name: "Tablet 840×1112",
          styles: { width: "840px", height: "1112px" },
          type: "tablet",
        },
        desktop1200: {
          name: "Desktop 1200×900",
          styles: { width: "1200px", height: "900px" },
          type: "desktop",
        },
        desktop1600: {
          name: "Desktop 1600×1000",
          styles: { width: "1600px", height: "1000px" },
          type: "desktop",
        },
        wide2560: {
          name: "Wide 2560×1440",
          styles: { width: "2560px", height: "1440px" },
          type: "desktop",
        },
      },
    },
    a11y: {
      config: {
        rules: [{ id: "color-contrast", enabled: true }],
      },
    },
  },
  /**
   * Кастомный `renderToCanvas` вместо дефолтного: тот просто чистит innerHTML
   * и теряет подписки. Здесь story монтируется через `createComponent`,
   * а перед следующей story предыдущий handle получает `dispose()`.
   */
  renderToCanvas(rawContext, canvasElement) {
    const context = rawContext as unknown as RenderToCanvasContext;
    const storyContext = context.storyContext ?? context;
    const globals = storyContext.globals ?? {};
    const theme = typeof globals["theme"] === "string" ? globals["theme"] : "light";
    const density = typeof globals["density"] === "string" ? globals["density"] : undefined;
    const args = storyContext.args ?? context.args ?? {};
    mountStory(context.storyFn, args, canvasElement, {
      theme,
      ...(density !== undefined ? { density } : {}),
    });
    context.showMain?.();
  },
};

export default preview;
