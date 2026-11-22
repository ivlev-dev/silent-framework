import type { Form } from "./form.js";
import type {
  FieldEventLike,
  FieldProps,
  ValidateOnMode,
} from "./types.js";

/** Внутренний хост фабрик `FieldProps` (реализуется `Form`). */
export interface FieldPropsHost {
  readonly labels: Readonly<Record<string, string>>;
  readValue(name: string): unknown;
  metadata(name: string): {
    readonly label?: string | undefined;
    readonly placeholder?: string | undefined;
    readonly hint?: string | undefined;
    readonly required?: boolean | undefined;
  } | undefined;
  labelFor(name: string): string;
  metadataLabelFor(path: string): string | undefined;
  directErrors(name: string): readonly string[];
  ownErrors(name: string): readonly string[];
  nestedFormErrors(name: string): readonly string[];
  readyState(name: string): boolean;
  isValidatingField(name: string): boolean;
  isTouched(name: string): boolean;
  isDirtyField(name: string): boolean;
  idFor(path: string): string;
  setValue(name: string, value: unknown): void;
  setReady(name: string, ready: boolean): void;
  handleEvent(name: string, event: FieldEventLike, mode: ValidateOnMode): void;
  markTouched(name: string): void;
  validateForEvent(name: string, mode: ValidateOnMode): void;
  runFieldValidation(name: string): Promise<boolean>;
  requireChild(name: string): Form;
  childProps(child: Form, path: string): FieldProps<unknown>;
  hasAnyTouched(child: Form): boolean;
  hasValidating(child: Form): boolean;
  nestedBindingError(name: string, handler: string): never;
  isFormInstance(value: unknown): value is Form;
  arrayItems(name: string): Form[] | undefined;
  requireArrayItem(root: string, index: number): Form;
  requireArrayItems(name: string): Form[];
  arrayErrors(name: string): Readonly<Record<string, readonly string[]>>;
  arrayItemExternalErrors(path: string): readonly string[] | undefined;
  replaceArray(name: string, value: unknown): void;
  ensureCanBind(item: Form, name: string, index: number): void;
  commitArray(
    name: string,
    next: Form[],
    removed: Form[],
  ): void;
  runFormArrayValidation(name: string): Promise<boolean>;
}

export function createDirectProps(
  host: FieldPropsHost,
  name: string,
): FieldProps<unknown> {
  const metadata = host.metadata(name);
  const id = host.idFor(name);
  return {
    get value() {
      return host.readValue(name);
    },
    get label() {
      return host.labelFor(name);
    },
    get placeholder() {
      return metadata?.placeholder;
    },
    get hint() {
      return metadata?.hint;
    },
    get error() {
      return host.directErrors(name)[0];
    },
    get errors() {
      return host.directErrors(name);
    },
    get isRequired() {
      return metadata?.required === true;
    },
    get isReady() {
      return host.readyState(name);
    },
    get isValidating() {
      return host.isValidatingField(name);
    },
    get touched() {
      return host.isTouched(name);
    },
    get dirty() {
      return host.isDirtyField(name);
    },
    get isValid() {
      return host.directErrors(name).length === 0;
    },
    get name() {
      return name;
    },
    get id() {
      return id;
    },
    setValue(value) {
      host.setValue(name, value);
    },
    setReady(ready) {
      host.setReady(name, ready);
    },
    onChange(event) {
      host.handleEvent(name, event, "change");
    },
    onInput(event) {
      host.handleEvent(name, event, "input");
    },
    onFocus(_event) {
      // Фокус намеренно не меняет состояние: touched ставится на blur.
    },
    onBlur(_event) {
      host.markTouched(name);
      host.validateForEvent(name, "blur");
    },
    validate() {
      return host.runFieldValidation(name);
    },
  };
}

export function createNestedFormProps(
  host: FieldPropsHost,
  name: string,
): FieldProps<unknown> {
  const metadata = host.metadata(name);
  const id = host.idFor(name);
  return {
    get value() {
      return host.requireChild(name);
    },
    get label() {
      return host.labelFor(name);
    },
    get placeholder() {
      return metadata?.placeholder;
    },
    get hint() {
      return metadata?.hint;
    },
    get error() {
      return host.nestedFormErrors(name)[0];
    },
    get errors() {
      return host.nestedFormErrors(name);
    },
    get isRequired() {
      return metadata?.required === true;
    },
    get isReady() {
      return host.requireChild(name).isReady;
    },
    get isValidating() {
      return host.hasValidating(host.requireChild(name));
    },
    get touched() {
      return host.isTouched(name) || host.hasAnyTouched(host.requireChild(name));
    },
    get dirty() {
      return host.isDirtyField(name) || host.requireChild(name).isDirty;
    },
    get isValid() {
      return host.requireChild(name).isValid;
    },
    get name() {
      return name;
    },
    get id() {
      return id;
    },
    setValue(value) {
      if (!host.isFormInstance(value)) {
        throw new TypeError(
          `Поле "${name}" — вложенная форма: ожидался экземпляр Form`,
        );
      }
      host.setValue(name, value);
    },
    setReady(ready) {
      host.setReady(name, ready);
    },
    onChange(_event) {
      host.nestedBindingError(name, "onChange");
    },
    onInput(_event) {
      host.nestedBindingError(name, "onInput");
    },
    onFocus(_event) {
      host.nestedBindingError(name, "onFocus");
    },
    onBlur(_event) {
      host.nestedBindingError(name, "onBlur");
    },
    validate() {
      return host.requireChild(name).validate();
    },
  };
}

export function createNestedFieldProps(
  host: FieldPropsHost,
  path: string,
  root: string,
  rest: string,
): FieldProps<unknown> {
  const id = host.idFor(path);
  const childProps = (): FieldProps<unknown> =>
    host.childProps(host.requireChild(root), rest);
  return {
    get value() {
      return childProps().value;
    },
    get label() {
      const fallback = childProps().label;
      return host.metadataLabelFor(path)
        ?? host.labels[path]
        ?? host.labels[lastSegmentOf(path)]
        ?? fallback;
    },
    get placeholder() {
      return childProps().placeholder;
    },
    get hint() {
      return childProps().hint;
    },
    get error() {
      return childProps().error;
    },
    get errors() {
      return childProps().errors;
    },
    get isRequired() {
      return childProps().isRequired;
    },
    get isReady() {
      return childProps().isReady;
    },
    get isValidating() {
      return childProps().isValidating;
    },
    get touched() {
      return childProps().touched;
    },
    get dirty() {
      return childProps().dirty;
    },
    get isValid() {
      return childProps().isValid;
    },
    get name() {
      return path;
    },
    get id() {
      return id;
    },
    setValue(value) {
      childProps().setValue(value);
    },
    setReady(ready) {
      childProps().setReady(ready);
    },
    onChange(event) {
      childProps().onChange(event);
    },
    onInput(event) {
      childProps().onInput(event);
    },
    onFocus(event) {
      childProps().onFocus(event);
    },
    onBlur(event) {
      childProps().onBlur(event);
    },
    validate() {
      return childProps().validate();
    },
  };
}

export function createFormArrayProps(
  host: FieldPropsHost,
  name: string,
): FieldProps<unknown> {
  const metadata = host.metadata(name);
  const id = host.idFor(name);
  const items = (): Form[] => host.requireArrayItems(name);
  const allErrors = (): readonly string[] => {
    const result: string[] = [...host.ownErrors(name)];
    for (const messages of Object.values(host.arrayErrors(name))) {
      result.push(...messages);
    }
    return result;
  };
  return {
    get value() {
      return items();
    },
    get label() {
      return host.labelFor(name);
    },
    get placeholder() {
      return metadata?.placeholder;
    },
    get hint() {
      return metadata?.hint;
    },
    get error() {
      return allErrors()[0];
    },
    get errors() {
      return allErrors();
    },
    get isRequired() {
      return metadata?.required === true;
    },
    get isReady() {
      return (
        allErrors().length === 0 &&
        items().every(
          (item, index) =>
            host.readyState(`${name}[${index}]`) && item.isReady,
        )
      );
    },
    get isValidating() {
      return items().some((item) => host.hasValidating(item));
    },
    get touched() {
      return (
        host.isTouched(name) ||
        items().some((item) => host.hasAnyTouched(item))
      );
    },
    get dirty() {
      return (
        host.isDirtyField(name) || items().some((item) => item.isDirty)
      );
    },
    get isValid() {
      return (
        allErrors().length === 0 &&
        items().every((item) => item.isValid)
      );
    },
    get name() {
      return name;
    },
    get id() {
      return id;
    },
    setValue(value) {
      host.replaceArray(name, value);
    },
    setReady(ready) {
      host.setReady(name, ready);
    },
    onChange(_event) {
      host.nestedBindingError(name, "onChange");
    },
    onInput(_event) {
      host.nestedBindingError(name, "onInput");
    },
    onFocus(_event) {
      host.nestedBindingError(name, "onFocus");
    },
    onBlur(_event) {
      host.nestedBindingError(name, "onBlur");
    },
    validate() {
      return host.runFormArrayValidation(name);
    },
  };
}

export function createArrayItemProps(
  host: FieldPropsHost,
  path: string,
  root: string,
  index: number,
): FieldProps<unknown> {
  const id = host.idFor(path);
  const fieldPath = `${root}[${index}]`;
  const itemErrors = (): readonly string[] => {
    const result: string[] = [];
    for (const messages of Object.values(host.requireArrayItem(root, index).errors)) {
      result.push(...messages);
    }
    const external = host.arrayItemExternalErrors(fieldPath);
    if (external !== undefined) {
      result.push(...external);
    }
    return result;
  };
  return {
    get value() {
      return host.requireArrayItem(root, index);
    },
    get label() {
      return host.labelFor(root);
    },
    get placeholder() {
      return undefined;
    },
    get hint() {
      return undefined;
    },
    get error() {
      return itemErrors()[0];
    },
    get errors() {
      return itemErrors();
    },
    get isRequired() {
      return false;
    },
    get isReady() {
      return (
        host.readyState(fieldPath) &&
        host.requireArrayItem(root, index).isReady
      );
    },
    get isValidating() {
      return host.hasValidating(host.requireArrayItem(root, index));
    },
    get touched() {
      return (
        host.isTouched(fieldPath) ||
        host.hasAnyTouched(host.requireArrayItem(root, index))
      );
    },
    get dirty() {
      return (
        host.isDirtyField(fieldPath) ||
        host.requireArrayItem(root, index).isDirty
      );
    },
    get isValid() {
      return host.requireArrayItem(root, index).isValid;
    },
    get name() {
      return path;
    },
    get id() {
      return id;
    },
    setValue(value) {
      if (!host.isFormInstance(value)) {
        throw new TypeError(`Поле "${path}" — элемент массива: ожидался Form`);
      }
      const items = [...host.requireArrayItems(root)];
      const previous = items[index];
      if (previous === undefined) {
        throw new Error(`Элемент "${path}" больше не существует`);
      }
      if (previous === value) {
        return;
      }
      host.ensureCanBind(value, root, index);
      items[index] = value;
      host.commitArray(root, items, [previous]);
    },
    setReady(ready) {
      host.setReady(fieldPath, ready);
    },
    onChange(_event) {
      host.nestedBindingError(path, "onChange");
    },
    onInput(_event) {
      host.nestedBindingError(path, "onInput");
    },
    onFocus(_event) {
      host.nestedBindingError(path, "onFocus");
    },
    onBlur(_event) {
      host.nestedBindingError(path, "onBlur");
    },
    validate() {
      return host.requireArrayItem(root, index).validate();
    },
  };
}

export function createArrayItemFieldProps(
  host: FieldPropsHost,
  path: string,
  root: string,
  index: number,
  rest: string,
): FieldProps<unknown> {
  const id = host.idFor(path);
  const fieldPath = `${root}[${index}]`;
  const childProps = (): FieldProps<unknown> =>
    host.childProps(host.requireArrayItem(root, index), rest);
  return {
    get value() {
      return childProps().value;
    },
    get label() {
      const fallback = childProps().label;
      return (
        host.metadataLabelFor(path) ??
        host.labels[path] ??
        host.labels[lastSegmentOf(path)] ??
        fallback
      );
    },
    get placeholder() {
      return childProps().placeholder;
    },
    get hint() {
      return childProps().hint;
    },
    get error() {
      return childProps().error;
    },
    get errors() {
      return childProps().errors;
    },
    get isRequired() {
      return childProps().isRequired;
    },
    get isReady() {
      return host.readyState(fieldPath) && childProps().isReady;
    },
    get isValidating() {
      return childProps().isValidating;
    },
    get touched() {
      return childProps().touched;
    },
    get dirty() {
      return childProps().dirty;
    },
    get isValid() {
      return childProps().isValid;
    },
    get name() {
      return path;
    },
    get id() {
      return id;
    },
    setValue(value) {
      childProps().setValue(value);
    },
    setReady(ready) {
      childProps().setReady(ready);
    },
    onChange(event) {
      childProps().onChange(event);
    },
    onInput(event) {
      childProps().onInput(event);
    },
    onFocus(event) {
      childProps().onFocus(event);
    },
    onBlur(event) {
      childProps().onBlur(event);
    },
    validate() {
      return childProps().validate();
    },
  };
}

function lastSegmentOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? path : path.slice(dot + 1);
}
