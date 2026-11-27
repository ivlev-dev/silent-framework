import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show, createSignal } from "@ivlev-dev/silent-core";
import { Icon } from "../icon/icon.js";
import { Button } from "../button/button.js";
import { IconButton } from "../icon-button/icon-button.js";
import { Popover } from "../popover/popover.js";
import { ChevronDownIcon } from "../../icons/chevron-down.js";
import { CloseIcon } from "../../icons/close.js";
import type { Attrs } from "../../internal/props.js";
import {
  clientEffect,
  trapTab,
  useEscapeFocusReturn,
} from "../../internal/overlay.js";
import { Field } from "../../form/field/field.js";
import {
  NO_WRITE,
  type ControlSize,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../../form/internal/control.js";
import { DateCalendar } from "../date-picker/calendar.js";
import {
  addDays,
  addMonths,
  compareDays,
  formatDateValue,
  formatDayCount,
  isDateDisabled,
  isoValue,
  normalizeDate,
  startOfDay,
  startOfMonth,
} from "../date-picker/date.js";

const CALENDAR_PATH =
  "M7 2v2h10V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2h2Zm14 8H3v10h18V10Zm-2-4H5v2h14V6Z";

export interface DateRangeValue {
  readonly start: Date | null;
  readonly end: Date | null;
}

export interface DateRangePreset {
  readonly key: string;
  readonly label: Children;
  readonly range: (today: Date) => DateRangeValue;
}

export const DEFAULT_DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  {
    key: "7d",
    label: "7 дней",
    range: (today: Date): DateRangeValue => ({
      start: addDays(today, -6),
      end: today,
    }),
  },
  {
    key: "30d",
    label: "30 дней",
    range: (today: Date): DateRangeValue => ({
      start: addDays(today, -29),
      end: today,
    }),
  },
  {
    key: "month",
    label: "Этот месяц",
    range: (today: Date): DateRangeValue => ({
      start: startOfMonth(today),
      end: today,
    }),
  },
];

export interface DateRangePickerProps {
  readonly value?: DateRangeValue | null | undefined;
  readonly defaultValue?: DateRangeValue | null | undefined;
  readonly onValueChange?: ((value: DateRangeValue) => void) | undefined;
  readonly min?: Date | undefined;
  readonly max?: Date | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly size?: ControlSize | undefined;
  readonly locale?: string | undefined;
  readonly format?: string | undefined;
  readonly name?: string | undefined;
  readonly endName?: string | undefined;
  readonly id?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly clearable?: boolean | undefined;
  readonly firstDayOfWeek?: number | undefined;
  readonly presets?: readonly DateRangePreset[] | false | undefined;
  readonly ariaLabel?: string | undefined;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

interface RangeLabels {
  readonly dialog: string;
  readonly clear: string;
  readonly done: string;
  readonly presets: string;
  readonly start: string;
  readonly end: string;
  readonly placeholder: string;
}

function rangeLabels(locale: string): RangeLabels {
  if (locale.toLowerCase().startsWith("en")) {
    return {
      dialog: "Choose date range",
      clear: "Clear range",
      done: "Done",
      presets: "Quick ranges",
      start: "Start date",
      end: "End date",
      placeholder: "Choose a period",
    };
  }
  return {
    dialog: "Выбор периода",
    clear: "Очистить период",
    done: "Готово",
    presets: "Быстрый выбор",
    start: "Дата начала",
    end: "Дата окончания",
    placeholder: "Выберите период",
  };
}

function normalizeRange(value: DateRangeValue | null | undefined): DateRangeValue {
  return {
    start: normalizeDate(value?.start),
    end: normalizeDate(value?.end),
  };
}

function rangeEquals(left: DateRangeValue, right: DateRangeValue): boolean {
  const sameStart = left.start === null
    ? right.start === null
    : right.start !== null && compareDays(left.start, right.start) === 0;
  const sameEnd = left.end === null
    ? right.end === null
    : right.end !== null && compareDays(left.end, right.end) === 0;
  return sameStart && sameEnd;
}

function rangeDisabled(
  range: DateRangeValue,
  min?: Date | undefined,
  max?: Date | undefined,
): boolean {
  if (range.start !== null && isDateDisabled(range.start, min, max)) return true;
  if (range.end !== null && isDateDisabled(range.end, min, max)) return true;
  return false;
}

export function DateRangePicker(props: DateRangePickerProps): Node {
  const locale = (): string => props.locale ?? "ru-RU";
  const rangeText = (): RangeLabels => rangeLabels(locale());
  const id = resolveControlId(props.id, props.name, "date-range-picker");
  const name = (): string => props.name ?? id;
  const endName = (): string => props.endName ?? `${name()}-end`;
  const [internalValue, setInternalValue] = createSignal<DateRangeValue>(
    normalizeRange(props.defaultValue),
  );
  const [internalOpen, setInternalOpen] = createSignal(
    props.defaultOpen === true,
  );
  const [preview, setPreview] = createSignal<Date | null>(null);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement | null>(null);
  const range = (): DateRangeValue =>
    normalizeRange(props.value !== undefined ? props.value : internalValue());
  const isOpen = (): boolean =>
    props.open !== undefined ? props.open : internalOpen();
  const locked = (): boolean => props.disabled === true || props.readOnly === true;
  const today = (): Date => startOfDay(new Date());

  const openingDate = (): Date => {
    const current = range();
    if (current.start !== null) return current.start;
    if (current.end !== null) return current.end;
    const base = today();
    if (props.min !== undefined && compareDays(base, props.min) < 0) {
      return startOfDay(props.min);
    }
    if (props.max !== undefined && compareDays(base, props.max) > 0) {
      return startOfDay(props.max);
    }
    return base;
  };

  const [viewMonth, setViewMonth] = createSignal<Date>(
    startOfMonth(openingDate()),
  );

  const focusTrigger = (): void => {
    trigger()?.focus({ preventScroll: true });
  };

  const requestOpen = (next: boolean): void => {
    if (isOpen() === next) return;
    if (props.open === undefined) setInternalOpen(next);
    props.onOpenChange?.(next);
  };

  let wasOpen = false;
  clientEffect(() => {
    const open = isOpen();
    if (open && !wasOpen) {
      setViewMonth(startOfMonth(openingDate()));
      setPreview(null);
    }
    wasOpen = open;
  });
  useEscapeFocusReturn(isOpen, focusTrigger);

  const commit = (next: DateRangeValue, close: boolean): void => {
    const normalized = normalizeRange(next);
    if (props.value === undefined) setInternalValue(normalized);
    props.onValueChange?.(normalized);
    if (close) {
      requestOpen(false);
      setPreview(null);
      queueMicrotask(focusTrigger);
    }
  };

  const selectDay = (date: Date): void => {
    const current = range();
    if (current.start === null || current.end !== null) {
      commit({ start: date, end: null }, false);
      return;
    }
    const next = compareDays(date, current.start) < 0
      ? { start: date, end: current.start }
      : { start: current.start, end: date };
    commit(next, true);
  };

  const hoverDay = (date: Date | null): void => {
    const current = range();
    if (current.start === null || current.end !== null) {
      setPreview(null);
      return;
    }
    setPreview(date);
  };

  const clear = (): void => {
    if (locked()) return;
    commit({ start: null, end: null }, true);
  };

  const presets = (): readonly DateRangePreset[] =>
    props.presets === false
      ? []
      : props.presets ?? DEFAULT_DATE_RANGE_PRESETS;

  const applyPreset = (preset: DateRangePreset): void => {
    if (locked()) return;
    const next = normalizeRange(preset.range(today()));
    if (rangeDisabled(next, props.min, props.max)) return;
    commit(next, true);
  };

  const format = (date: Date | null): string =>
    formatDateValue(date, props.format, locale());

  const displayValue = (): string => {
    const current = range();
    if (current.start === null && current.end === null) {
      return props.placeholder ?? rangeText().placeholder;
    }
    if (current.start === null) return `— ${format(current.end)}`;
    if (current.end === null) return `${format(current.start)} — …`;
    return `${format(current.start)} — ${format(current.end)}`;
  };

  const durationHint = (): string => {
    const current = range();
    if (current.start === null || current.end === null) return "";
    return formatDayCount(compareDays(current.start, current.end) + 1, locale());
  };

  const readStart = (): string => isoValue(range().start);
  const readEnd = (): string => isoValue(range().end);
  const invalid = (): boolean => hasContent(props.error);
  const described = (): string | undefined =>
    describedBy(
      hasContent(props.hint) ? hintIdFor(id) : undefined,
      hasContent(props.error) ? errorIdFor(id) : undefined,
    );

  const setSecondMonth = (month: Date): void => {
    setViewMonth(startOfMonth(addMonths(month, -1)));
  };

  return (
    <Field
      id={id}
      htmlFor={id}
      label={props.label}
      hint={props.hint}
      error={props.error}
      required={props.required === true}
      invalid={invalid()}
      disabled={props.disabled === true}
      class={["sui-date-picker", "sui-date-range-picker", props.class]}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        class="sui-date-picker__field"
        data-size={props.size ?? "md"}
        data-disabled={props.disabled === true ? "" : undefined}
        data-readonly={props.readOnly === true ? "" : undefined}
        data-invalid={invalid() ? "" : undefined}
        data-has-clear={
          props.clearable !== false
          && (range().start !== null || range().end !== null)
            ? ""
            : undefined
        }
      >
        <Popover
          class="sui-date-picker__popover sui-date-range-picker__popover"
          placement="bottom"
          label={rangeText().dialog}
          open={isOpen()}
          onOpenChange={(next: boolean) => {
            requestOpen(next);
          }}
          disabled={locked()}
          trigger={
            <button
              ref={(node: Element | null) => {
                setTrigger(node as HTMLButtonElement | null);
              }}
              id={id}
              type="button"
              class="sui-date-picker__control"
              data-size={props.size ?? "md"}
              data-placeholder={
                range().start === null && range().end === null ? "" : undefined
              }
              disabled={props.disabled === true}
              aria-label={props.label === undefined ? props.ariaLabel : undefined}
              aria-readonly={props.readOnly === true ? "true" : undefined}
              aria-required={props.required === true ? "true" : undefined}
              aria-invalid={invalid() ? "true" : undefined}
              aria-describedby={described()}
              onKeyDown={(event: KeyboardEvent) => {
                if (locked()) return;
                if (
                  event.key !== "ArrowDown"
                  && event.key !== "Enter"
                  && event.key !== " "
                ) {
                  return;
                }
                event.preventDefault();
                requestOpen(true);
              }}
            >
              <Icon size="sm" class="sui-date-picker__icon">
                <path d={CALENDAR_PATH} />
              </Icon>
              <span class="sui-date-picker__value">{displayValue()}</span>
              <ChevronDownIcon size="sm" class="sui-date-picker__chevron" />
            </button>
          }
        >
          <div
            class="sui-date-range-picker__panel"
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== "Tab") return;
              const current = event.currentTarget;
              if (!(current instanceof HTMLElement)) return;
              const element = current.closest<HTMLElement>(
                ".sui-popover__panel",
              );
              if (element !== null) trapTab(element, event);
            }}
          >
            <Show when={presets().length > 0}>
              <div
                class="sui-date-range-picker__presets"
                role="group"
                aria-label={rangeText().presets}
              >
                <For each={presets()}>
                  {(preset: DateRangePreset) => {
                    const presetRange = (): DateRangeValue =>
                      normalizeRange(preset.range(today()));
                    const active = (): boolean => rangeEquals(presetRange(), range());
                    const disabled = (): boolean =>
                      rangeDisabled(presetRange(), props.min, props.max);
                    return (
                      <Button
                        variant={active() ? "tonal" : "text"}
                        size="sm"
                        fullWidth
                        disabled={disabled()}
                        class="sui-date-range-picker__preset"
                        onClick={() => {
                          applyPreset(preset);
                        }}
                      >
                        {preset.label}
                      </Button>
                    );
                  }}
                </For>
              </div>
            </Show>
            <div class="sui-date-range-picker__months">
              <DateCalendar
                open={isOpen()}
                viewMonth={viewMonth()}
                onViewMonthChange={(month: Date) => {
                  setViewMonth(startOfMonth(month));
                }}
                start={range().start}
                end={range().end}
                preview={preview()}
                range
                min={props.min}
                max={props.max}
                locale={locale()}
                firstDayOfWeek={props.firstDayOfWeek}
                onSelect={selectDay}
                onHover={hoverDay}
                focusOnOpen
                focusDate={range().start}
                label={rangeText().start}
              />
              <DateCalendar
                open={isOpen()}
                viewMonth={addMonths(viewMonth(), 1)}
                onViewMonthChange={setSecondMonth}
                start={range().start}
                end={range().end}
                preview={preview()}
                range
                min={props.min}
                max={props.max}
                locale={locale()}
                firstDayOfWeek={props.firstDayOfWeek}
                onSelect={selectDay}
                onHover={hoverDay}
                focusOnOpen={false}
                focusDate={range().start}
                label={rangeText().end}
              />
            </div>
            <div class="sui-date-range-picker__footer">
              <span class="sui-date-range-picker__hint">{durationHint()}</span>
              <Button
                variant="filled"
                size="sm"
                onClick={() => {
                  requestOpen(false);
                  queueMicrotask(focusTrigger);
                }}
              >
                {rangeText().done}
              </Button>
            </div>
          </div>
        </Popover>
        <Show
          when={
            props.clearable !== false
            && (range().start !== null || range().end !== null)
          }
        >
          <IconButton
            label={rangeText().clear}
            size="sm"
            variant="standard"
            class="sui-date-picker__clear"
            disabled={locked()}
            onClick={clear}
          >
            <CloseIcon size="sm" />
          </IconButton>
        </Show>
        <input
          type="hidden"
          name={name()}
          bindValue={[readStart, NO_WRITE]}
        />
        <input
          type="hidden"
          name={endName()}
          bindValue={[readEnd, NO_WRITE]}
        />
      </div>
    </Field>
  );
}
