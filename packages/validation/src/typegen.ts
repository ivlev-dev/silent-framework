import ts from "typescript";

export interface ValidationBlock {
  readonly position: number;
  readonly code: string;
}

export interface ValidationCodegenOptions {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly runtimeRef: (symbol: ts.Symbol) => string;
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

interface BooleanLiteralType {
  readonly intrinsicName?: string;
}

type SchemaNode =
  | { readonly kind: "primitive"; readonly name: PrimitiveName }
  | { readonly kind: "array"; readonly element: SchemaNode }
  | { readonly kind: "tuple"; readonly elements: readonly (SchemaNode | null)[] }
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
  | { readonly kind: "nullable"; readonly inner: SchemaNode };

interface SerializeState {
  readonly checker: ts.TypeChecker;
  readonly runtimeRef: (symbol: ts.Symbol) => string;
  readonly seen: Set<ts.Type>;
}

const SCHEMA_KEY = "silent.validation.schema";
const MAX_DEPTH = 4;
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

function symbolNames(type: ts.Type): readonly string[] {
  const names: string[] = [];
  const symbol = type.getSymbol();
  if (symbol !== undefined) {
    names.push(symbol.getName());
  }
  const alias = type.aliasSymbol;
  if (alias !== undefined) {
    names.push(alias.getName());
  }
  return names;
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

function hasBaseNamed(
  type: ts.Type,
  name: string,
  visited: Set<ts.Type>,
): boolean {
  if (visited.has(type)) {
    return false;
  }
  visited.add(type);
  const bases = type.getBaseTypes() ?? [];
  for (const base of bases) {
    if (base.getSymbol()?.getName() === name) {
      return true;
    }
    if (hasBaseNamed(base, name, visited)) {
      return true;
    }
  }
  return false;
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
  depth: number,
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
  if (booleans >= 2) {
    rest.length = 0;
    rest.push(...restWithoutBooleans);
  }
  const hasBoolean = booleans >= 2;
  let base: SchemaNode | null;
  if (rest.length === 0) {
    base = hasBoolean ? primitive("boolean") : primitive(optional ? "undefined" : "null");
  } else {
    const values = enumValuesOf(rest, state.checker);
    if (values !== null) {
      base = { kind: "enum", values };
    } else if (rest.length === 1) {
      base = serializeType(rest[0]!, state, depth);
    } else {
      const members: SchemaNode[] = [];
      if (hasBoolean) {
        members.push(primitive("boolean"));
      }
      for (const member of rest) {
        const schema = serializeType(member, state, depth);
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
  depth: number,
): SchemaNode | null {
  const members: SchemaNode[] = [];
  for (const member of type.types) {
    const schema = serializeType(member, state, depth);
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
  depth: number,
): SchemaNode | null {
  const args = state.checker.getTypeArguments(type);
  const target = type.target as ts.TupleType;
  const elementFlags = target.elementFlags;
  let variadic = false;
  for (const flag of elementFlags) {
    if ((flag & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)) !== 0) {
      variadic = true;
    }
  }
  if (variadic) {
    const elements: SchemaNode[] = [];
    for (const arg of args) {
      const schema = serializeType(arg, state, depth);
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
    const schema = serializeType(args[index]!, state, depth);
    if (schema === null) {
      return null;
    }
    elements.push(schema);
  }
  return { kind: "tuple", elements };
}

function serializeObjectProperties(
  type: ts.Type,
  state: SerializeState,
  depth: number,
): SchemaNode | null {
  if (depth > MAX_DEPTH) {
    return null;
  }
  if (state.seen.has(type)) {
    return null;
  }
  state.seen.add(type);
  try {
    const fields: ObjectField[] = [];
    for (const property of state.checker.getPropertiesOfType(type)) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      const propertyType = state.checker.getTypeOfSymbol(property);
      let schema = serializeType(propertyType, state, depth + 1);
      if (schema === null) {
        continue;
      }
      const optional = (property.flags & ts.SymbolFlags.Optional) !== 0
        || (declaration !== undefined && (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration)) && declaration.questionToken !== undefined);
      if (optional) {
        schema = wrapOptional(stripUndefined(schema));
      }
      fields.push({ name: property.getName(), schema });
    }
    return { kind: "object", fields };
  } finally {
    state.seen.delete(type);
  }
}

function serializeObject(
  type: ts.Type,
  state: SerializeState,
  depth: number,
): SchemaNode | null {
  if (state.checker.isTupleType(type)) {
    return serializeTuple(type as ts.TypeReference, state, depth);
  }
  const args = typeArguments(type, state.checker);
  const names = symbolNames(type);
  if (state.checker.isArrayType(type) || names.includes("Array") || names.includes("ReadonlyArray")) {
    const element = args[0] ?? state.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    if (element === undefined) {
      return null;
    }
    const schema = serializeType(element, state, depth);
    return schema === null ? null : { kind: "array", element: schema };
  }
  if (names.includes("Map") || names.includes("WeakMap")) {
    const key = args[0];
    const value = args[1];
    if (key === undefined || value === undefined) {
      return primitive(names.includes("WeakMap") ? "weakmap" : "map");
    }
    const keySchema = serializeType(key, state, depth);
    const valueSchema = serializeType(value, state, depth);
    if (keySchema === null || valueSchema === null) {
      return null;
    }
    return { kind: "mapof", key: keySchema, value: valueSchema };
  }
  if (names.includes("Set") || names.includes("WeakSet")) {
    const element = args[0];
    if (element === undefined) {
      return primitive(names.includes("WeakSet") ? "weakset" : "set");
    }
    const schema = serializeType(element, state, depth);
    return schema === null ? null : { kind: "setof", element: schema };
  }
  if (names.includes("Promise")) {
    return primitive("promise");
  }
  for (const name of names) {
    const builtin = BUILTIN_NAMES[name];
    if (builtin !== undefined) {
      return primitive(builtin);
    }
    const collection = COLLECTION_NAMES[name];
    if (collection !== undefined) {
      return primitive(collection);
    }
  }
  if (hasBaseNamed(type, "Error", new Set<ts.Type>())) {
    return primitive("error");
  }
  if (type.getCallSignatures().length > 0) {
    return primitive("function");
  }
  if (names.includes("Record") && args.length === 2) {
    const valueSchema = serializeType(args[1]!, state, depth);
    return valueSchema === null ? null : { kind: "record", value: valueSchema };
  }
  const properties = state.checker.getPropertiesOfType(type);
  const stringIndex = state.checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (properties.length === 0 && stringIndex !== undefined) {
    const valueSchema = serializeType(stringIndex, state, depth);
    return valueSchema === null ? null : { kind: "record", value: valueSchema };
  }
  const symbol = resolveSymbol(type.getSymbol(), state.checker);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (symbol !== undefined && declaration !== undefined && (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))) {
    if (declaration.name === undefined) {
      return null;
    }
    return { kind: "class", reference: state.runtimeRef(symbol) };
  }
  return serializeObjectProperties(type, state, depth);
}

function serializeType(type: ts.Type, state: SerializeState, depth: number): SchemaNode | null {
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
    return serializeUnion(type as ts.UnionType, state, depth);
  }
  if ((flags & ts.TypeFlags.Intersection) !== 0) {
    return serializeIntersection(type as ts.IntersectionType, state, depth);
  }
  if ((flags & ts.TypeFlags.Enum) !== 0) {
    const values = enumValuesOfSymbol(type, state.checker);
    return { kind: "enum", values: values ?? [] };
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
    return serializeObject(type, state, depth);
  }
  return null;
}

function renderNode(node: SchemaNode): string {
  switch (node.kind) {
    case "primitive":
      return JSON.stringify(node.name);
    case "array":
      return `["array",${renderNode(node.element)}]`;
    case "tuple":
      return `["tuple",[${node.elements.map((element) => (element === null ? "null" : renderNode(element))).join(",")}]]`;
    case "union":
      return `["union",[${node.members.map(renderNode).join(",")}]]`;
    case "intersection":
      return `["intersection",[${node.members.map(renderNode).join(",")}]]`;
    case "literal":
      return `["literal",${JSON.stringify(node.value)}]`;
    case "enum":
      return `["enum",[${node.values.map((value) => JSON.stringify(value)).join(",")}]]`;
    case "class":
      return `["class",()=>${node.reference}]`;
    case "object":
      return `["object",{${node.fields.map((field) => `${JSON.stringify(field.name)}:${renderNode(field.schema)}`).join(",")}}]`;
    case "record":
      return `["record",${renderNode(node.value)}]`;
    case "mapof":
      return `["mapof",${renderNode(node.key)},${renderNode(node.value)}]`;
    case "setof":
      return `["setof",${renderNode(node.element)}]`;
    case "optional":
      return `["optional",${renderNode(node.inner)}]`;
    case "nullable":
      return `["nullable",${renderNode(node.inner)}]`;
  }
}

function fieldSchema(field: ts.AutoAccessorPropertyDeclaration, state: SerializeState): SchemaNode | null {
  if (field.type === undefined) {
    return null;
  }
  const type = state.checker.getTypeFromTypeNode(field.type);
  return serializeType(type, state, 0);
}

function hasStaticModifier(member: ts.ClassElement): boolean {
  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
  if (modifiers === undefined) {
    return false;
  }
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
}

function closingPosition(sourceFile: ts.SourceFile, declaration: ts.ClassDeclaration): number {
  const end = declaration.getEnd();
  const position = end - 1;
  if (sourceFile.text[position] === "}") {
    return position;
  }
  const fallback = sourceFile.text.lastIndexOf("}", end);
  return fallback >= 0 ? fallback : position;
}

function blockIndentation(sourceFile: ts.SourceFile, position: number, declaration: ts.ClassDeclaration): { readonly closing: string; readonly lead: string } {
  const lineStart = sourceFile.text.lastIndexOf("\n", position - 1) + 1;
  const prefix = sourceFile.text.slice(lineStart, position);
  if (lineStart > 0 && /^[ \t]*$/.test(prefix)) {
    return { closing: prefix, lead: "" };
  }
  const declarationStart = declaration.getStart(sourceFile);
  const declarationLineStart = sourceFile.text.lastIndexOf("\n", declarationStart - 1) + 1;
  const declarationPrefix = sourceFile.text.slice(declarationLineStart, declarationStart);
  const closing = /^[ \t]*$/.test(declarationPrefix) ? declarationPrefix : "";
  return { closing, lead: `\n${closing}` };
}

function buildBlock(
  sourceFile: ts.SourceFile,
  declaration: ts.ClassDeclaration,
  entries: readonly ObjectField[],
): ValidationBlock {
  const position = closingPosition(sourceFile, declaration);
  const indentation = blockIndentation(sourceFile, position, declaration);
  const inner = `${indentation.closing}${INDENT_UNIT}${INDENT_UNIT}`;
  const memberIndent = `${indentation.closing}${INDENT_UNIT}`;
  const fields = entries
    .map((entry) => `${JSON.stringify(entry.name)}: ${renderNode(entry.schema)}`)
    .join(", ");
  const assignment = `this[Symbol.for(${JSON.stringify(SCHEMA_KEY)})] = { fields: { ${fields} } };`;
  const code = [
    `${indentation.lead}${INDENT_UNIT}static {`,
    `${inner}${assignment}`,
    `${memberIndent}}`,
    `${indentation.closing}`,
  ].join("\n");
  return { position, code };
}

function collectClasses(node: ts.Node, classes: ts.ClassDeclaration[]): void {
  if (ts.isClassDeclaration(node)) {
    classes.push(node);
  }
  ts.forEachChild(node, (child) => {
    collectClasses(child, classes);
  });
}

export function generateValidationBlocks(
  options: ValidationCodegenOptions,
): readonly ValidationBlock[] {
  const { sourceFile, checker, runtimeRef } = options;
  const blocks: ValidationBlock[] = [];
  const classes: ts.ClassDeclaration[] = [];
  collectClasses(sourceFile, classes);
  for (const statement of classes) {
    if (statement.name === undefined) {
      continue;
    }
    if (sourceFile.text.slice(statement.getStart(sourceFile), statement.getEnd()).includes(SCHEMA_KEY)) {
      continue;
    }
    const state: SerializeState = { checker, runtimeRef, seen: new Set<ts.Type>() };
    const entries: ObjectField[] = [];
    for (const member of statement.members) {
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
      const schema = fieldSchema(member, state);
      if (schema === null) {
        continue;
      }
      entries.push({ name, schema });
    }
    if (entries.length === 0) {
      continue;
    }
    blocks.push(buildBlock(sourceFile, statement, entries));
  }
  return blocks;
}
