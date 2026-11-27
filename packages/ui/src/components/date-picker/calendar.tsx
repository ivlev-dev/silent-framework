import { For, Show, createSignal } from "@ivlev-dev/silent-core";
import { trapTab } from "../../internal/overlay.js";
import { clientEffect } from "../../internal/overlay.js";
import {
  addDays,
  addMonths,
  buildWeeks,
  compareDays,
  dateKey,
  dateLabels,
  endOfWeek,
  formatDateValue,
  fullDateLabel,
  isDateDisabled,
  isSameDay,
  isSameMonth,
  maxDay,
  minDay,
  monthName,
  monthYearLabel,
  normalizeDate,
  resolveWeekStart,
  startOfDay,
  startOfMonth,
  startOfWeek,
  weekdayLabels,
} from "./date.js";

export type CalendarMode = "days" | "months" | "years";

export interface DateCalendarProps {
  readonly open: boolean;
  readonly viewMonth: Date;
  readonly onViewMonthChange: (month: Date) => void;
  readonly start: Date | null;
  readonly end?: Date | null | undefined;
  readonly preview?: Date | null | undefined;
  readonly range?: boolean | undefined;
  readonly min?: Date | undefined;
  readonly max?: Date | undefined;
  readonly locale: string;
  readonly firstDayOfWeek?: number | undefined;
  readonly onSelect: (date: Date) => void;
  readonly onHover?: ((date: Date | null) => void) | undefined;
  readonly focusOnOpen?: boolean | undefined;
  readonly focusDate?: Date | null | undefined;
  readonly label?: string | undefined;
}

const MONTH_INDEXES: readonly number[] = Array.from(
  { length: 12 },
  (_, index) => index,
);

function yearsFor(viewMonth: Date): readonly number[] {
  const start = Math.floor(viewMonth.getFullYear() / 12) * 12;
  return Array.from({ length: 12 }, (_, index) => start + index);
}

function firstEnabledInMonth(
  month: Date,
  min?: Date | undefined,
  max?: Date | undefined,
): Date | null {
  let candidate = startOfMonth(month);
  const end = addMonths(candidate, 1);
  while (compareDays(candidate, end) < 0) {
    if (!isDateDisabled(candidate, min, max)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return null;
}

export function DateCalendar(props: DateCalendarProps): Node {
  const locale = (): string => props.locale;
  const labels = (): ReturnType<typeof dateLabels> => dateLabels(locale());
  const weekStartsOn = (): number =>
    resolveWeekStart(locale(), props.firstDayOfWeek);
  const today = (): Date => startOfDay(new Date());
  const initialFocus = (): Date =>
    normalizeDate(props.focusDate)
    ?? normalizeDate(props.start)
    ?? normalizeDate(props.end)
    ?? today();

  const [mode, setMode] = createSignal<CalendarMode>("days");
  const [activeDate, setActiveDate] = createSignal<Date>(initialFocus());
  const [root, setRoot] = createSignal<HTMLElement | null>(null);

  const focusDay = (date: Date): void => {
    const element = root();
    if (element === null) return;
    const selector = `[data-date="${dateKey(date)}"]`;
    const target = element.querySelector<HTMLButtonElement>(selector);
    target?.focus({ preventScroll: true });
  };

  const deferFocusDay = (date: Date): void => {
    queueMicrotask(() => {
      focusDay(date);
    });
  };

  const firstAvailableInMonth = (month: Date): Date =>
    firstEnabledInMonth(month, props.min, props.max)
    ?? startOfMonth(month);

  let wasOpen = false;
  clientEffect(() => {
    if (!props.open) {
      wasOpen = false;
      return;
    }
    if (wasOpen) return;
    wasOpen = true;
    setMode("days");
    const focus = initialFocus();
    setActiveDate(focus);
    if (props.focusOnOpen === false) return;
    deferFocusDay(focus);
  });

  const shiftView = (direction: -1 | 1): void => {
    const currentMode = mode();
    if (currentMode === "years") {
      props.onViewMonthChange(addMonths(props.viewMonth, direction * 12 * 12));
      return;
    }
    if (currentMode === "months") {
      props.onViewMonthChange(addMonths(props.viewMonth, direction * 12));
      return;
    }
    const next = addMonths(props.viewMonth, direction);
    props.onViewMonthChange(startOfMonth(next));
    const available = firstAvailableInMonth(next);
    setActiveDate(available);
  };

  const focusPickerCell = (): void => {
    queueMicrotask(() => {
      root()
        ?.querySelector<HTMLButtonElement>(".sui-date-picker__picker-cell")
        ?.focus({ preventScroll: true });
    });
  };

  const openMonths = (): void => {
    setMode("months");
    focusPickerCell();
  };

  const openYears = (): void => {
    setMode("years");
    focusPickerCell();
  };

  const selectMonth = (month: number): void => {
    const next = new Date(props.viewMonth.getFullYear(), month, 1);
    props.onViewMonthChange(next);
    const available = firstAvailableInMonth(next);
    setActiveDate(available);
    setMode("days");
    deferFocusDay(available);
  };

  const selectYear = (year: number): void => {
    const next = new Date(year, props.viewMonth.getMonth(), 1);
    props.onViewMonthChange(next);
    setMode("months");
    focusPickerCell();
  };

  const selectDay = (date: Date): void => {
    if (isDateDisabled(date, props.min, props.max)) return;
    props.onSelect(startOfDay(date));
  };

  const nearestEnabled = (date: Date, step: number): Date => {
    let candidate = startOfDay(date);
    for (let index = 0; index < 370; index += 1) {
      if (!isDateDisabled(candidate, props.min, props.max)) return candidate;
      candidate = addDays(candidate, step);
    }
    return startOfDay(date);
  };

  const moveTo = (date: Date, step: number): void => {
    const next = nearestEnabled(date, step);
    setActiveDate(next);
    if (!isSameMonth(next, props.viewMonth)) {
      props.onViewMonthChange(startOfMonth(next));
    }
    deferFocusDay(next);
  };

  const handleDayKeyDown = (
    event: KeyboardEvent,
    date: Date,
  ): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    let next: Date | null = null;
    let step = 1;
    switch (event.key) {
      case "ArrowLeft":
        next = addDays(date, -1);
        step = -1;
        break;
      case "ArrowRight":
        next = addDays(date, 1);
        break;
      case "ArrowUp":
        next = addDays(date, -7);
        step = -1;
        break;
      case "ArrowDown":
        next = addDays(date, 7);
        break;
      case "Home":
        next = startOfWeek(date, weekStartsOn());
        step = -1;
        break;
      case "End":
        next = endOfWeek(date, weekStartsOn());
        break;
      case "PageUp":
        next = addMonths(date, event.shiftKey ? -12 : -1);
        step = -1;
        break;
      case "PageDown":
        next = addMonths(date, event.shiftKey ? 12 : 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectDay(date);
        return;
      default:
        return;
    }
    event.preventDefault();
    moveTo(next, step);
  };

  const rangeFrom = (): Date | null => {
    const start = normalizeDate(props.start);
    const end = normalizeDate(props.end) ?? normalizeDate(props.preview);
    if (start === null) return null;
    if (end === null) return start;
    return minDay(start, end);
  };

  const rangeTo = (): Date | null => {
    const start = normalizeDate(props.start);
    const end = normalizeDate(props.end) ?? normalizeDate(props.preview);
    if (start === null) return null;
    if (end === null) return null;
    return maxDay(start, end);
  };

  const isOutside = (date: Date): boolean => !isSameMonth(date, props.viewMonth);
  const isRange = (): boolean => props.range === true;

  const showDays = (): boolean => mode() === "days";

  return (
    <div
      ref={(node: Element | null) => {
        setRoot(node as HTMLElement | null);
      }}
      class="sui-date-picker__calendar"
      data-mode={mode()}
      aria-label={props.label ?? labels().selectDate}
      role="group"
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Tab") return;
        const panel = root()?.closest<HTMLElement>(".sui-popover__panel");
        if (panel !== null && panel !== undefined) trapTab(panel, event);
      }}
    >
      <div class="sui-date-picker__header">
        <button
          type="button"
          class="sui-date-picker__nav"
          aria-label={labels().previousMonth}
          onClick={() => {
            shiftView(-1);
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div class="sui-date-picker__heading">
          <Show when={showDays()}>
            <button
              type="button"
              class="sui-date-picker__title"
              aria-label={labels().chooseMonth}
              onClick={openMonths}
            >
              {monthName(props.viewMonth, "long", locale())}
            </button>
            <button
              type="button"
              class="sui-date-picker__title"
              aria-label={labels().chooseYear}
              onClick={openYears}
            >
              {String(props.viewMonth.getFullYear())}
            </button>
          </Show>
          <Show when={mode() === "months"}>
            <button
              type="button"
              class="sui-date-picker__title"
              aria-label={labels().chooseYear}
              onClick={openYears}
            >
              {String(props.viewMonth.getFullYear())}
            </button>
          </Show>
          <Show when={mode() === "years"}>
            <span class="sui-date-picker__title sui-date-picker__title--static">
              {`${yearsFor(props.viewMonth)[0]}—${yearsFor(props.viewMonth)[11]}`}
            </span>
          </Show>
        </div>
        <button
          type="button"
          class="sui-date-picker__nav"
          aria-label={labels().nextMonth}
          onClick={() => {
            shiftView(1);
          }}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <Show when={showDays()}>
        <div
          class="sui-date-picker__days"
          role="grid"
          aria-label={monthYearLabel(props.viewMonth, locale())}
          onMouseLeave={() => {
            props.onHover?.(null);
          }}
        >
          <div class="sui-date-picker__weekdays" role="row">
            <For each={weekdayLabels(locale(), weekStartsOn())}>
              {(label: string) => (
                <span class="sui-date-picker__weekday" role="columnheader">
                  {label}
                </span>
              )}
            </For>
          </div>
          <div class="sui-date-picker__weeks" role="rowgroup">
          <For each={buildWeeks(props.viewMonth, weekStartsOn())}>
            {(week: readonly Date[]) => (
              <div class="sui-date-picker__week" role="row">
                <For each={week}>
                  {(date: Date) => {
                    const disabled = (): boolean =>
                      isDateDisabled(date, props.min, props.max);
                    const isStart = (): boolean => isSameDay(date, props.start);
                    const isEnd = (): boolean => isSameDay(date, props.end);
                    const selected = (): boolean => isStart() || isEnd();
                    const from = (): Date | null => rangeFrom();
                    const to = (): Date | null => rangeTo();
                    const inRange = (): boolean => {
                      const rangeStart = from();
                      const rangeEnd = to();
                      if (rangeStart === null || rangeEnd === null) return false;
                      return (
                        compareDays(date, rangeStart) > 0
                        && compareDays(date, rangeEnd) < 0
                      );
                    };
                    return (
                      <div
                        class="sui-date-picker__cell"
                        role="gridcell"
                        aria-selected={selected() ? "true" : "false"}
                        data-in-range={
                          isRange() && (inRange() || selected()) ? "" : undefined
                        }
                        data-range-start={isRange() && isStart() ? "" : undefined}
                        data-range-end={isRange() && isEnd() ? "" : undefined}
                        data-preview={
                          isRange()
                          && props.preview !== null
                          && props.preview !== undefined
                          && isSameDay(date, props.preview)
                            ? ""
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          class="sui-date-picker__day"
                          data-date={dateKey(date)}
                          data-outside={isOutside(date) ? "" : undefined}
                          data-today={isSameDay(date, today()) ? "" : undefined}
                          data-selected={selected() ? "" : undefined}
                          data-in-range={
                            isRange() && (inRange() || selected()) ? "" : undefined
                          }
                          aria-current={isSameDay(date, today()) ? "date" : undefined}
                          aria-label={fullDateLabel(date, locale(), today())}
                          tabindex={isSameDay(date, activeDate()) ? 0 : -1}
                          disabled={disabled()}
                          onFocus={() => {
                            setActiveDate(startOfDay(date));
                            props.onHover?.(date);
                          }}
                          onMouseEnter={() => {
                            props.onHover?.(date);
                          }}
                          onClick={() => {
                            selectDay(date);
                          }}
                          onKeyDown={(event: KeyboardEvent) => {
                            handleDayKeyDown(event, date);
                          }}
                        >
                          {String(date.getDate())}
                        </button>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
          </div>
        </div>
      </Show>

      <Show when={mode() === "months"}>
        <div
          class="sui-date-picker__picker-grid"
          role="grid"
          aria-label={`${labels().chooseMonth} ${String(props.viewMonth.getFullYear())}`}
        >
          <For each={[0, 1, 2, 3]}>
            {(row: number) => (
              <div class="sui-date-picker__picker-row" role="row">
                <For each={MONTH_INDEXES.slice(row * 3, row * 3 + 3)}>
                  {(month: number) => {
                    const value = new Date(props.viewMonth.getFullYear(), month, 1);
                    return (
                      <button
                        type="button"
                        role="gridcell"
                        class="sui-date-picker__picker-cell"
                        data-selected={
                          month === props.viewMonth.getMonth() ? "" : undefined
                        }
                        aria-label={`${monthName(value, "long", locale())} ${String(props.viewMonth.getFullYear())}`}
                        onClick={() => {
                          selectMonth(month);
                        }}
                      >
                        {monthName(value, "short", locale())}
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={mode() === "years"}>
        <div
          class="sui-date-picker__picker-grid"
          role="grid"
          aria-label={labels().chooseYear}
        >
          <For each={[0, 1, 2, 3]}>
            {(row: number) => (
              <div class="sui-date-picker__picker-row" role="row">
                <For each={yearsFor(props.viewMonth).slice(row * 3, row * 3 + 3)}>
                  {(year: number) => (
                    <button
                      type="button"
                      role="gridcell"
                      class="sui-date-picker__picker-cell"
                      data-selected={
                        year === props.viewMonth.getFullYear() ? "" : undefined
                      }
                      aria-label={formatDateValue(
                        new Date(year, props.viewMonth.getMonth(), 1),
                        "yyyy",
                        locale(),
                      )}
                      onClick={() => {
                        selectYear(year);
                      }}
                    >
                      {String(year)}
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
