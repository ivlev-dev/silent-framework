import type { Form } from "./form.js";

/** Внутренние ссылки/контекст формы для модуля вложенности. */
export interface NestedLink {
  readonly form: Form;
  readonly ownIdPrefix: string;
  readonly children: Map<string, Form>;
  readonly arrayChildren: Map<string, Form[]>;
  readonly metadata: ReadonlyMap<string, unknown>;
  parentForm: Form | undefined;
  parentField: string | undefined;
  idPrefix: string;
  idPath: string;
  readValue(name: string): unknown;
  invalidateProps(name: string): void;
  clearProps(): void;
}

const links = new WeakMap<object, NestedLink>();

export function registerNestedLink(form: object, link: NestedLink): void {
  links.set(form, link);
}

function linkOf(form: Form): NestedLink {
  const link = links.get(form);
  if (link === undefined) {
    throw new Error("Вложенная форма не зарегистрирована");
  }
  return link;
}

/** Проверяет владение/цикл без изменения состояния. */
export function ensureCanBind(
  child: Form,
  parent: Form,
  field: string,
): void {
  const childLink = linkOf(child);
  let cursor: Form | undefined = parent;
  while (cursor !== undefined) {
    if (cursor === child) {
      throw new Error("Вложенная форма не может образовывать цикл");
    }
    cursor = linkOf(cursor).parentForm;
  }
  if (childLink.parentForm !== undefined) {
    if (childLink.parentForm === parent && childLink.parentField === field) {
      return;
    }
    const owner = childLink.parentForm.constructor.name;
    const ownerField = childLink.parentField ?? "?";
    throw new Error(
      `Экземпляр формы ${child.constructor.name} уже используется как поле формы ${owner}.${ownerField}`,
    );
  }
}

export function bindParent(
  child: Form,
  parent: Form,
  field: string,
): void {
  const childLink = linkOf(child);
  if (childLink.parentForm === parent && childLink.parentField === field) {
    return;
  }
  ensureCanBind(child, parent, field);
  const parentLink = linkOf(parent);
  childLink.parentForm = parent;
  childLink.parentField = field;
  const path = parentLink.idPath === ""
    ? field
    : `${parentLink.idPath}.${field}`;
  refreshIdContext(child, parentLink.idPrefix, path);
}

export function refreshIdContext(
  form: Form,
  prefix: string,
  path: string,
): void {
  const link = linkOf(form);
  link.idPrefix = prefix;
  link.idPath = path;
  link.clearProps();
  for (const [name, child] of link.children) {
    const childPath = path === "" ? name : `${path}.${name}`;
    refreshIdContext(child, prefix, childPath);
  }
  for (const [name, items] of link.arrayChildren) {
    for (let index = 0; index < items.length; index += 1) {
      const itemPath = `${name}[${index}]`;
      refreshIdContext(
        items[index]!,
        prefix,
        path === "" ? itemPath : `${path}.${itemPath}`,
      );
    }
  }
}

export function attachChild(host: NestedLink, name: string, child: Form): void {
  const current = host.children.get(name);
  if (current === child) {
    bindParent(child, host.form, name);
    return;
  }
  bindParent(child, host.form, name);
  if (current !== undefined) {
    detachChild(host, name, current);
  }
  host.children.set(name, child);
  host.invalidateProps(name);
}

export function detachChild(host: NestedLink, name: string, child: Form): void {
  if (host.children.get(name) === child) {
    host.children.delete(name);
  }
  const childLink = linkOf(child);
  if (childLink.parentForm === host.form && childLink.parentField === name) {
    childLink.parentForm = undefined;
    childLink.parentField = undefined;
    refreshIdContext(child, childLink.ownIdPrefix, "");
  }
  host.invalidateProps(name);
}

export function assignArrayItem(
  host: NestedLink,
  item: Form,
  name: string,
  index: number,
): void {
  const link = linkOf(item);
  link.parentForm = host.form;
  link.parentField = `${name}[${index}]`;
  const local = `${name}[${index}]`;
  refreshIdContext(
    item,
    host.idPrefix,
    host.idPath === "" ? local : `${host.idPath}.${local}`,
  );
}

/**
 * Массив уже связан с этой формой и не изменился по составу, порядку
 * и id-контексту. В этом случае пересборка id и сброс props-кэша не нужны.
 */
function sameArrayItems(
  host: NestedLink,
  name: string,
  items: Form[],
): boolean {
  const previous = host.arrayChildren.get(name);
  if (previous === undefined || previous.length !== items.length) {
    return false;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (previous[index] !== item) {
      return false;
    }
    const link = linkOf(item);
    if (
      link.parentForm !== host.form ||
      link.parentField !== `${name}[${index}]` ||
      link.idPrefix !== host.idPrefix
    ) {
      return false;
    }
    const local = `${name}[${index}]`;
    const expectedPath = host.idPath === "" ? local : `${host.idPath}.${local}`;
    if (link.idPath !== expectedPath) {
      return false;
    }
  }
  return true;
}

export function bindArrayChildren(
  host: NestedLink,
  name: string,
  items: Form[],
): void {
  if (sameArrayItems(host, name, items)) {
    return;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const link = linkOf(item);
    if (link.parentForm === host.form) {
      continue;
    }
    ensureCanBind(item, host.form, `${name}[${index}]`);
  }
  const previous = host.arrayChildren.get(name);
  if (previous !== undefined) {
    for (const item of previous) {
      if (!items.includes(item)) {
        const link = linkOf(item);
        if (link.parentForm === host.form) {
          link.parentForm = undefined;
          link.parentField = undefined;
          refreshIdContext(item, link.ownIdPrefix, "");
        }
      }
    }
  }
  host.arrayChildren.set(name, items);
  for (let index = 0; index < items.length; index += 1) {
    assignArrayItem(host, items[index]!, name, index);
  }
  host.invalidateProps(name);
}

export function detachArray(host: NestedLink, name: string): void {
  const items = host.arrayChildren.get(name);
  if (items === undefined) {
    return;
  }
  host.arrayChildren.delete(name);
  for (const item of items) {
    const link = linkOf(item);
    if (link.parentForm === host.form) {
      link.parentForm = undefined;
      link.parentField = undefined;
      refreshIdContext(item, link.ownIdPrefix, "");
    }
  }
  host.invalidateProps(name);
}

export function syncChildren(host: NestedLink): void {
  for (const name of host.metadata.keys()) {
    const value = host.readValue(name);
    const current = host.children.get(name);
    const formValue = value as Form | undefined;
    if (formValue !== undefined && isNestedForm(formValue)) {
      detachArray(host, name);
      if (current !== formValue) {
        attachChild(host, name, formValue);
      }
      continue;
    }
    const tracked = host.arrayChildren.get(name);
    if (Array.isArray(value)) {
      const items: Form[] = [];
      let isFormArray = tracked !== undefined;
      for (const item of value) {
        if (isNestedForm(item)) {
          items.push(item);
          isFormArray = true;
        } else {
          isFormArray = false;
          break;
        }
      }
      if (isFormArray) {
        if (current !== undefined) {
          detachChild(host, name, current);
        }
        bindArrayChildren(host, name, items);
        continue;
      }
    }
    if (current !== undefined) {
      detachChild(host, name, current);
    }
    detachArray(host, name);
  }
}

export function isNestedForm(value: unknown): value is Form {
  return typeof value === "object" && value !== null && links.has(value);
}

export function bindInitialField(
  host: NestedLink,
  name: string,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return;
    }
    const items: Form[] = [];
    for (const item of value) {
      if (!isNestedForm(item)) {
        return;
      }
      items.push(item);
    }
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const link = linkOf(item);
      if (link.parentForm === undefined) {
        bindParent(item, host.form, `${name}[${index}]`);
      } else if (link.parentForm !== host.form) {
        return;
      }
    }
    const current = host.children.get(name);
    if (current !== undefined) {
      detachChild(host, name, current);
    }
    host.arrayChildren.set(name, items);
    for (let index = 0; index < items.length; index += 1) {
      assignArrayItem(host, items[index]!, name, index);
    }
    host.invalidateProps(name);
    return;
  }
  if (!isNestedForm(value)) {
    return;
  }
  const child = value;
  const childLink = linkOf(child);
  if (childLink.parentForm !== undefined) {
    return;
  }
  const current = host.children.get(name);
  bindParent(child, host.form, name);
  if (current !== undefined && current !== child) {
    detachChild(host, name, current);
  }
  host.children.set(name, child);
  host.invalidateProps(name);
}

/** Отвязывает элемент массива от текущего родителя и сбрасывает id-контекст. */
export function releaseArrayItem(item: Form): void {
  const link = linkOf(item);
  if (link.parentForm === undefined) {
    return;
  }
  link.parentForm = undefined;
  link.parentField = undefined;
  refreshIdContext(item, link.ownIdPrefix, "");
}
