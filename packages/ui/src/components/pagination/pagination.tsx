import type { ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import { KeyedList } from "../../internal/keyed-list.js";
import { Icon } from "../icon/icon.js";
import { useUiConfig } from "../../theme/config.js";

export type PaginationToken = number | "ellipsis-start" | "ellipsis-end";
export type PaginationSize = "sm" | "md";

export interface PaginationProps {
  /** Текущая страница, `1..pageCount`. */
  readonly page: number;
  readonly pageCount: number;
  readonly onChange?: ((page: number) => void) | undefined;
  /** Сколько соседних страниц показывать слева и справа (0–1). */
  readonly siblingCount?: number | undefined;
  /** Кнопки «в начало» и «в конец». По умолчанию `true`. */
  readonly showEdges?: boolean | undefined;
  /** Плотность кнопок: `sm` для тулбаров и подвала таблицы. */
  readonly size?: PaginationSize | undefined;
  readonly disabled?: boolean | undefined;
  /** Доступное имя `nav`; по умолчанию — `Постраничная навигация`. */
  readonly label?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

const MAX_SIBLINGS = 1;

function normalizeSiblings(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_SIBLINGS;
  return Math.min(MAX_SIBLINGS, Math.max(0, Math.trunc(value)));
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
  const siblings = normalizeSiblings(siblingCount);
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

function Chevron(props: {
  readonly direction: "previous" | "next" | "first" | "last";
}): Node {
  const previousPath = "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z";
  const nextPath = "M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z";
  const paths =
    props.direction === "first"
      ? [previousPath, "M20.41 7.41 19 6l-6 6 6 6 1.41-1.41L15.83 12z"]
      : props.direction === "last"
        ? [nextPath, "M3.59 16.59 5 18l6-6-6-6-1.41 1.41L8.17 12z"]
        : [props.direction === "previous" ? previousPath : nextPath];
  return (
    <Icon size="sm">
      {paths.map((path) => (
        <path d={path} />
      ))}
    </Icon>
  );
}

/**
 * Постраничная навигация: компактный ряд «в начало», «назад», номеров
 * страниц, «вперёд» и «в конец». `siblingCount` ограничен 0–1, на узких
 * экранах многоточия и крайние кнопки скрываются, ряд не переносится.
 */
export function Pagination(props: PaginationProps): Node {
  const config = useUiConfig();
  const count = (): number =>
    Number.isFinite(props.pageCount) ? Math.max(0, Math.trunc(props.pageCount)) : 0;
  const current = (): number => {
    const rawPage = Number.isFinite(props.page) ? Math.trunc(props.page) : 1;
    return count() === 0 ? 1 : Math.min(Math.max(rawPage, 1), count());
  };
  const disabled = props.disabled === true;
  const showEdges = props.showEdges !== false;

  const go = (next: number): void => {
    if (disabled || next < 1 || next > count() || next === current()) return;
    props.onChange?.(next);
  };

  const arrow = (
    direction: "first" | "previous" | "next" | "last",
    label: string,
    target: number,
    isDisabled: boolean,
  ): Node => (
    <li class="sui-pagination__item">
      <button
        class="sui-pagination__arrow"
        type="button"
        data-direction={direction}
        aria-label={label}
        disabled={disabled || isDisabled}
        onClick={() => {
          go(target);
        }}
      >
        <Chevron direction={direction} />
      </button>
    </li>
  );

  return (
    <nav
      {...props.attrs}
      ref={props.ref}
      class={["sui-pagination", props.class]}
      style={props.style}
      aria-label={props.label ?? config.strings.pagination}
      data-size={props.size ?? "md"}
      data-disabled={disabled ? "" : undefined}
    >
      <ul class="sui-pagination__list">
        <Show when={showEdges}>
          {arrow("first", "Первая страница", 1, current() <= 1)}
        </Show>
        {arrow("previous", config.strings.previousPage, current() - 1, current() <= 1)}
        <KeyedList each={() => paginationRange(current(), count(), props.siblingCount)} keyOf={tokenKey}>
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
                  data-current={token === current() ? "" : undefined}
                  aria-current={token === current() ? "page" : undefined}
                  aria-label={formatStatus(
                    config.strings.pageStatus,
                    typeof token === "number" ? token : current(),
                    count(),
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
        {arrow("next", config.strings.nextPage, current() + 1, current() >= count())}
        <Show when={showEdges}>
          {arrow("last", "Последняя страница", count(), current() >= count())}
        </Show>
      </ul>
      <Show when={count() > 0}>
        <span class="sui-pagination__status" aria-live="polite">
          {formatStatus(config.strings.pageStatus, current(), count())}
        </span>
      </Show>
    </nav>
  );
}
