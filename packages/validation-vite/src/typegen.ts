import ts from "typescript";

export interface ValidationBlock {
  readonly position: number;
  readonly code: string;
  readonly className?: string;
  readonly fields?: ReadonlyMap<string, ValidationSchemaNode>;
  readonly unavailableFields?: readonly string[];
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

export interface ValidationObjectField {
  readonly name: string;
  readonly schema: ValidationSchemaNode;
}

export interface ValidationLazyCell {
  node: ValidationSchemaNode | null;
  readonly path: readonly string[];
}

interface BooleanLiteralType {
  readonly intrinsicName?: string;
}

export type ValidationSchemaNode =
  | { readonly kind: "primitive"; readonly name: PrimitiveName }
  | { readonly kind: "array"; readonly element: ValidationSchemaNode }
  | { readonly kind: "tuple"; readonly elements: readonly ValidationSchemaNode[]; readonly rest: ValidationSchemaNode | null }
  | { readonly kind: "union"; readonly members: readonly ValidationSchemaNode[] }
  | { readonly kind: "intersection"; readonly members: readonly ValidationSchemaNode[] }
  | { readonly kind: "literal"; readonly value: string | number | boolean }
  | { readonly kind: "enum"; readonly values: readonly (string | number)[] }
  | { readonly kind: "class"; readonly reference: string }
  | { readonly kind: "object"; readonly fields: readonly ValidationObjectField[] }
  | { readonly kind: "record"; readonly value: ValidationSchemaNode }
  | { readonly kind: "mapof"; readonly key: ValidationSchemaNode; readonly value: ValidationSchemaNode }
  | { readonly kind: "setof"; readonly element: ValidationSchemaNode }
  | { readonly kind: "optional"; readonly inner: ValidationSchemaNode }
  | { readonly kind: "nullable"; readonly inner: ValidationSchemaNode }
  | { readonly kind: "lazy"; readonly cell: ValidationLazyCell };

type ObjectField = ValidationObjectField;
type LazyCell = ValidationLazyCell;
type SchemaNode = ValidationSchemaNode;

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

const BUILTIN_NAMES: ReadonlyMap<string, PrimitiveName> = new Map<string, PrimitiveName>([
  ["Date", "date"],
  ["RegExp", "regexp"],
  ["Error", "error"],
  ["ArrayBuffer", "arraybuffer"],
  ["SharedArrayBuffer", "sharedarraybuffer"],
  ["DataView", "dataview"],
  ["URL", "url"],
  ["URLSearchParams", "urlsearchparams"],
  ["Iterable", "iterable"],
  ["AsyncIterable", "asynciterable"],
  ["Iterator", "iterator"],
  ["AsyncIterator", "asynciterator"],
  ["Int8Array", "int8array"],
  ["Uint8Array", "uint8array"],
  ["Uint8ClampedArray", "uint8clampedarray"],
  ["Int16Array", "int16array"],
  ["Uint16Array", "uint16array"],
  ["Int32Array", "int32array"],
  ["Uint32Array", "uint32array"],
  ["Float32Array", "float32array"],
  ["Float64Array", "float64array"],
  ["BigInt64Array", "bigint64array"],
  ["BigUint64Array", "biguint64array"],
  ["Function", "function"],
]);

const COLLECTION_NAMES: ReadonlyMap<string, PrimitiveName> = new Map<string, PrimitiveName>([
  ["Map", "map"],
  ["Set", "set"],
  ["WeakMap", "weakmap"],
  ["WeakSet", "weakset"],
  ["Promise", "promise"],
]);

const TYPED_ARRAY_BASES: readonly (readonly [string, PrimitiveName])[] = [
  ["Int8Array", "int8array"],
  ["Uint8Array", "uint8array"],
  ["Uint8ClampedArray", "uint8clampedarray"],
  ["Int16Array", "int16array"],
  ["Uint16Array", "uint16array"],
  ["Int32Array", "int32array"],
  ["Uint32Array", "uint32array"],
  ["Float32Array", "float32array"],
  ["Float64Array", "float64array"],
  ["BigInt64Array", "bigint64array"],
  ["BigUint64Array", "biguint64array"],
];

const WILDCARD_MEMBERS: readonly PrimitiveName[] = [
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "object",
  "function",
  "undefined",
  "null",
];

function primitive(name: PrimitiveName): SchemaNode {
  return { kind: "primitive", name };
}

function wildcardNode(): SchemaNode {
  return {
    kind: "union",
    members: WILDCARD_MEMBERS.map((name) => primitive(name)),
  };
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

function baseFileName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
  return fileName.slice(slash + 1);
}

function isDefaultLibFile(sourceFile: ts.SourceFile): boolean {
  return /^lib(?:\.[^/\\]+)?\.d\.ts$/.test(baseFileName(sourceFile.fileName));
}

function isDomLibFile(sourceFile: ts.SourceFile): boolean {
  return /^lib\.(?:dom|webworker|scripthost)/.test(baseFileName(sourceFile.fileName));
}

function isNodeDeclarationFile(sourceFile: ts.SourceFile): boolean {
  return /[\\/]@types[\\/]node[\\/]/.test(sourceFile.fileName);
}

function isOpaqueDeclaration(sourceFile: ts.SourceFile): boolean {
  return isDomLibFile(sourceFile) || isNodeDeclarationFile(sourceFile);
}

function isGlobalAugmentation(declaration: ts.Node): boolean {
  let node: ts.Node | undefined = declaration.parent;
  while (node !== undefined) {
    if (ts.isModuleDeclaration(node) && (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function hasDeclareModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
}

function isAmbientWithoutRuntime(declaration: ts.Node): boolean {
  if (isGlobalAugmentation(declaration)) {
    return true;
  }
  if (declaration.getSourceFile().isDeclarationFile) {
    return false;
  }
  let node: ts.Node | undefined = declaration;
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (hasDeclareModifier(node)) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function typeIsOpaque(type: ts.Type, checker: ts.TypeChecker): boolean {
  const symbols = [type.aliasSymbol, type.getSymbol()];
  for (const symbol of symbols) {
    const resolved = resolveSymbol(symbol, checker);
    if (resolved === undefined) {
      continue;
    }
    for (const declaration of resolved.declarations ?? []) {
      if (isOpaqueDeclaration(declaration.getSourceFile())) {
        return true;
      }
    }
  }
  return false;
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

function builtinCollectionNode(name: string): SchemaNode | null {
  const named = BUILTIN_NAMES.get(name);
  if (named !== undefined) {
    return primitive(named);
  }
  const collection = COLLECTION_NAMES.get(name);
  if (collection !== undefined) {
    return primitive(collection);
  }
  return null;
}

function builtinBaseNode(type: ts.Type, state: SerializeState): SchemaNode | null {
  const bases = type.getBaseTypes() ?? [];
  for (const base of bases) {
    const name = builtinNameOfType(base, state.checker);
    if (name !== null) {
      const node = builtinCollectionNode(name);
      if (node !== null) {
        return node;
      }
      if (name === "Array" || name === "ReadonlyArray") {
        const element = typeArguments(base, state.checker)[0];
        const schema = element === undefined ? null : serializeType(element, state);
        if (element !== undefined && schema === null) {
          reportUnsupported(state, state.path, element);
        }
        return { kind: "array", element: schema ?? wildcardNode() };
      }
      if (typeIsOpaque(base, state.checker)) {
        return primitive("object");
      }
    } else if (typeIsOpaque(base, state.checker)) {
      return primitive("object");
    }
    const nested = builtinBaseNode(base, state);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
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

function nodeKey(node: SchemaNode, seen: Set<ValidationLazyCell> = new Set()): string {
  switch (node.kind) {
    case "primitive":
      return `p:${node.name}`;
    case "literal":
      return `l:${JSON.stringify(node.value)}`;
    case "enum":
      return `e:${JSON.stringify(node.values)}`;
    case "array":
      return `a:${nodeKey(node.element, seen)}`;
    case "tuple":
      return `t:[${node.elements.map((element) => nodeKey(element, seen)).join(",")}]${node.rest === null ? "" : `:${nodeKey(node.rest, seen)}`}`;
    case "union":
      return `u:[${node.members.map((member) => nodeKey(member, seen)).join(",")}]`;
    case "intersection":
      return `i:[${node.members.map((member) => nodeKey(member, seen)).join(",")}]`;
    case "object":
      return `o:{${node.fields.map((field) => `${JSON.stringify(field.name)}:${nodeKey(field.schema, seen)}`).join(",")}}`;
    case "record":
      return `r:${nodeKey(node.value, seen)}`;
    case "mapof":
      return `m:${nodeKey(node.key, seen)},${nodeKey(node.value, seen)}`;
    case "setof":
      return `s:${nodeKey(node.element, seen)}`;
    case "optional":
      return `q:${nodeKey(node.inner, seen)}`;
    case "nullable":
      return `n:${nodeKey(node.inner, seen)}`;
    case "class":
      return `c:${node.reference}`;
    case "lazy": {
      if (seen.has(node.cell) || node.cell.node === null) {
        return "z:";
      }
      seen.add(node.cell);
      try {
        return `z:${nodeKey(node.cell.node, seen)}`;
      } finally {
        seen.delete(node.cell);
      }
    }
  }
}

function dedupeNodes(nodes: readonly SchemaNode[]): SchemaNode[] {
  const unique = new Map<string, SchemaNode>();
  for (const node of nodes) {
    const key = nodeKey(node);
    if (!unique.has(key)) {
      unique.set(key, node);
    }
  }
  return [...unique.values()];
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
  const unique = dedupeNodes(merged);
  if (unique.length === 1) {
    return unique[0]!;
  }
  return { kind: "intersection", members: unique };
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
    const elements: SchemaNode[] = [];
    for (let index = 0; index < restIndex; index += 1) {
      const flag = elementFlags[index];
      if (flag !== undefined && (flag & ts.ElementFlags.Optional) !== 0) {
        const optional = serializeOptionalElement(args[index]!, state);
        if (optional === null) {
          return null;
        }
        elements.push(optional);
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
  const elements: SchemaNode[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = elementFlags[index];
    if (flag !== undefined && (flag & ts.ElementFlags.Optional) !== 0) {
      const optional = serializeOptionalElement(args[index]!, state);
      if (optional === null) {
        return null;
      }
      elements.push(optional);
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

function serializeOptionalElement(type: ts.Type, state: SerializeState): SchemaNode | null {
  const schema = serializeType(type, state);
  if (schema === null) {
    return null;
  }
  return wrapOptional(stripUndefined(schema));
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

function reportSkipped(
  state: SerializeState,
  path: readonly string[],
  reason: string,
): void {
  const message = `${state.sourceFile.fileName}: ${path.join(".")}: ${reason}`;
  state.report(message);
  if (state.strict) {
    throw new Error(message);
  }
}

function nameTextOf(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    return `[${name.expression.getText(sourceFile)}]`;
  }
  return name.getText(sourceFile);
}

function isWellKnownSymbolProperty(property: ts.Symbol): boolean {
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

function isSymbolNamedProperty(property: ts.Symbol, checker: ts.TypeChecker): boolean {
  if (property.getName().startsWith("__@")) {
    return true;
  }
  for (const declaration of property.declarations ?? []) {
    const name = ts.getNameOfDeclaration(declaration);
    if (name === undefined || !ts.isComputedPropertyName(name)) {
      continue;
    }
    const expressionType = checker.getTypeAtLocation(name.expression);
    if ((expressionType.flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) !== 0) {
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
    if (isSymbolNamedProperty(property, state.checker)) {
      state.path.push(name);
      try {
        reportSkipped(state, state.path, "символьное свойство пропущено");
      } finally {
        state.path.pop();
      }
      continue;
    }
    const propertyType = state.checker.getTypeOfSymbol(property);
    state.path.push(name);
    let schema: SchemaNode | null;
    try {
      schema = serializeType(propertyType, state);
      if (schema === null) {
        reportUnsupported(state, state.path, propertyType);
        continue;
      }
      if ((property.flags & ts.SymbolFlags.Optional) !== 0) {
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
  if (builtin === "ArrayLike" || builtin === "ReadonlyArrayLike") {
    const element = args[0];
    const schema = element === undefined ? null : serializeType(element, state);
    if (element !== undefined && schema === null) {
      reportUnsupported(state, state.path, element);
    }
    return {
      kind: "union",
      members: [
        { kind: "array", element: schema ?? wildcardNode() },
        { kind: "object", fields: [{ name: "length", schema: primitive("number") }] },
      ],
    };
  }
  if (builtin === "Array" || builtin === "ReadonlyArray" || state.checker.isArrayType(type)) {
    const element = args[0] ?? state.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    if (element === undefined) {
      return { kind: "array", element: wildcardNode() };
    }
    const schema = serializeType(element, state);
    if (schema === null) {
      reportUnsupported(state, state.path, element);
    }
    return { kind: "array", element: schema ?? wildcardNode() };
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
    if (keySchema === null) {
      reportUnsupported(state, state.path, key);
    }
    if (valueSchema === null) {
      reportUnsupported(state, state.path, value);
    }
    if (keySchema === null || valueSchema === null) {
      return primitive("map");
    }
    return { kind: "mapof", key: keySchema, value: valueSchema };
  }
  if (builtin === "Set" || builtin === "ReadonlySet") {
    const element = args[0];
    if (element === undefined) {
      return primitive("set");
    }
    const schema = serializeType(element, state);
    if (schema === null) {
      reportUnsupported(state, state.path, element);
    }
    return schema === null ? primitive("set") : { kind: "setof", element: schema };
  }
  if (builtin === "Promise") {
    return primitive("promise");
  }
  if (builtin !== null) {
    const named = BUILTIN_NAMES.get(builtin);
    if (named !== undefined) {
      return primitive(named);
    }
    const collection = COLLECTION_NAMES.get(builtin);
    if (collection !== undefined) {
      return primitive(collection);
    }
  }
  for (const [baseName, typedArray] of TYPED_ARRAY_BASES) {
    if (hasBuiltinBase(type, baseName, state.checker, new Set<ts.Type>())) {
      return primitive(typedArray);
    }
  }
  if (hasBuiltinBase(type, "Error", state.checker, new Set<ts.Type>())) {
    return primitive("error");
  }
  const symbolName = type.getSymbol()?.getName();
  if (builtin === null && symbolName === "Buffer" && typeIsOpaque(type, state.checker)) {
    return primitive("uint8array");
  }
  const symbol = resolveSymbol(type.getSymbol(), state.checker);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (symbol !== undefined && declaration !== undefined && (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))) {
    if (isAmbientWithoutRuntime(declaration)) {
      return { kind: "class", reference: "undefined" };
    }
    const reference = state.runtimeRef(symbol);
    if (!isSafeReference(reference)) {
      state.report(
        `${state.sourceFile.fileName}: ${state.path.join(".")}: ссылка на класс ${JSON.stringify(reference)} не является корректным идентификатором; класс пропущен`,
      );
      return { kind: "class", reference: "undefined" };
    }
    return { kind: "class", reference };
  }
  const baseNode = builtinBaseNode(type, state);
  if (baseNode !== null) {
    return baseNode;
  }
  if (type.getCallSignatures().length > 0) {
    return primitive("function");
  }
  if (builtin === "Record" && args.length === 2) {
    const valueType = args[1]!;
    const valueSchema = serializeType(valueType, state);
    if (valueSchema === null) {
      reportUnsupported(state, state.path, valueType);
      return { kind: "record", value: wildcardNode() };
    }
    return { kind: "record", value: valueSchema };
  }
  if (typeIsOpaque(type, state.checker)) {
    return primitive("object");
  }
  const properties = state.checker.getPropertiesOfType(type);
  const stringIndex = state.checker.getIndexTypeOfType(type, ts.IndexKind.String);
  const numberIndex = state.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  const indexNodes: SchemaNode[] = [];
  if (stringIndex !== undefined) {
    const valueSchema = serializeType(stringIndex, state);
    if (valueSchema === null) {
      reportUnsupported(state, state.path, stringIndex);
    } else {
      indexNodes.push({ kind: "record", value: valueSchema });
    }
  }
  if (numberIndex !== undefined && properties.length === 0) {
    const valueSchema = serializeType(numberIndex, state);
    if (valueSchema === null) {
      reportUnsupported(state, state.path, numberIndex);
    } else {
      indexNodes.push({ kind: "record", value: valueSchema });
    }
  }
  if (properties.length === 0) {
    if (indexNodes.length === 0) {
      return builtin === null ? { kind: "object", fields: [] } : primitive("object");
    }
    const unique = dedupeNodes(indexNodes);
    return unique.length === 1 ? unique[0]! : { kind: "intersection", members: unique };
  }
  const objectNode = serializeObjectProperties(type, state);
  if (objectNode === null) {
    return null;
  }
  if (indexNodes.length > 0) {
    const unique = dedupeNodes(indexNodes);
    return { kind: "intersection", members: dedupeNodes([objectNode, ...unique]) };
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
    .map((element) => renderNode(element, names))
    .join(",");
  if (node.rest === null) {
    return `["tuple",[${elements}]]`;
  }
  return `["tuple",[${elements}],${renderNode(node.rest, names)}]`;
}

export function schemaHasClassRef(
  schema: ValidationSchemaNode,
  isUnavailable: (reference: string) => boolean = (reference) => reference === "undefined",
  seen: Set<ValidationLazyCell> = new Set(),
): boolean {
  switch (schema.kind) {
    case "class":
      return isUnavailable(schema.reference);
    case "array":
      return schemaHasClassRef(schema.element, isUnavailable, seen);
    case "tuple":
      return schema.elements.some((element) => schemaHasClassRef(element, isUnavailable, seen))
        || (schema.rest !== null && schemaHasClassRef(schema.rest, isUnavailable, seen));
    case "union":
    case "intersection":
      return schema.members.some((member) => schemaHasClassRef(member, isUnavailable, seen));
    case "object":
      return schema.fields.some((field) => schemaHasClassRef(field.schema, isUnavailable, seen));
    case "record":
      return schemaHasClassRef(schema.value, isUnavailable, seen);
    case "mapof":
      return schemaHasClassRef(schema.key, isUnavailable, seen)
        || schemaHasClassRef(schema.value, isUnavailable, seen);
    case "setof":
      return schemaHasClassRef(schema.element, isUnavailable, seen);
    case "optional":
    case "nullable":
      return schemaHasClassRef(schema.inner, isUnavailable, seen);
    case "lazy": {
      if (seen.has(schema.cell)) {
        return false;
      }
      seen.add(schema.cell);
      try {
        return schema.cell.node !== null && schemaHasClassRef(schema.cell.node, isUnavailable, seen);
      } finally {
        seen.delete(schema.cell);
      }
    }
    default:
      return false;
  }
}

const REFERENCE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function isSafeReference(reference: string): boolean {
  return reference.split(".").every((part) => REFERENCE_IDENTIFIER.test(part));
}

function renderFieldKey(name: string): string {
  return name === "__proto__" ? '["__proto__"]' : JSON.stringify(name);
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
      return `["object",{${node.fields.map((field) => `${renderFieldKey(field.name)}:${renderNode(field.schema, names)}`).join(",")}}]`;
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
          collect(element);
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
    .map((entry) => `${renderFieldKey(entry.name)}: ${renderNode(entry.schema, names)}`)
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
): { readonly position: number; readonly code: string } {
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

function classLikeName(
  declaration: ClassLikeDeclaration,
  sourceFile: ts.SourceFile,
): string {
  if (declaration.name !== undefined) {
    return declaration.name.text;
  }
  const parent = declaration.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) {
    return nameTextOf(parent.name, sourceFile);
  }
  if (ts.isExportAssignment(parent)) {
    return "default";
  }
  if (ts.isClassDeclaration(declaration)) {
    return "default";
  }
  return "class";
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
    if (isAmbientWithoutRuntime(declaration)) {
      continue;
    }
    const className = classLikeName(declaration, sourceFile);
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
        if (ts.isPrivateIdentifier(member.name)) {
          continue;
        }
        const label = nameTextOf(member.name, sourceFile);
        state.path.push(label);
        try {
          reportSkipped(state, state.path, "поле пропущено: поддерживаются только идентификаторы");
        } finally {
          state.path.pop();
        }
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
    const block = buildBlock(sourceFile, declaration, entries);
    const fields = new Map<string, SchemaNode>(
      entries.map((entry) => [entry.name, entry.schema] as const),
    );
    const unavailableFields = entries
      .filter((entry) => schemaHasClassRef(entry.schema))
      .map((entry) => entry.name);
    blocks.push({ ...block, className, fields, unavailableFields });
  }
  return blocks;
}
