import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { For, Show, createSignal } from "@ivlev-dev/silent-core";
import { Icon } from "../icon/icon.js";
import { Button } from "../button/button.js";
import { IconButton } from "../icon-button/icon-button.js";
import { Popover } from "../popover/popover.js";
import { CloseIcon } from "../../icons/close.js";
import type { Attrs } from "../../internal/props.js";
import {
  clientEffect,
  trapTab,
  useEscapeFocusReturn,
} from "../../internal/overlay.js";
import { Field } from "../../form/field/field.js";
import { TextField } from "../../form/text-field/text-field.js";
import { useUiConfig } from "../../theme/config.js";
import {
  NO_WRITE,
  type ControlSize,
  describedBy,
  errorIdFor,
  hasContent,
  hintIdFor,
  resolveControlId,
} from "../../form/internal/control.js";
import {
  type ColorFormat,
  type RgbaColor,
  colorsEqual,
  formatColor,
  hsvToRgb,
  normalizeColor,
  parseColor,
  rgbToHsv,
  toCssColor,
} from "./color.js";

const PALETTE_PATH =
  "M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a1.5 1.5 0 0 1 0-3h3a6 6 0 0 0 0-12h-3Zm-4.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-3.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z";

const FALLBACK_COLOR: RgbaColor = { r: 14, g: 42, b: 71, a: 1 };

export const DEFAULT_COLOR_PRESETS: readonly string[] = [
  "#0E2A47",
  "#1F4E6B",
  "#4A7FA7",
  "#9FB8C9",
  "#1F6B45",
  "#C98A0A",
  "#A8322A",
  "#000000",
  "#FFFFFF",
];

interface ColorLabels {
  readonly dialog: string;
  readonly clear: string;
  readonly done: string;
  readonly alpha: string;
  readonly hue: string;
  readonly saturation: string;
  readonly saturationValue: (saturation: number, brightness: number) => string;
  readonly presets: string;
  readonly preset: string;
  readonly picker: string;
}

function colorLabels(locale: string): ColorLabels {
  if (locale.toLowerCase().startsWith("en")) {
    return {
      dialog: "Choose color",
      clear: "Clear color",
      done: "Done",
      alpha: "Opacity",
      hue: "Hue",
      saturation: "Saturation and brightness",
      saturationValue: (saturation, brightness) =>
        `Saturation ${String(Math.round(saturation))}%, brightness ${String(Math.round(brightness))}%`,
      presets: "Presets",
      preset: "Choose color",
      picker: "Color picker",
    };
  }
  return {
    dialog: "Выбор цвета",
    clear: "Очистить цвет",
    done: "Готово",
    alpha: "Прозрачность",
    hue: "Оттенок",
    saturation: "Насыщенность и яркость",
    saturationValue: (saturation, brightness) =>
      `Насыщенность ${String(Math.round(saturation))}%, яркость ${String(Math.round(brightness))}%`,
    presets: "Пресеты",
    preset: "Выбрать цвет",
    picker: "Выбор цвета",
  };
}

export interface ColorPickerProps {
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  readonly format?: ColorFormat | undefined;
  readonly showAlpha?: boolean | undefined;
  readonly presets?: readonly string[] | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly required?: boolean | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly size?: ControlSize | undefined;
  readonly locale?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly clearable?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}

export function ColorPicker(props: ColorPickerProps): Node {
  const config = useUiConfig();
  const locale = (): string => props.locale ?? "ru-RU";
  const labels = (): ColorLabels => colorLabels(locale());
  const format = (): ColorFormat => props.format ?? "hex";
  const showAlpha = (): boolean => props.showAlpha === true;
  const id = resolveControlId(props.id, props.name, "color-picker");
  const name = (): string => props.name ?? id;
  const [internalValue, setInternalValue] = createSignal(props.defaultValue ?? "");
  const [internalOpen, setInternalOpen] = createSignal(
    props.defaultOpen === true,
  );
  const [text, setText] = createSignal<string | null>(null);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement | null>(null);
  const [area, setArea] = createSignal<HTMLElement | null>(null);
  const current = (): string =>
    props.value !== undefined ? props.value : internalValue();
  const isOpen = (): boolean =>
    props.open !== undefined ? props.open : internalOpen();
  const locked = (): boolean => props.disabled === true || props.readOnly === true;
  const parsed = (): RgbaColor | null => parseColor(current());
  const color = (): RgbaColor => {
    const base = parsed() ?? FALLBACK_COLOR;
    return normalizeColor({
      ...base,
      a: showAlpha() ? base.a : 1,
    });
  };
  const hasValue = (): boolean => current().trim() !== "";
  const formatted = (): string => {
    if (!hasValue()) return "";
    if (parsed() === null) return current();
    return formatColor(color(), format(), showAlpha());
  };
  const inputText = (): string => text() ?? formatted();

  const requestOpen = (next: boolean): void => {
    if (isOpen() === next) return;
    if (props.open === undefined) setInternalOpen(next);
    props.onOpenChange?.(next);
  };

  const focusTrigger = (): void => {
    trigger()?.focus({ preventScroll: true });
  };

  let wasOpen = false;
  clientEffect(() => {
    const open = isOpen();
    if (open && !wasOpen) {
      setText(null);
    }
    if (!open) setText(null);
    wasOpen = open;
  });
  useEscapeFocusReturn(isOpen, focusTrigger);

  const commitColor = (next: RgbaColor, close = false): void => {
    const normalized = normalizeColor({
      ...next,
      a: showAlpha() ? next.a : 1,
    });
    const value = formatColor(normalized, format(), showAlpha());
    if (props.value === undefined) setInternalValue(value);
    props.onValueChange?.(value);
    setText(null);
    if (close) {
      requestOpen(false);
      queueMicrotask(focusTrigger);
    }
  };

  const commitText = (raw: string): void => {
    const value = parseColor(raw);
    if (value === null) {
      setText(null);
      return;
    }
    commitColor(value);
  };

  const clear = (): void => {
    if (locked()) return;
    if (props.value === undefined) setInternalValue("");
    props.onValueChange?.("");
    setText(null);
    requestOpen(false);
    queueMicrotask(focusTrigger);
  };

  const hsv = (): ReturnType<typeof rgbToHsv> => rgbToHsv(color());

  const updateHsv = (patch: {
    readonly h?: number | undefined;
    readonly s?: number | undefined;
    readonly v?: number | undefined;
  }): void => {
    if (locked()) return;
    const base = hsv();
    const nextH = patch.h ?? base.h;
    const nextS = patch.s ?? base.s;
    const nextV = patch.v ?? base.v;
    commitColor(hsvToRgb({ h: nextH, s: nextS, v: nextV }, color().a));
  };

  const updateAlpha = (alpha: number): void => {
    if (locked()) return;
    commitColor({ ...color(), a: Math.min(1, Math.max(0, alpha)) });
  };

  const updateFromPointer = (event: PointerEvent): void => {
    const element = area();
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const saturation = ((event.clientX - rect.left) / rect.width) * 100;
    const brightness = 100 - ((event.clientY - rect.top) / rect.height) * 100;
    updateHsv({
      s: Math.min(100, Math.max(0, saturation)),
      v: Math.min(100, Math.max(0, brightness)),
    });
  };

  let dragging = false;

  const handleAreaKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const base = hsv();
    const step = event.shiftKey ? 10 : 1;
    let nextS = base.s;
    let nextV = base.v;
    switch (event.key) {
      case "ArrowLeft":
        nextS -= step;
        break;
      case "ArrowRight":
        nextS += step;
        break;
      case "ArrowDown":
        nextV -= step;
        break;
      case "ArrowUp":
        nextV += step;
        break;
      case "Home":
        nextS = 0;
        break;
      case "End":
        nextS = 100;
        break;
      case "PageDown":
        nextV -= 10;
        break;
      case "PageUp":
        nextV += 10;
        break;
      default:
        return;
    }
    event.preventDefault();
    updateHsv({
      s: Math.min(100, Math.max(0, nextS)),
      v: Math.min(100, Math.max(0, nextV)),
    });
  };

  const displayColor = (): string => {
    if (parsed() === null) return "transparent";
    return toCssColor(color());
  };

  const presets = (): readonly string[] => props.presets ?? DEFAULT_COLOR_PRESETS;
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
      class={["sui-color-picker", props.class]}
      style={props.style}
      attrs={props.attrs}
    >
      <div
        class="sui-color-picker__field"
        data-size={props.size ?? "md"}
        data-disabled={props.disabled === true ? "" : undefined}
        data-readonly={props.readOnly === true ? "" : undefined}
        data-invalid={invalid() ? "" : undefined}
        data-has-clear={props.clearable !== false && hasValue() ? "" : undefined}
      >
        <Popover
          class="sui-color-picker__popover"
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
              class="sui-color-picker__control"
              data-size={props.size ?? "md"}
              data-placeholder={hasValue() ? undefined : ""}
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
              <span
                class="sui-color-picker__swatch"
                data-empty={parsed() === null ? "" : undefined}
                style={{ "--sui-color-picker-swatch": displayColor() }}
                aria-hidden="true"
              />
              <span class="sui-color-picker__value">
                {hasValue() ? formatted() : props.placeholder ?? labels().picker}
              </span>
              <Icon size="sm" class="sui-color-picker__icon">
                <path d={PALETTE_PATH} />
              </Icon>
            </button>
          }
        >
          <div
            class="sui-color-picker__panel"
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
            <div class="sui-color-picker__header">
              <span class="sui-color-picker__title">{labels().picker}</span>
              <IconButton
                label={config.strings.close}
                size="sm"
                variant="standard"
                onClick={() => {
                  requestOpen(false);
                  queueMicrotask(focusTrigger);
                }}
              >
                <CloseIcon size="sm" />
              </IconButton>
            </div>

            <div
              ref={(node: Element | null) => {
                setArea(node as HTMLElement | null);
              }}
              class="sui-color-picker__saturation"
              role="slider"
              aria-label={labels().saturation}
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={String(Math.round(hsv().s))}
              aria-valuetext={labels().saturationValue(hsv().s, hsv().v)}
              tabindex="0"
              data-disabled={locked() ? "" : undefined}
              style={{
                "--sui-color-picker-hue": `hsl(${String(hsv().h)}, 100%, 50%)`,
              }}
              onPointerDown={(event: PointerEvent) => {
                if (locked()) return;
                dragging = true;
                area()?.setPointerCapture?.(event.pointerId);
                updateFromPointer(event);
              }}
              onPointerMove={(event: PointerEvent) => {
                if (!dragging) return;
                updateFromPointer(event);
              }}
              onPointerUp={() => {
                dragging = false;
              }}
              onPointerCancel={() => {
                dragging = false;
              }}
              onKeyDown={handleAreaKeyDown}
            >
              <span
                class="sui-color-picker__thumb"
                style={{
                  "inset-inline-start": `${String(hsv().s)}%`,
                  "inset-block-start": `${String(100 - hsv().v)}%`,
                  "background-color": toCssColor(color()),
                }}
                aria-hidden="true"
              />
            </div>

            <label class="sui-color-picker__slider-label">
              <span>{labels().hue}</span>
              <input
                class="sui-color-picker__range sui-color-picker__range--hue"
                type="range"
                min="0"
                max="359"
                step="1"
                value={String(Math.round(hsv().h))}
                aria-label={labels().hue}
                aria-valuetext={`${String(Math.round(hsv().h))}°`}
                disabled={locked()}
                onInput={(event: InputEvent) => {
                  const target = event.currentTarget;
                  if (!(target instanceof HTMLInputElement)) return;
                  updateHsv({ h: Number(target.value) });
                }}
              />
            </label>

            <Show when={showAlpha()}>
              <label class="sui-color-picker__slider-label">
                <span>{labels().alpha}</span>
                <input
                  class="sui-color-picker__range sui-color-picker__range--alpha"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={String(Math.round(color().a * 100))}
                  aria-label={labels().alpha}
                  aria-valuetext={`${String(Math.round(color().a * 100))}%`}
                  disabled={locked()}
                  style={{
                    "--sui-color-picker-alpha-color": toCssColor({
                      ...color(),
                      a: 1,
                    }),
                  }}
                  onInput={(event: InputEvent) => {
                    const target = event.currentTarget;
                    if (!(target instanceof HTMLInputElement)) return;
                    updateAlpha(Number(target.value) / 100);
                  }}
                />
              </label>
            </Show>

            <TextField
              id={`${id}-value`}
              name=""
              size="sm"
              label={format().toUpperCase()}
              hint={locale().toLowerCase().startsWith("en")
                ? "HEX, RGB or HSL"
                : "HEX, RGB или HSL"}
              value={inputText()}
              disabled={locked()}
              onChange={(event: Event) => {
                const target = event.currentTarget;
                if (target instanceof HTMLInputElement) commitText(target.value);
              }}
              onInput={(event: InputEvent) => {
                const target = event.currentTarget;
                if (target instanceof HTMLInputElement) setText(target.value);
              }}
              onBlur={() => {
                const raw = text();
                if (raw !== null) commitText(raw);
              }}
            />

            <div
              class="sui-color-picker__presets"
              role="group"
              aria-label={labels().presets}
            >
              <For each={presets()}>
                {(preset: string) => {
                  const presetColor = parseColor(preset);
                  const selected = (): boolean =>
                    presetColor !== null
                    && colorsEqual(normalizeColor(presetColor), color());
                  return (
                    <button
                      type="button"
                      class="sui-color-picker__preset"
                      data-selected={selected() ? "" : undefined}
                      style={{ "background-color": preset }}
                      title={preset}
                      aria-label={`${labels().preset}: ${preset}`}
                      aria-pressed={selected() ? "true" : "false"}
                      disabled={locked()}
                      onClick={() => {
                        if (presetColor === null) return;
                        commitColor(presetColor);
                      }}
                    />
                  );
                }}
              </For>
            </div>

            <div class="sui-color-picker__footer">
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
        <Show when={props.clearable !== false && hasValue()}>
          <IconButton
            label={labels().clear}
            size="sm"
            variant="standard"
            class="sui-color-picker__clear"
            disabled={locked()}
            onClick={clear}
          >
            <CloseIcon size="sm" />
          </IconButton>
        </Show>
        <input
          type="hidden"
          name={name()}
          bindValue={[formatted, NO_WRITE]}
        />
      </div>
    </Field>
  );
}
