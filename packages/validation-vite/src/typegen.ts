import ts from "typescript";

export interface ValidationBlock {
  readonly position: number;
  readonly code: string;
}

export interface ValidationCodegenOptions {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly runtimeRef: (symbol: ts.Symbol) => string;
  readonly shouldGenerate?: ((declaration: ts.ClassDeclaration) => boolean) | undefined;
  readonly diagnostics?: ((message: string) => void) | undefined;
  readonly strict?: boolean | undefined;
}

type PrimitiveName =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "object"
  | "function"
  | "undefined"
  | "null"
  | "void"
  | "never"
  | "date"
  | "regexp"
  | "map"
  | "set"
  | "weakmap"
  | "weakset"
  | "promise"
  | "error"
  | "arraybuffer"
  | "sharedarraybuffer"
  | "dataview"
  | "url"
  | "urlsearchparams"
  | "iterable"
  | "asynciterable"
  | "iterator"
  | "asynciterator"
  | "int8array"
  | "uint8array"
  | "uint8clampedarray"
  | "int16array"
  | "uint16array"
  | "int32array"
  | "uint32array"
  | "float32array"
  | "float64array"
  | "bigint64array"
  | "biguint64array";

interface ObjectField {
  readonly name: string;
  readonly schema: SchemaNode;
}

interface LazyCell {
  node: SchemaNode | null;
  readonly path: readonly string[];
}

interface BooleanLiteralType {
  readonly intrinsicName?: string;
}

type SchemaNode =
  | { readonly kind: "primitive"; readonly name: PrimitiveName }
  | { readonly kind: "array"; readonly element: SchemaNode }
  | { readonly kind: "tuple"; readonly elements: readonly (SchemaNode | null)[]; readonly rest: SchemaNode | null }
  | { readonly kind: "union"; readonly members: readonly SchemaNode[] }
  | { readonly kind: "intersection"; readonly members: readonly SchemaNode[] }
  | { readonly kind: "literal"; readonly value: string | number | boolean }
  | { readonly kind: "enum"; readonly values: readonly (string | number)[] }
  | { readonly kind: "class"; readonly reference: string }
  | { readonly kind: "object"; readonly fields: readonly ObjectField[] }
  | { readonly kind: "record"; readonly value: SchemaNode }
  | { readonly kind: "mapof"; readonly key: SchemaNode; readonly value: SchemaNode }
  | { readonly kind: "setof"; readonly element: SchemaNode }
  | { readonly kind: "optional"; readonly inner: SchemaNode }
  | { readonly kind: "nullable"; readonly inner: SchemaNode }
  | { readonly kind: "lazy"; readonly cell: LazyCell };

interface SerializeState {
  readonly checker: ts.TypeChecker;
  readonly runtimeRef: (symbol: ts.Symbol) => string;
  readonly sourceFile: ts.SourceFile;
  readonly report: (message: string) => void;
  readonly strict: boolean;
  readonly active: Set<ts.Type>;
  readonly cache: WeakMap<ts.Type, SchemaNode | null>;
  readonly lazy: Map<ts.Type, LazyCell>;
  readonly queue: ts.Type[];
  readonly path: string[];
  depth: number;
}

type ClassLikeDeclaration = ts.ClassDeclaration | ts.ClassExpression;

const SCHEMA_KEY = "silent.validation.schema";
const MAX_DEPTH = 64;
const INDENT_UNIT = "  ";

const BUILTIN_NAMES: Readonly<Record<string, PrimitiveName>> = {
  Date: "date",
  RegExp: "regexp",
  Error: "error",
  ArrayBuffer: "arraybuffer",
  SharedArrayBuffer: "sharedarraybuffer",
  DataView: "dataview",
  URL: "url",
  URLSearchParams: "urlsearchparams",
  Iterable: "iterable",
  AsyncIterable: "asynciterable",
  Iterator: "iterator",
  AsyncIterator: "asynciterator",
  Int8Array: "int8array",
  Uint8Array: "uint8array",
  Uint8ClampedArray: "uint8clampedarray",
  Int16Array: "int16array",
  Uint16Array: "uint16array",
  Int32Array: "int32array",
  Uint32Array: "uint32array",
  Float32Array: "float32array",
  Float64Array: "float64array",
  BigInt64Array: "bigint64array",
  BigUint64Array: "biguint64array",
  Function: "function",
};

const COLLECTION_NAMES: Readonly<Record<string, PrimitiveName>> = {
  Map: "map",
  Set: "set",
  WeakMap: "weakmap",
  WeakSet: "weakset",
  Promise: "promise",
};

function primitive(name: PrimitiveName): SchemaNode {
  return { kind: "primitive", name };
}

function resolveSymbol(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (symbol === undefined) {
    return undefined;
  }
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    return checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

function typeArguments(type: ts.Type, checker: ts.TypeChecker): readonly ts.Type[] {
  if (type.aliasTypeArguments !== undefined && type.aliasTypeArguments.length > 0) {
    return type.aliasTypeArguments;
  }
  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    const objectType = type as ts.ObjectType;
    if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
      return checker.getTypeArguments(type as ts.TypeReference);
    }
  }
  return [];
}

function isDefaultLibFile(sourceFile: ts.SourceFile): boolean {
  const name = sourceFile.fileName;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return /^lib(?:\.[^/\\]+)?\.d\.ts$/.test(name.slice(slash + 1));
}

function defaultLibSymbolName(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
): string | null {
  const resolved = resolveSymbol(symbol, checker);
  if (resolved === undefined) {
    return null;
  }
  const valueDeclaration = resolved.valueDeclaration;
  if (
    valueDeclaration !== undefined
    && (ts.isClassDeclaration(valueDeclaration) || ts.isClassExpression(valueDeclaration))
    && !isDefaultLibFile(valueDeclaration.getSourceFile())
  ) {
    return null;
  }
  const declarations = resolved.declarations ?? [];
  for (const declaration of declarations) {
    if (isDefaultLibFile(declaration.getSourceFile())) {
      return resolved.getName();
    }
  }
  return null;
}

function builtinNameOfType(type: ts.Type, checker: ts.TypeChecker): string | null {
  const alias = defaultLibSymbolName(type.aliasSymbol, checker);
  if (alias !== null) {
    return alias;
  }
  return defaultLibSymbolName(type.getSymbol(), checker);
}

function hasBuiltinBase(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
  visited: Set<ts.Type>,
): boolean {
  if (visited.has(type)) {
    return false;
  }
  visited.add(type);
  const bases = type.getBaseTypes() ?? [];
  for (const base of bases) {
    if (defaultLibSymbolName(base.getSymbol(), checker) === name) {
      return true;
    }
    if (hasBuiltinBase(base, name, checker, visited)) {
      return true;
    }
  }
  return false;
}

function enumValueOf(type: ts.Type, checker: ts.TypeChecker): string | number | undefined {
  const symbol = type.getSymbol();
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (declaration !== undefined) {
    const constant = checker.getConstantValue(declaration as ts.EnumMember);
    if (constant !== undefined) {
      return constant;
    }
  }
  const value = (type as ts.LiteralType).value;
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

function enumValuesOf(types: readonly ts.Type[], checker: ts.TypeChecker): readonly (string | number)[] | null {
  if (types.length === 0) {
    return null;
  }
  const values: (string | number)[] = [];
  for (const type of types) {
    if ((type.flags & ts.TypeFlags.EnumLiteral) === 0) {
      return null;
    }
    const value = enumValueOf(type, checker);
    if (value === undefined) {
      return null;
    }
    values.push(value);
  }
  return values;
}

function enumValuesOfSymbol(type: ts.Type, checker: ts.TypeChecker): readonly (string | number)[] | null {
  const symbol = resolveSymbol(type.getSymbol(), checker);
  if (symbol === undefined) {
    return null;
  }
  const declarations = symbol.declarations ?? [];
  for (const declaration of declarations) {
    if (!ts.isEnumDeclaration(declaration)) {
      continue;
    }
    const values: (string | number)[] = [];
    for (const member of declaration.members) {
      const value = checker.getConstantValue(member);
      if (value === undefined) {
        return null;
      }
      values.push(value);
    }
    return values;
  }
  return null;
}

function stripUndefined(node: SchemaNode): SchemaNode {
  return node.kind === "optional" ? node.inner : node;
}

function wrapOptional(node: SchemaNode): SchemaNode {
  return node.kind === "optional" ? node : { kind: "optional", inner: node };
}

function serializeLiteral(type: ts.Type): SchemaNode | null {
  const flags = type.flags;
  if ((flags & ts.TypeFlags.StringLiteral) !== 0) {
    return { kind: "literal", value: (type as ts.StringLiteralType).value };
  }
  if ((flags & ts.TypeFlags.NumberLiteral) !== 0) {
    return { kind: "literal", value: (type as ts.NumberLiteralType).value };
  }
  if ((flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    const intrinsic = (type as ts.Type & BooleanLiteralType).intrinsicName;
    return { kind: "literal", value: intrinsic === "true" };
  }
  if ((flags & ts.TypeFlags.BigIntLiteral) !== 0) {
    return primitive("bigint");
  }
  return null;
}

function booleanLiteralValue(type: ts.Type): boolean | null {
  if ((type.flags & ts.TypeFlags.BooleanLiteral) === 0) {
    return null;
  }
  return (type as ts.Type & BooleanLiteralType).intrinsicName === "true";
}

function serializeUnion(
  type: ts.UnionType,
  state: SerializeState,
): SchemaNode | null {
  const rest: ts.Type[] = [];
  let optional = false;
  let nullable = false;
  for (const member of type.types) {
    if ((member.flags & ts.TypeFlags.Undefined) !== 0) {
      optional = true;
    } else if ((member.flags & ts.TypeFlags.Null) !== 0) {
      nullable = true;
    } else {
      rest.push(member);
    }
  }
  let booleans = 0;
  const restWithoutBooleans: ts.Type[] = [];
  for (const member of rest) {
    if (booleanLiteralValue(member) !== null) {
      booleans += 1;
    } else {
      restWithoutBooleans.push(member);
    }
  }
  const hasBoolean = booleans >= 2;
  if (hasBoolean) {
    rest.length = 0;
    rest.push(...restWithoutBooleans);
  }
  let base: SchemaNode | null;
  if (rest.length === 0) {
    base = hasBoolean ? primitive("boolean") : primitive(optional ? "undefined" : "null");
  } else {
    const values = hasBoolean ? null : enumValuesOf(rest, state.checker);
    if (values !== null) {
      base = { kind: "enum", values };
    } else if (rest.length === 1 && !hasBoolean) {
      base = serializeType(rest[0]!, state);
    } else {
      const members: SchemaNode[] = [];
      if (hasBoolean) {
        members.push(primitive("boolean"));
      }
      for (const member of rest) {
        const schema = serializeType(member, state);
        if (schema === null) {
          return null;
        }
        members.push(schema);
      }
      base = { kind: "union", members };
    }
  }
  if (base === null) {
    return null;
  }
  let result = base;
  if (nullable) {
    result = { kind: "nullable", inner: result };
  }
  if (optional) {
    result = { kind: "optional", inner: result };
  }
  return result;
}

function mergeObjects(members: readonly SchemaNode[]): readonly SchemaNode[] {
  const objects = members.filter((member): member is Extract<SchemaNode, { kind: "object" }> => member.kind === "object");
  if (objects.length < 2) {
    return members;
  }
  const merged = new Map<string, SchemaNode>();
  for (const object of objects) {
    for (const field of object.fields) {
      merged.set(field.name, field.schema);
    }
  }
  const fields: ObjectField[] = [...merged].map(([name, schema]) => ({ name, schema }));
  const others = members.filter((member) => member.kind !== "object");
  if (others.length === 0) {
    return [{ kind: "object", fields }];
  }
  return [...others, { kind: "object", fields }];
}

function serializeIntersection(
  type: ts.IntersectionType,
  state: SerializeState,
): SchemaNode | null {
  const members: SchemaNode[] = [];
  for (const member of type.types) {
    const schema = serializeType(member, state);
    if (schema === null) {
      return null;
    }
    members.push(schema);
  }
  const merged = mergeObjects(members);
  if (merged.length === 1) {
    return merged[0]!;
  }
  return { kind: "intersection", members: merged };
}

function serializeTuple(
  type: ts.TypeReference,
  state: SerializeState,
): SchemaNode | null {
  const args = state.checker.getTypeArguments(type);
  const target = type.target as ts.TupleType;
  const elementFlags = target.elementFlags;
  let restIndex = -1;
  let variadic = false;
  for (let index = 0; index < elementFlags.length; index += 1) {
    const flag = elementFlags[index];
    if (flag === undefined) {
      continue;
    }
    if ((flag & ts.ElementFlags.Variadic) !== 0) {
      variadic = true;
    }
    if ((flag & ts.ElementFlags.Rest) !== 0) {
      restIndex = index;
    }
  }
  if (!variadic && restIndex >= 0 && restIndex === args.length - 1) {
    const elements: (SchemaNode | null)[] = [];
    for (let index = 0; index < restIndex; index += 1) {
      const flag = elementFlags[index];
      if (flag !== undefined && (flag & ts.ElementFlags.Optional) !== 0) {
        elements.push(null);
        continue;
      }
      const schema = serializeType(args[index]!, state);
      if (schema === null) {
        return null;
      }
      elements.push(schema);
    }
    const rest = serializeType(args[restIndex]!, state);
    if (rest === null) {
      return null;
    }
    return { kind: "tuple", elements, rest };
  }
  if (variadic || restIndex >= 0) {
    const elements: SchemaNode[] = [];
    for (const arg of args) {
      const schema = serializeType(arg, state);
      if (schema === null) {
        return null;
      }
      elements.push(schema);
    }
    const element = elements.length === 1 ? elements[0]! : { kind: "union", members: elements } as SchemaNode;
    return { kind: "array", element };
  }
  const elements: (SchemaNode | null)[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = elementFlags[index];
    if (flag !== undefined && (flag & ts.ElementFlags.Optional) !== 0) {
      elements.push(null);
      continue;
    }
    const schema = serializeType(args[index]!, state);
    if (schema === null) {
      return null;
    }
    elements.push(schema);
  }
  return { kind: "tuple", elements, rest: null };
}

function lazyCell(type: ts.Type, state: SerializeState): LazyCell {
  const existing = state.lazy.get(type);
  if (existing !== undefined) {
    return existing;
  }
  const cell: LazyCell = { node: null, path: [...state.path] };
  state.lazy.set(type, cell);
  state.queue.push(type);
  return cell;
}

function reportUnsupported(
  state: SerializeState,
  path: readonly string[],
  type: ts.Type,
): void {
  const message = `${state.sourceFile.fileName}: ${path.join(".")}: тип ${state.checker.typeToString(type)} не поддерживается`;
  state.report(message);
  if (state.strict) {
    throw new Error(message);
  }
}

function isWellKnownSymbolProperty(property: ts.Symbol): boolean {
  if (property.getName().startsWith("__@")) {
    return true;
  }
  for (const declaration of property.declarations ?? []) {
    const name = ts.getNameOfDeclaration(declaration);
    if (name === undefined || !ts.isComputedPropertyName(name)) {
      continue;
    }
    const expression = name.expression;
    if (
      ts.isPropertyAccessExpression(expression)
      && ts.isIdentifier(expression.expression)
      && expression.expression.text === "Symbol"
    ) {
      return true;
    }
  }
  return false;
}

function serializeObjectProperties(
  type: ts.Type,
  state: SerializeState,
): SchemaNode | null {
  const fields: ObjectField[] = [];
  for (const property of state.checker.getPropertiesOfType(type)) {
    if (isWellKnownSymbolProperty(property)) {
      continue;
    }
    const name = property.getName();
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    const propertyType = state.checker.getTypeOfSymbol(property);
    state.path.push(name);
    let schema: SchemaNode | null;
    try {
      schema = serializeType(propertyType, state);
      if (schema === null) {
        reportUnsupported(state, state.path, propertyType);
        continue;
      }
      const optional = (property.flags & ts.SymbolFlags.Optional) !== 0
        || (declaration !== undefined && (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) && declaration.questionToken !== undefined);
      if (optional) {
        schema = wrapOptional(stripUndefined(schema));
      }
      fields.push({ name, schema });
    } finally {
      state.path.pop();
    }
  }
  return { kind: "object", fields };
}

function serializeObject(
  type: ts.Type,
  state: SerializeState,
): SchemaNode | null {
  if (state.checker.isTupleType(type)) {
    return serializeTuple(type as ts.TypeReference, state);
  }
  const args = typeArguments(type, state.checker);
  const builtin = builtinNameOfType(type, state.checker);
  if (builtin === "Array" || builtin === "ReadonlyArray" || state.checker.isArrayType(type)) {
    const element = args[0] ?? state.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    if (element === undefined) {
      return null;
    }
    const schema = serializeType(element, state);
    return schema === null ? null : { kind: "array", element: schema };
  }
  if (builtin === "WeakMap") {
    return primitive("weakmap");
  }
  if (builtin === "WeakSet") {
    return primitive("weakset");
  }
  if (builtin === "Map" || builtin === "ReadonlyMap") {
    const key = args[0];
    const value = args[1];
    if (key === undefined || value === undefined) {
      return primitive("map");
    }
    const keySchema = serializeType(key, state);
    const valueSchema = serializeType(value, state);
    if (keySchema === null || valueSchema === null) {
      return null;
    }
    return { kind: "mapof", key: keySchema, value: valueSchema };
  }
  if (builtin === "Set" || builtin === "ReadonlySet") {
    const element = args[0];
    if (element === undefined) {
      return primitive("set");
    }
    const schema = serializeType(element, state);
    return schema === null ? null : { kind: "setof", element: schema };
  }
  if (builtin === "Promise") {
    return primitive("promise");
  }
  if (builtin !== null) {
    const named = BUILTIN_NAMES[builtin];
    if (named !== undefined) {
      return primitive(named);
    }
    const collection = COLLECTION_NAMES[builtin];
    if (collection !== undefined) {
      return primitive(collection);
    }
  }
  if (hasBuiltinBase(type, "Error", state.checker, new Set<ts.Type>())) {
    return primitive("error");
  }
  if (type.getCallSignatures().length > 0) {
    return primitive("function");
  }
  if (builtin === "Record" && args.length === 2) {
    const valueSchema = serializeType(args[1]!, state);
    return valueSchema === null ? null : { kind: "record", value: valueSchema };
  }
  const properties = state.checker.getPropertiesOfType(type);
  const stringIndex = state.checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (properties.length === 0 && stringIndex !== undefined) {
    const valueSchema = serializeType(stringIndex, state);
    return valueSchema === null ? null : { kind: "record", value: valueSchema };
  }
  if (builtin !== null) {
    return primitive("object");
  }
  const symbol = resolveSymbol(type.getSymbol(), state.checker);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (symbol !== undefined && declaration !== undefined && (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))) {
    if (declaration.name === undefined) {
      return null;
    }
    return { kind: "class", reference: state.runtimeRef(symbol) };
  }
  const objectNode = serializeObjectProperties(type, state);
  if (objectNode === null) {
    return null;
  }
  if (properties.length > 0 && stringIndex !== undefined) {
    const valueSchema = serializeType(stringIndex, state);
    if (valueSchema !== null) {
      return { kind: "intersection", members: [objectNode, { kind: "record", value: valueSchema }] };
    }
  }
  return objectNode;
}

function serializeTypeUncached(type: ts.Type, state: SerializeState): SchemaNode | null {
  const flags = type.flags;
  if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0) {
    return null;
  }
  if ((flags & ts.TypeFlags.Boolean) !== 0) {
    return primitive("boolean");
  }
  if ((flags & ts.TypeFlags.String) !== 0) {
    return primitive("string");
  }
  if ((flags & ts.TypeFlags.Number) !== 0) {
    return primitive("number");
  }
  if ((flags & ts.TypeFlags.BigInt) !== 0) {
    return primitive("bigint");
  }
  if ((flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) !== 0) {
    return primitive("symbol");
  }
  if ((flags & ts.TypeFlags.NonPrimitive) !== 0) {
    return primitive("object");
  }
  if ((flags & ts.TypeFlags.EnumLiteral) !== 0 && (flags & ts.TypeFlags.Union) === 0) {
    const values = enumValuesOf([type], state.checker);
    return values === null ? null : { kind: "enum", values };
  }
  if ((flags & ts.TypeFlags.Union) !== 0) {
    return serializeUnion(type as ts.UnionType, state);
  }
  if ((flags & ts.TypeFlags.Intersection) !== 0) {
    return serializeIntersection(type as ts.IntersectionType, state);
  }
  if ((flags & ts.TypeFlags.Enum) !== 0) {
    const values = enumValuesOfSymbol(type, state.checker);
    return values === null ? null : { kind: "enum", values };
  }
  const literal = serializeLiteral(type);
  if (literal !== null) {
    return literal;
  }
  if ((flags & ts.TypeFlags.Never) !== 0) {
    return primitive("never");
  }
  if ((flags & ts.TypeFlags.Void) !== 0) {
    return primitive("void");
  }
  if ((flags & ts.TypeFlags.Undefined) !== 0) {
    return primitive("undefined");
  }
  if ((flags & ts.TypeFlags.Null) !== 0) {
    return primitive("null");
  }
  if ((flags & ts.TypeFlags.Object) !== 0) {
    const object = type as ts.ObjectType;
    if (
      (object.objectFlags & ts.ObjectFlags.Mapped) !== 0
      && state.checker.getPropertiesOfType(type).length === 0
      && state.checker.getIndexTypeOfType(type, ts.IndexKind.String) === undefined
      && state.checker.getIndexTypeOfType(type, ts.IndexKind.Number) === undefined
    ) {
      return null;
    }
    return serializeObject(type, state);
  }
  return null;
}

function serializeType(type: ts.Type, state: SerializeState): SchemaNode | null {
  if (state.active.has(type)) {
    return { kind: "lazy", cell: lazyCell(type, state) };
  }
  const cached = state.cache.get(type);
  if (cached !== undefined) {
    return cached;
  }
  if (state.depth >= MAX_DEPTH) {
    return { kind: "lazy", cell: lazyCell(type, state) };
  }
  state.active.add(type);
  state.depth += 1;
  try {
    const node = serializeTypeUncached(type, state);
    state.cache.set(type, node);
    return node;
  } finally {
    state.depth -= 1;
    state.active.delete(type);
  }
}

function formatTuple(node: Extract<SchemaNode, { kind: "tuple" }>, names: ReadonlyMap<LazyCell, string>): string {
  const elements = node.elements
    .map((element) => (element === null ? "null" : renderNode(element, names)))
    .join(",");
  if (node.rest === null) {
    return `["tuple",[${elements}]]`;
  }
  return `["tuple",[${elements}],${renderNode(node.rest, names)}]`;
}

function renderNode(node: SchemaNode, names: ReadonlyMap<LazyCell, string>): string {
  switch (node.kind) {
    case "primitive":
      return JSON.stringify(node.name);
    case "array":
      return `["array",${renderNode(node.element, names)}]`;
    case "tuple":
      return formatTuple(node, names);
    case "union":
      return `["union",[${node.members.map((member) => renderNode(member, names)).join(",")}]]`;
    case "intersection":
      return `["intersection",[${node.members.map((member) => renderNode(member, names)).join(",")}]]`;
    case "literal":
      return `["literal",${JSON.stringify(node.value)}]`;
    case "enum":
      return `["enum",[${node.values.map((value) => JSON.stringify(value)).join(",")}]]`;
    case "class":
      return `["class",()=>${node.reference}]`;
    case "lazy":
      return `["lazy",()=>${names.get(node.cell) ?? "undefined"}]`;
    case "object":
      return `["object",{${node.fields.map((field) => `${JSON.stringify(field.name)}:${renderNode(field.schema, names)}`).join(",")}}]`;
    case "record":
      return `["record",${renderNode(node.value, names)}]`;
    case "mapof":
      return `["mapof",${renderNode(node.key, names)},${renderNode(node.value, names)}]`;
    case "setof":
      return `["setof",${renderNode(node.element, names)}]`;
    case "optional":
      return `["optional",${renderNode(node.inner, names)}]`;
    case "nullable":
      return `["nullable",${renderNode(node.inner, names)}]`;
  }
}

interface RenderedFields {
  readonly fields: string;
  readonly definitions: readonly string[];
}

function renderFields(entries: readonly ObjectField[]): RenderedFields {
  const names = new Map<LazyCell, string>();
  const collect = (node: SchemaNode): void => {
    switch (node.kind) {
      case "array":
        collect(node.element);
        return;
      case "tuple":
        for (const element of node.elements) {
          if (element !== null) {
            collect(element);
          }
        }
        if (node.rest !== null) {
          collect(node.rest);
        }
        return;
      case "union":
      case "intersection":
        for (const member of node.members) {
          collect(member);
        }
        return;
      case "object":
        for (const field of node.fields) {
          collect(field.schema);
        }
        return;
      case "record":
        collect(node.value);
        return;
      case "mapof":
        collect(node.key);
        collect(node.value);
        return;
      case "setof":
        collect(node.element);
        return;
      case "optional":
      case "nullable":
        collect(node.inner);
        return;
      case "lazy":
        if (names.has(node.cell)) {
          return;
        }
        names.set(node.cell, `lazy${names.size}`);
        if (node.cell.node !== null) {
          collect(node.cell.node);
        }
        return;
      default:
        return;
    }
  };
  for (const entry of entries) {
    collect(entry.schema);
  }
  const definitions = [...names].map(
    ([cell, name]) => `const ${name} = ${renderNode(cell.node ?? primitive("object"), names)};`,
  );
  const fields = entries
    .map((entry) => `${JSON.stringify(entry.name)}: ${renderNode(entry.schema, names)}`)
    .join(", ");
  return { fields, definitions };
}

function fieldSchema(field: ts.AutoAccessorPropertyDeclaration, state: SerializeState): SchemaNode | null {
  if (field.type === undefined) {
    return null;
  }
  const type = state.checker.getTypeFromTypeNode(field.type);
  return serializeType(type, state);
}

function hasStaticModifier(member: ts.ClassElement): boolean {
  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
  if (modifiers === undefined) {
    return false;
  }
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
}

function lineBreakOf(sourceFile: ts.SourceFile): string {
  return sourceFile.text.includes("\r\n") ? "\r\n" : "\n";
}

function closingPosition(sourceFile: ts.SourceFile, declaration: ClassLikeDeclaration): number {
  const end = declaration.getEnd();
  const position = end - 1;
  if (sourceFile.text[position] === "}") {
    return position;
  }
  const fallback = sourceFile.text.lastIndexOf("}", end);
  return fallback >= 0 ? fallback : position;
}

function blockIndentation(sourceFile: ts.SourceFile, position: number, declaration: ClassLikeDeclaration): { readonly closing: string; readonly lead: string } {
  const lineStart = sourceFile.text.lastIndexOf("\n", position - 1) + 1;
  const prefix = sourceFile.text.slice(lineStart, position);
  if (lineStart > 0 && /^[ \t]*$/.test(prefix)) {
    return { closing: prefix, lead: "" };
  }
  const declarationStart = declaration.getStart(sourceFile);
  const declarationLineStart = sourceFile.text.lastIndexOf("\n", declarationStart - 1) + 1;
  const declarationPrefix = sourceFile.text.slice(declarationLineStart, declarationStart);
  const closing = /^[ \t]*$/.test(declarationPrefix) ? declarationPrefix : "";
  return { closing, lead: `${lineBreakOf(sourceFile)}${closing}` };
}

function flushLazy(state: SerializeState): void {
  while (state.queue.length > 0) {
    const type = state.queue.shift();
    if (type === undefined) {
      continue;
    }
    const cell = state.lazy.get(type);
    if (cell === undefined || cell.node !== null) {
      continue;
    }
    const traversal: SerializeState = {
      ...state,
      active: new Set<ts.Type>(),
      path: [...cell.path],
      depth: 0,
    };
    const node = serializeType(type, traversal);
    cell.node = node === null || (node.kind === "lazy" && node.cell === cell)
      ? primitive("object")
      : node;
  }
}

function buildBlock(
  sourceFile: ts.SourceFile,
  declaration: ClassLikeDeclaration,
  entries: readonly ObjectField[],
): ValidationBlock {
  const position = closingPosition(sourceFile, declaration);
  const indentation = blockIndentation(sourceFile, position, declaration);
  const newline = lineBreakOf(sourceFile);
  const inner = `${indentation.closing}${INDENT_UNIT}${INDENT_UNIT}`;
  const memberIndent = `${indentation.closing}${INDENT_UNIT}`;
  const rendered = renderFields(entries);
  const definitions = rendered.definitions.map((definition) => `${inner}${definition}`);
  const assignment = `this[Symbol.for(${JSON.stringify(SCHEMA_KEY)})] = { version: 1, fields: { ${rendered.fields} } };`;
  const code = [
    `${indentation.lead}${INDENT_UNIT}static {`,
    ...definitions,
    `${inner}${assignment}`,
    `${memberIndent}}`,
    `${indentation.closing}`,
  ].join(newline);
  return { position, code };
}

function collectClasses(node: ts.Node, classes: ClassLikeDeclaration[]): void {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    classes.push(node);
  }
  ts.forEachChild(node, (child) => {
    collectClasses(child, classes);
  });
}

function classLikeName(declaration: ClassLikeDeclaration): string | undefined {
  if (declaration.name !== undefined) {
    return declaration.name.text;
  }
  const parent = declaration.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

function shouldEmit(
  shouldGenerate: ((declaration: ts.ClassDeclaration) => boolean) | undefined,
  declaration: ClassLikeDeclaration,
): boolean {
  if (shouldGenerate === undefined) {
    return true;
  }
  return shouldGenerate(declaration as ts.ClassDeclaration);
}

export function generateValidationBlocks(
  options: ValidationCodegenOptions,
): readonly ValidationBlock[] {
  const { sourceFile, checker, runtimeRef, shouldGenerate } = options;
  const blocks: ValidationBlock[] = [];
  const classes: ClassLikeDeclaration[] = [];
  const cache = new WeakMap<ts.Type, SchemaNode | null>();
  const lazy = new Map<ts.Type, LazyCell>();
  const queue: ts.Type[] = [];
  const reported = new Set<string>();
  const report = (message: string): void => {
    if (reported.has(message)) {
      return;
    }
    reported.add(message);
    options.diagnostics?.(message);
  };
  collectClasses(sourceFile, classes);
  for (const declaration of classes) {
    const className = classLikeName(declaration);
    if (className === undefined) {
      continue;
    }
    if (!shouldEmit(shouldGenerate, declaration)) {
      continue;
    }
    if (sourceFile.text.slice(declaration.getStart(sourceFile), declaration.getEnd()).includes(SCHEMA_KEY)) {
      continue;
    }
    const state: SerializeState = {
      checker,
      runtimeRef,
      sourceFile,
      report,
      strict: options.strict === true,
      active: new Set<ts.Type>(),
      cache,
      lazy,
      queue,
      path: [className],
      depth: 0,
    };
    const entries: ObjectField[] = [];
    for (const member of declaration.members) {
      if (!ts.isAutoAccessorPropertyDeclaration(member)) {
        continue;
      }
      if (hasStaticModifier(member)) {
        continue;
      }
      if (!ts.isIdentifier(member.name)) {
        continue;
      }
      const name = member.name.text;
      state.path.push(name);
      let schema: SchemaNode | null;
      try {
        schema = fieldSchema(member, state);
      } finally {
        state.path.pop();
      }
      if (schema === null) {
        if (member.type !== undefined) {
          const type = checker.getTypeFromTypeNode(member.type);
          reportUnsupported(state, [className, name], type);
        }
        continue;
      }
      entries.push({ name, schema });
    }
    if (entries.length === 0) {
      continue;
    }
    flushLazy(state);
    blocks.push(buildBlock(sourceFile, declaration, entries));
  }
  return blocks;
}
