import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { KeyedList } from "../../internal/keyed-list.js";
import { resolveSlot } from "../../internal/slot.js";
import { useUiConfig } from "../../theme/config.js";

export interface BreadcrumbItemData {
  readonly key: string;
  readonly label: Children;
  readonly href?: string | undefined;
  /** Ленивый слот для SSR: `icon: () => <HomeIcon />`. */
  readonly icon?: Children;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
}

export interface BreadcrumbItemProps {
  readonly href?: string | undefined;
  /** Текущая страница: `aria-current="page"`. */
  readonly current?: boolean | undefined;
  readonly icon?: Children;
  /** Разделитель перед пунктом; по умолчанию `/`. */
  readonly separator?: Children;
  /** Показывать разделитель (все пункты, кроме первого). */
  readonly showSeparator?: boolean | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly children?: Children;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/** Пункт хлебных крошек. Ссылка при `href`, иначе текст с `aria-current`. */
export function BreadcrumbItem(props: BreadcrumbItemProps): Node {
  const current = props.current === true;

  if (props.href !== undefined) {
    return (
      <li
        {...props.attrs}
        ref={props.ref}
        class={["sui-breadcrumbs__item", props.class]}
        style={props.style}
        data-current={current ? "" : undefined}
      >
        {props.showSeparator === true ? (
          <span class="sui-breadcrumbs__separator" aria-hidden="true">
            {props.separator ?? "/"}
          </span>
        ) : null}
        {props.icon !== undefined && props.icon !== null ? (
          <span class="sui-breadcrumbs__icon" aria-hidden="true">
            {resolveSlot(props.icon)}
          </span>
        ) : null}
        <a
          class="sui-breadcrumbs__link"
          href={props.href}
          aria-current={current ? "page" : undefined}
          onClick={(event) => {
            props.onClick?.(event);
          }}
        >
          {resolveSlot(props.children)}
        </a>
      </li>
    );
  }

  return (
    <li
      {...props.attrs}
      ref={props.ref}
      class={["sui-breadcrumbs__item", props.class]}
      style={props.style}
      data-current={current ? "" : undefined}
    >
      {props.showSeparator === true ? (
        <span class="sui-breadcrumbs__separator" aria-hidden="true">
          {props.separator ?? "/"}
        </span>
      ) : null}
      {props.icon !== undefined && props.icon !== null ? (
        <span class="sui-breadcrumbs__icon" aria-hidden="true">
          {resolveSlot(props.icon)}
        </span>
      ) : null}
      <span
        class="sui-breadcrumbs__text"
        aria-current={current ? "page" : undefined}
      >
        {resolveSlot(props.children)}
      </span>
    </li>
  );
}

export interface BreadcrumbsProps {
  readonly items: readonly BreadcrumbItemData[];
  /**
   * Максимум видимых пунктов. При превышении середина сворачивается в `…`
   * без JS-измерений: первый блок, многоточие и последний пункт.
   * Значения меньше `3` не сворачивают цепочку.
   */
  readonly maxItems?: number | undefined;
  /** Разделитель между пунктами; по умолчанию `/`. */
  readonly separator?: Children;
  /** Доступное имя `nav`; по умолчанию — `Хлебные крошки`. */
  readonly label?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

type CrumbEntry =
  | {
      readonly kind: "item";
      readonly key: string;
      readonly item: BreadcrumbItemData;
      readonly current: boolean;
    }
  | { readonly kind: "ellipsis"; readonly key: string };

/**
 * Хлебные крошки: `nav` + `ol`, разделители, `aria-current="page"` у
 * последнего пункта. Сворачивание — только через `maxItems`.
 */
export function Breadcrumbs(props: BreadcrumbsProps): Node {
  const config = useUiConfig();

  const visible = (): CrumbEntry[] => {
    const items = props.items;
    const max = props.maxItems;
    const last = items.length - 1;
    if (max === undefined || max < 3 || items.length <= max) {
      return items.map((item, index) => ({
        kind: "item" as const,
        key: item.key,
        item,
        current: index === last,
      }));
    }
    const head = items.slice(0, max - 2);
    const tail = items[last];
    const entries: CrumbEntry[] = head.map((item, index) => ({
      kind: "item",
      key: item.key,
      item,
      current: false,
    }));
    entries.push({ kind: "ellipsis", key: "breadcrumbs-ellipsis" });
    if (tail !== undefined) {
      entries.push({ kind: "item", key: tail.key, item: tail, current: true });
    }
    return entries;
  };

  return (
    <nav
      {...props.attrs}
      ref={props.ref}
      class={["sui-breadcrumbs", props.class]}
      style={props.style}
      aria-label={props.label ?? config.strings.breadcrumbs}
    >
      <ol class="sui-breadcrumbs__list">
        <KeyedList
          each={visible}
          keyOf={(entry) => entry.kind === "ellipsis" ? entry.key : entry.item.key}
        >
          {(entry, index) => (
            <Show
              when={entry.kind === "item"}
              fallback={
                <li
                  class="sui-breadcrumbs__item"
                  data-ellipsis=""
                  aria-hidden="true"
                >
                  <Show when={index() > 0}>
                    <span class="sui-breadcrumbs__separator" aria-hidden="true">
                      {props.separator ?? "/"}
                    </span>
                  </Show>
                  <span class="sui-breadcrumbs__ellipsis" aria-hidden="true">
                    …
                  </span>
                </li>
              }
            >
              {entry.kind === "item" ? (
                <BreadcrumbItem
                  href={entry.item.href}
                  icon={entry.item.icon}
                  current={entry.current}
                  showSeparator={index() > 0}
                  separator={props.separator}
                  onClick={entry.item.onClick}
                >
                  {entry.item.label}
                </BreadcrumbItem>
              ) : null}
            </Show>
          )}
        </KeyedList>
      </ol>
    </nav>
  );
}
