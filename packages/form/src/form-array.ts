import type { Form } from "./form.js";
import type { FormArray } from "./types.js";

/** Внутренний хост операций `FormArray` (реализуется `Form`). */
export interface FormArrayHost {
  items(name: string): Form[] | undefined;
  requireItems(name: string): Form[];
  directErrors(name: string): readonly string[];
  arrayErrors(name: string): Readonly<Record<string, readonly string[]>>;
  isTouched(name: string): boolean;
  isDirtyField(name: string): boolean;
  createItem(name: string): Form | undefined;
  ensureCanBind(item: Form, name: string, index: number): void;
  commit(name: string, next: Form[], removed: Form[]): void;
  isBaseline(item: Form): boolean;
}

export function createFieldArray<T extends Form>(
  host: FormArrayHost,
  name: string,
): FormArray<T> {
  const requireItems = (): Form[] => host.requireItems(name);
  const arrayErrors = (): Readonly<Record<string, readonly string[]>> => {
    const own = host.directErrors(name);
    const children = host.arrayErrors(name);
    return own.length > 0 ? { [name]: own, ...children } : children;
  };
  const ownErrors = (): readonly string[] => host.directErrors(name);
  return {
    get items() {
      return requireItems() as unknown as readonly T[];
    },
    get length() {
      return requireItems().length;
    },
    get errors() {
      return arrayErrors();
    },
    get ownErrors() {
      return ownErrors();
    },
    get isReady() {
      return (
        host.directErrors(name).length === 0 &&
        requireItems().every((item) => item.isReady)
      );
    },
    get isDirty() {
      return (
        host.isDirtyField(name) ||
        requireItems().some((item) => item.isDirty)
      );
    },
    at(index) {
      return requireItems()[index] as T | undefined;
    },
    add(item) {
      const created = item ?? host.createItem(name);
      if (created === undefined) {
        throw new Error(
          `Нет фабрики элементов для массива "${name}": передайте item или @Field({ array: () => new ItemForm() })`,
        );
      }
      return insert(host, name, requireItems().length, created) as T;
    },
    insert(index, item) {
      const created = item ?? host.createItem(name);
      if (created === undefined) {
        throw new Error(
          `Нет фабрики элементов для массива "${name}": передайте item или @Field({ array: () => new ItemForm() })`,
        );
      }
      return insert(host, name, index, created) as T;
    },
    remove(index) {
      const items = requireItems();
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        throw new RangeError(`Индекс ${index} вне массива "${name}"`);
      }
      const removed = items[index]!;
      const next = [...items];
      next.splice(index, 1);
      host.commit(name, next, [removed]);
      if (!host.isBaseline(removed)) {
        removed.dispose();
      }
    },
    move(from, to) {
      const items = requireItems();
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < 0 ||
        from >= items.length ||
        to >= items.length
      ) {
        throw new RangeError(`Индекс вне массива "${name}"`);
      }
      if (from === to) {
        return;
      }
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      host.commit(name, next, []);
    },
    clear() {
      const items = [...requireItems()];
      if (items.length === 0) {
        return;
      }
      host.commit(name, [], items);
      for (const item of items) {
        if (!host.isBaseline(item)) {
          item.dispose();
        }
      }
    },
  };
}

function insert(
  host: FormArrayHost,
  name: string,
  index: number,
  item: Form,
): Form {
  const items = host.requireItems(name);
  if (!Number.isInteger(index) || index < 0 || index > items.length) {
    throw new RangeError(`Индекс ${index} вне массива "${name}"`);
  }
  host.ensureCanBind(item, name, index);
  const next = [...items];
  next.splice(index, 0, item);
  host.commit(name, next, []);
  return item;
}
