import {
  createComponent,
  createSignal,
  flushSync,
  type AnyComponent,
} from "@ivlev-dev/silent-core";
import type { FieldProps as FormFieldProps } from "@ivlev-dev/silent-form";

export interface Mounted {
  readonly node: Node;
  dispose(): void;
}

export interface TestHandles {
  readonly items: Mounted[];
}

export function mount(
  handles: TestHandles,
  component: AnyComponent,
  props: Record<string, unknown> = {},
): Mounted {
  const result = createComponent(component, props);
  document.body.appendChild(result.node);
  // При переиспользовании узлов атрибуты/дыры применяются эффектами.
  flushSync();
  handles.items.push(result);
  return result;
}

export function rootOf(handle: Mounted): Element {
  const node = handle.node;
  if (node.nodeType !== Node.ELEMENT_NODE) {
    throw new Error(`ожидался элемент, получен nodeType=${node.nodeType}`);
  }
  return node as Element;
}

export function query<T extends Element>(
  root: Element,
  selector: string,
): T {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`не найден селектор ${selector}`);
  return found as T;
}

export function eventValue(event: { readonly currentTarget?: unknown }): unknown {
  const target = event.currentTarget;
  if (target instanceof HTMLInputElement) {
    if (target.type === "checkbox") return target.checked;
    return target.value;
  }
  if (target instanceof HTMLTextAreaElement) return target.value;
  if (target instanceof HTMLSelectElement) {
    if (target.multiple) {
      return Array.from(target.selectedOptions).map((option) => option.value);
    }
    return target.value;
  }
  return undefined;
}

export interface FakeField<T> {
  readonly field: FormFieldProps<T>;
  set(value: T): void;
  fail(message: string): void;
  touch(): void;
}

export interface FakeFieldOptions<T> {
  readonly name?: string;
  readonly id?: string;
  readonly label?: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly validating?: boolean;
  readonly error?: string;
}

/**
 * Структурный двойник `FieldProps` с реактивными значениями:
 * позволяет проверять `field`-связку без реальной формы.
 */
export function fakeField<T>(
  initial: T,
  options: FakeFieldOptions<T> = {},
): FakeField<T> {
  const [value, setValueSignal] = createSignal<T>(initial);
  const [error, setError] = createSignal<string | undefined>(options.error);
  const [touched, setTouched] = createSignal(false);
  const field: FormFieldProps<T> = {
    get value() {
      return value();
    },
    label: options.label ?? "Поле",
    placeholder: options.placeholder,
    hint: options.hint,
    get error() {
      return error();
    },
    get errors() {
      const current = error();
      return current === undefined ? [] : [current];
    },
    isRequired: options.required === true,
    isReady: true,
    isValidating: options.validating === true,
    get touched() {
      return touched();
    },
    dirty: false,
    get isValid() {
      return error() === undefined;
    },
    name: options.name ?? "field",
    id: options.id ?? "form-field",
    setValue(next: T) {
      setValueSignal(next);
    },
    setReady() {
      // не используется в тестах
    },
    onChange(event) {
      setValueSignal(eventValue(event) as T);
    },
    onInput(event) {
      setValueSignal(eventValue(event) as T);
    },
    onFocus() {
      // фокус не меняет состояние
    },
    onBlur() {
      setTouched(true);
    },
    validate() {
      return Promise.resolve(error() === undefined);
    },
  };
  return {
    field,
    set(next: T) {
      setValueSignal(next);
    },
    fail(message: string) {
      setError(message);
    },
    touch() {
      setTouched(true);
    },
  };
}
