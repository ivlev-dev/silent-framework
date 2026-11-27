import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createSignal } from "@ivlev-dev/silent-core";
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
import { DateCalendar } from "./calendar.js";
import {
  compareDays,
  dateLabels,
  formatDateValue,
  isDateDisabled,
  isoValue,
  normalizeDate,
  parseDateValue,
  startOfDay,
  startOfMonth,
} from "./date.js";

const CALENDAR_PATH =
  "M7 2v2h10V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2h2Zm14 8H3v10h18V10Zm-2-4H5v2h14V6Z";

export interface DatePickerProps {
  readonly value?: Date | string | null | undefined;
  readonly defaultValue?: Date | string | null | undefined;
  readonly onValueChange?: ((value: Date | null) => void) | undefined;
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
  readonly parse?: ((text: string) => Date | null) | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly clearable?: boolean | undefined;
  readonly firstDayOfWeek?: number | undefined;
  readonly ariaLabel?: string | undefined;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

export function DatePicker(props: DatePickerProps): Node {
  const locale = (): string => props.locale ?? "ru-RU";
  const labels = (): ReturnType<typeof dateLabels> => dateLabels(locale());
  const id = resolveControlId(props.id, props.name, "date-picker");
  const name = (): string => props.name ?? id;
  const parseInput = (raw: string): Date | null =>
    normalizeDate(
      parseDateValue(raw, {
        format: props.format,
        locale: locale(),
        parse: props.parse,
      }),
    );
  const toDate = (raw: Date | string | null | undefined): Date | null =>
    typeof raw === "string" ? parseInput(raw) : normalizeDate(raw);
  const [internalValue, setInternalValue] = createSignal<Date | null>(
    toDate(props.defaultValue),
  );
  const [internalOpen, setInternalOpen] = createSignal(
    props.defaultOpen === true,
  );
  const [trigger, setTrigger] = createSignal<HTMLButtonElement | null>(null);
  const value = (): Date | null =>
    props.value !== undefined ? toDate(props.value) : internalValue();
  const isOpen = (): boolean =>
    props.open !== undefined ? props.open : internalOpen();
  const locked = (): boolean => props.disabled === true || props.readOnly === true;
  const today = (): Date => startOfDay(new Date());

  const openingDate = (): Date => {
    const current = value();
    if (current !== null) return current;
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
    }
    wasOpen = open;
  });
  useEscapeFocusReturn(isOpen, focusTrigger);

  const commit = (next: Date | null, close: boolean): void => {
    const normalized = normalizeDate(next);
    if (props.value === undefined) setInternalValue(normalized);
    props.onValueChange?.(normalized);
    if (close) {
      requestOpen(false);
      queueMicrotask(focusTrigger);
    }
  };

  const clear = (): void => {
    if (locked()) return;
    commit(null, true);
  };

  const selectToday = (): void => {
    const current = today();
    if (isDateDisabled(current, props.min, props.max)) return;
    commit(current, true);
  };

  const displayValue = (): string =>
    formatDateValue(value(), props.format, locale());

  const readHiddenValue = (): string => isoValue(value());
  const invalid = (): boolean => hasContent(props.error);
  const described = (): string | undefined =>
    describedBy(
      hasContent(props.hint) ? hintIdFor(id) : undefined,
      hasContent(props.error) ? errorIdFor(id) : undefined,
    );

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
      class={["sui-date-picker", props.class]}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        class="sui-date-picker__field"
        data-size={props.size ?? "md"}
        data-disabled={props.disabled === true ? "" : undefined}
        data-readonly={props.readOnly === true ? "" : undefined}
        data-invalid={invalid() ? "" : undefined}
        data-has-clear={props.clearable !== false && value() !== null ? "" : undefined}
      >
        <Popover
          class="sui-date-picker__popover"
          placement="bottom"
          label={labels().dialog}
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
              data-placeholder={value() === null ? "" : undefined}
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
              <span class="sui-date-picker__value">
                {value() === null
                  ? props.placeholder ?? labels().selectDate
                  : displayValue()}
              </span>
              <ChevronDownIcon size="sm" class="sui-date-picker__chevron" />
            </button>
          }
        >
          <div
            class="sui-date-picker__panel"
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
            <DateCalendar
              open={isOpen()}
              viewMonth={viewMonth()}
              onViewMonthChange={(month: Date) => {
                setViewMonth(startOfMonth(month));
              }}
              start={value()}
              min={props.min}
              max={props.max}
              locale={locale()}
              firstDayOfWeek={props.firstDayOfWeek}
              onSelect={(date: Date) => {
                commit(date, true);
              }}
              focusOnOpen
              focusDate={value()}
            />
            <div class="sui-date-picker__footer">
              <Button
                variant="text"
                size="sm"
                disabled={isDateDisabled(today(), props.min, props.max)}
                onClick={selectToday}
              >
                {labels().today}
              </Button>
              <Button
                variant="filled"
                size="sm"
                onClick={() => {
                  requestOpen(false);
                  queueMicrotask(focusTrigger);
                }}
              >
                {labels().done}
              </Button>
            </div>
          </div>
        </Popover>
        <Show when={props.clearable !== false && value() !== null}>
          <IconButton
            label={labels().clear}
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
          bindValue={[readHiddenValue, NO_WRITE]}
        />
      </div>
    </Field>
  );
}
