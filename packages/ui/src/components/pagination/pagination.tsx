import type { ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { KeyedList } from "../../internal/keyed-list.js";
import { Icon } from "../icon/icon.js";
import { useUiConfig } from "../../theme/config.js";

export type PaginationToken = number | "ellipsis-start" | "ellipsis-end";

export interface PaginationProps {
  /** Текущая страница, `1..pageCount`. */
  readonly page: number;
  readonly pageCount: number;
  readonly onChange?: ((page: number) => void) | undefined;
  /** Сколько соседних страниц показывать слева и справа (по умолчанию `1`). */
  readonly siblingCount?: number | undefined;
  readonly disabled?: boolean | undefined;
  /** Доступное имя `nav`; по умолчанию — `Постраничная навигация`. */
  readonly label?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

/**
 * Диапазон страниц с многоточиями. Первая и последняя страница видны всегда,
 * число кнопок стабильно: `2 * siblingCount + 5`.
 */
export function paginationRange(
  page: number,
  pageCount: number,
  siblingCount = 1,
): PaginationToken[] {
  if (pageCount <= 0) return [];
  const siblings = Math.max(0, Math.trunc(siblingCount));
  const capacity = siblings * 2 + 5;
  if (pageCount <= capacity) {
    return Array.from({ length: pageCount }, (_value, index) => index + 1);
  }

  const current = Math.min(Math.max(Math.trunc(page), 1), pageCount);
  const windowStart = current - siblings;
  const windowEnd = current + siblings;
  let start: number;
  let end: number;

  if (windowStart <= 2) {
    start = 2;
    end = Math.min(Math.max(windowEnd, 3 + siblings * 2), pageCount - 1);
  } else if (windowEnd >= pageCount - 1) {
    end = pageCount - 1;
    start = Math.max(Math.min(windowStart, pageCount - (2 + siblings * 2)), 2);
  } else {
    start = windowStart;
    end = windowEnd;
  }

  const tokens: PaginationToken[] = [1];
  if (start > 2) tokens.push("ellipsis-start");
  for (let value = start; value <= end; value += 1) tokens.push(value);
  if (end < pageCount - 1) tokens.push("ellipsis-end");
  tokens.push(pageCount);
  return tokens;
}

function formatStatus(template: string, page: number, pageCount: number): string {
  return template
    .replace("{page}", String(page))
    .replace("{pageCount}", String(pageCount));
}

function tokenKey(token: PaginationToken): string {
  return typeof token === "number" ? `page-${token}` : token;
}

function Chevron(props: { readonly direction: "previous" | "next" }): Node {
  return (
    <Icon size="sm">
      <path
        d={
          props.direction === "previous"
            ? "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"
            : "M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"
        }
      />
    </Icon>
  );
}

/**
 * Постраничная навигация: номер страницы, `siblingCount`, многоточия,
 * стрелки, `aria-current="page"`, RU-подписи из `UiConfigProvider`.
 */
export function Pagination(props: PaginationProps): Node {
  const config = useUiConfig();
  const count = Number.isFinite(props.pageCount)
    ? Math.max(0, Math.trunc(props.pageCount))
    : 0;
  const rawPage = Number.isFinite(props.page) ? Math.trunc(props.page) : 1;
  const current = count === 0 ? 1 : Math.min(Math.max(rawPage, 1), count);
  const disabled = props.disabled === true;

  const go = (next: number): void => {
    if (disabled || next < 1 || next > count || next === current) return;
    props.onChange?.(next);
  };

  return (
    <nav
      {...props.attrs}
      ref={props.ref}
      class={["sui-pagination", props.class]}
      style={props.style}
      aria-label={props.label ?? config.strings.pagination}
      data-disabled={disabled ? "" : undefined}
    >
      <ul class="sui-pagination__list">
        <li class="sui-pagination__item">
          <button
            class="sui-pagination__arrow"
            type="button"
            data-direction="previous"
            aria-label={config.strings.previousPage}
            disabled={disabled || current <= 1}
            onClick={() => {
              go(current - 1);
            }}
          >
            <Chevron direction="previous" />
          </button>
        </li>
        <KeyedList each={() => paginationRange(current, count, props.siblingCount ?? 1)} keyOf={tokenKey}>
          {(token) => (
            <Show
              when={typeof token === "number"}
              fallback={
                <li class="sui-pagination__item" data-ellipsis="" aria-hidden="true">
                  <span class="sui-pagination__ellipsis">…</span>
                </li>
              }
            >
              <li class="sui-pagination__item">
                <button
                  class="sui-pagination__page"
                  type="button"
                  data-current={token === current ? "" : undefined}
                  aria-current={token === current ? "page" : undefined}
                  aria-label={formatStatus(
                    config.strings.pageStatus,
                    typeof token === "number" ? token : current,
                    count,
                  )}
                  disabled={disabled}
                  onClick={() => {
                    if (typeof token === "number") go(token);
                  }}
                >
                  {token}
                </button>
              </li>
            </Show>
          )}
        </KeyedList>
        <li class="sui-pagination__item">
          <button
            class="sui-pagination__arrow"
            type="button"
            data-direction="next"
            aria-label={config.strings.nextPage}
            disabled={disabled || current >= count}
            onClick={() => {
              go(current + 1);
            }}
          >
            <Chevron direction="next" />
          </button>
        </li>
      </ul>
      <Show when={count > 0}>
        <span class="sui-pagination__status" aria-live="polite">
          {formatStatus(config.strings.pageStatus, current, count)}
        </span>
      </Show>
    </nav>
  );
}
