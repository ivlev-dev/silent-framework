import type { Children, ClassNameValue } from "@ivlev-dev/silent-core";
import { createContext, Provider } from "@ivlev-dev/silent-core";
import {
  DEFAULT_LOCALE,
  defaultUiStrings,
  type UiStrings,
} from "./strings.js";
import type { ThemeMode } from "./apply-theme.js";

/** Конфигурация UI-дерева: строки, локаль, тема, плотность. */
export interface UiConfig {
  readonly strings: UiStrings;
  readonly locale: string;
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  strings: defaultUiStrings,
  locale: DEFAULT_LOCALE,
};

/**
 * Контекст конфигурации. Значение по умолчанию — RU-строки, поэтому
 * компоненты работают и без провайдера (в том числе в SSR).
 */
export const uiConfigContext = createContext<UiConfig>({
  name: "UiConfig",
  defaultValue: DEFAULT_UI_CONFIG,
});

/** Текущая конфигурация. Безопасно вызывать на сервере. */
export function useUiConfig(): UiConfig {
  return uiConfigContext.get();
}

export interface UiConfigProviderProps {
  readonly strings?: Partial<UiStrings> | undefined;
  readonly locale?: string | undefined;
  /** Тема поддерева: `light`, `dark` или `auto` (системная). */
  readonly theme?: ThemeMode | undefined;
  readonly density?: "compact" | "default" | "comfortable" | undefined;
  readonly class?: ClassNameValue;
  readonly children?: Children;
}

/**
 * Провайдер конфигурации. Рендерит один `display: contents`-контейнер, чтобы
 * лёгкие компоненты сохраняли контракт «один корень», и позволяет локально
 * переопределить тему/плотность поддерева.
 */
export function UiConfigProvider(props: UiConfigProviderProps): Node {
  const strings: UiStrings = { ...defaultUiStrings, ...props.strings };
  const config: UiConfig = {
    strings,
    locale: props.locale ?? DEFAULT_LOCALE,
  };
  return (
    <div
      class={["sui-provider", props.class]}
      data-theme={props.theme}
      data-density={props.density === "default" ? undefined : props.density}
    >
      <Provider context={uiConfigContext} value={config}>
        {props.children}
      </Provider>
    </div>
  );
}
