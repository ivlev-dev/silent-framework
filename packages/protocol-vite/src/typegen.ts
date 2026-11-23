import ts from "typescript";
import type { RuntimeRefResolver } from "./runtime-ref.js";
import { classLikeName, isSafeReference } from "./runtime-ref.js";

export type ProtocolPrimitive =
  | "bool"
  | "int32"
  | "uint32"
  | "int64"
  | "uint64"
  | "float32"
  | "float64"
  | "fixed32"
  | "fixed64"
  | "string"
  | "bytes"
  | "date"
  | "bigint";

export type ProtocolLiteral = string | number | boolean | null;

export type ProtocolTypeSchema =
  | ProtocolPrimitive
  | readonly ["literal", ProtocolLiteral]
  | readonly ["enum", readonly (string | number)[]]
  | readonly ["class", () => Function]
  | readonly ["array", ProtocolTypeSchema]
  | readonly ["tuple", readonly ProtocolTypeSchema[]]
  | readonly ["map", ProtocolTypeSchema, ProtocolTypeSchema]
  | readonly ["set", ProtocolTypeSchema]
  | readonly ["optional", ProtocolTypeSchema];

export type SchemaNode =
  | { readonly kind: "primitive"; readonly name: ProtocolPrimitive }
  | { readonly kind: "literal"; readonly value: ProtocolLiteral }
  | { readonly kind: "enum"; readonly values: readonly (string | number)[] }
  | { readonly kind: "class"; readonly reference: string }
  | { readonly kind: "array"; readonly element: SchemaNode }
  | { readonly kind: "tuple"; readonly elements: readonly SchemaNode[] }
  | { readonly kind: "map"; readonly key: SchemaNode; readonly value: SchemaNode }
  | { readonly kind: "set"; readonly element: SchemaNode }
  | { readonly kind: "optional"; readonly inner: SchemaNode };

export interface ProtocolFieldSchema {
  readonly name: string;
  readonly type: SchemaNode;
  readonly optional: boolean;
}

export interface ProtocolVariantSchema {
  readonly value: string | number;
  readonly field: string;
  readonly type: SchemaNode;
}

export interface ProtocolOneofSchema {
  readonly name: string;
  readonly enumReference: string;
  readonly variants: readonly ProtocolVariantSchema[];
}

export interface ProtocolBlock {
  readonly position: number;
  readonly code: string;
  readonly className: string;
  readonly fields: readonly ProtocolFieldSchema[];
  readonly oneofs: readonly ProtocolOneofSchema[];
}

export interface ProtocolCodegenOptions {
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly runtimeRef: RuntimeRefResolver["runtimeRef"];
  readonly diagnostics?: ((message: string) => void) | undefined;
  readonly strict?: boolean | undefined;
  readonly shouldGenerate?: ((declaration: ts.ClassDeclaration | ts.ClassExpression) => boolean) | undefined;
}

type ClassLikeDeclaration = ts.ClassDeclaration | ts.ClassExpression;

interface DecoratorCall {
  readonly name: string;
  readonly args: readonly ts.Expression[];
}

interface OneOfValue {
  readonly valid: boolean;
  readonly value: string | number | undefined;
}

interface FieldDecorators {
  readonly wire: ProtocolPrimitive | null;
  readonly epochMillis: boolean;
  readonly int64OnNumber: boolean;
  readonly oneof: OneOfValue | null;
  readonly errors: readonly string[];
}

interface RawField {
  readonly name: string;
  readonly member: ts.PropertyDeclaration | ts.AutoAccessorPropertyDeclaration;
}

interface EnumMemberInfo {
  readonly name: string;
  readonly value: string | number;
}

interface EnumInfo {
  readonly symbol: ts.Symbol;
  readonly declaration: ts.EnumDeclaration;
  readonly members: readonly EnumMemberInfo[];
  readonly values: readonly (string | number)[];
}

interface PreparedField {
  readonly name: string;
  readonly type: ts.Type;
  readonly node: SchemaNode;
  readonly optional: boolean;
  readonly enumInfo: EnumInfo | null;
  readonly oneof: OneOfValue | null;
}

interface SerializeState {
  readonly checker: ts.TypeChecker;
  readonly runtimeRef: RuntimeRefResolver["runtimeRef"];
  readonly sourceFile: ts.SourceFile;
  readonly report: (message: string) => void;
  readonly active: Set<ts.Type>;
  readonly path: string[];
}

type SerializeResult =
  | { readonly node: SchemaNode; readonly optional: boolean }
  | null;

const SCHEMA_KEY = "silent.protocol.schema";
const MAX_DEPTH = 64;
const INDENT_UNIT = "  ";
const UTF8_ENCODER = new TextEncoder();

const BYTES_NAMES: ReadonlySet<string> = new Set([
  "Uint8Array",
  "ArrayBuffer",
  "Int8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Buffer",
]);

const UNSUPPORTED_NAMES: ReadonlySet<string> = new Set([
  "RegExp",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WeakSet",
  "Promise",
  "Function",
  "Error",
  "DataView",
]);

const WIRE_DECORATORS: ReadonlyMap<string, ProtocolPrimitive> = new Map([
  ["Int32", "int32"],
  ["Uint32", "uint32"],
  ["Float32", "float32"],
  ["Fixed32", "fixed32"],
  ["Fixed64", "fixed64"],
  ["Uint64", "uint64"],
  ["Int64", "int64"],
]);

const KNOWN_DECORATORS: ReadonlySet<string> = new Set([
  ...Array.from(WIRE_DECORATORS.keys()),
  "EpochMillis",
  "OneOf",
]);

function primitive(name: ProtocolPrimitive): SchemaNode {
  return { kind: "primitive", name };
}

function utf8Compare(left: string, right: string): number {
  const a = UTF8_ENCODER.encode(left);
  const b = UTF8_ENCODER.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

function resolveSymbol(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (symbol === undefined) return undefined;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

function typeArgumentsOf(type: ts.Type, checker: ts.TypeChecker): readonly ts.Type[] {
  if (type.aliasTypeArguments !== undefined && type.aliasTypeArguments.length > 0) {
    return type.aliasTypeArguments;
  }
  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    const object = type as ts.ObjectType;
    if ((object.objectFlags & ts.ObjectFlags.Reference) !== 0) {
      return checker.getTypeArguments(type as ts.TypeReference);
    }
  }
  return [];
}

function typeNamesOf(type: ts.Type, checker: ts.TypeChecker): readonly string[] {
  const names: string[] = [];
  const alias = resolveSymbol(type.aliasSymbol, checker);
  if (alias !== undefined) names.push(alias.getName());
  const symbol = resolveSymbol(type.getSymbol(), checker);
  if (symbol !== undefined && !names.includes(symbol.getName())) names.push(symbol.getName());
  return names;
}

function isClassLikeDeclaration(node: ts.Declaration): node is ClassLikeDeclaration {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

function isDefaultLibraryFile(sourceFile: ts.SourceFile): boolean {
  const name = sourceFile.fileName;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return /^lib(?:\.[^/\\]+)?\.d\.ts$/.test(name.slice(slash + 1));
}

function isBuiltinTypeName(
  type: ts.Type,
  name: string,
  checker: ts.TypeChecker,
): boolean {
  if (name === "Buffer") return true;
  const symbol = resolveSymbol(type.getSymbol(), checker);
  const classDeclaration = (symbol?.declarations ?? []).find(isClassLikeDeclaration);
  return classDeclaration === undefined || isDefaultLibraryFile(classDeclaration.getSourceFile());
}

function classDeclarationOf(
  type: ts.Type,
  checker: ts.TypeChecker,
): { readonly symbol: ts.Symbol; readonly declaration: ClassLikeDeclaration } | null {
  const symbol = resolveSymbol(type.getSymbol(), checker);
  if (symbol === undefined) return null;
  for (const declaration of symbol.declarations ?? []) {
    if (isClassLikeDeclaration(declaration)) return { symbol, declaration };
  }
  return null;
}

function enumDeclarationOfSymbol(symbol: ts.Symbol | undefined): ts.EnumDeclaration | null {
  if (symbol === undefined) return null;
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isEnumDeclaration(declaration)) return declaration;
    if (ts.isEnumMember(declaration) && ts.isEnumDeclaration(declaration.parent)) {
      return declaration.parent;
    }
  }
  return null;
}

function enumDeclarationOfType(type: ts.Type, checker: ts.TypeChecker): ts.EnumDeclaration | null {
  const own = enumDeclarationOfSymbol(resolveSymbol(type.getSymbol(), checker));
  if (own !== null) return own;
  const alias = enumDeclarationOfSymbol(resolveSymbol(type.aliasSymbol, checker));
  if (alias !== null) return alias;
  if ((type.flags & ts.TypeFlags.Union) !== 0) {
    for (const member of (type as ts.UnionType).types) {
      const declaration = enumDeclarationOfSymbol(resolveSymbol(member.getSymbol(), checker));
      if (declaration !== null) return declaration;
    }
  }
  return null;
}

function enumMembersOf(
  declaration: ts.EnumDeclaration,
  checker: ts.TypeChecker,
): readonly EnumMemberInfo[] | null {
  const members: EnumMemberInfo[] = [];
  for (const member of declaration.members) {
    if (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) return null;
    const value = checker.getConstantValue(member);
    if (value === undefined) return null;
    members.push({ name: member.name.text, value });
  }
  return members;
}

function enumInfoOf(
  type: ts.Type,
  checker: ts.TypeChecker,
): EnumInfo | null {
  const declaration = enumDeclarationOfType(type, checker);
  if (declaration === null) return null;
  const symbol = resolveSymbol(checker.getSymbolAtLocation(declaration.name), checker);
  if (symbol === undefined) return null;
  const members = enumMembersOf(declaration, checker);
  if (members === null) return null;
  const owner = declaration;
  const belongs = (member: ts.Type): boolean => {
    const memberSymbol = resolveSymbol(member.getSymbol(), checker);
    for (const declarationNode of memberSymbol?.declarations ?? []) {
      if (ts.isEnumMember(declarationNode) && declarationNode.parent === owner) return true;
      if (ts.isEnumDeclaration(declarationNode) && declarationNode === owner) return true;
    }
    return false;
  };
  if ((type.flags & ts.TypeFlags.Union) !== 0) {
    const union = type as ts.UnionType;
    if (!union.types.every((member) => belongs(member))) return null;
  } else if ((type.flags & (ts.TypeFlags.Enum | ts.TypeFlags.EnumLiteral)) === 0) {
    return null;
  }
  const typeSymbol = resolveSymbol(type.getSymbol(), checker);
  const wholeEnum = typeSymbol === symbol
    || (type.flags & ts.TypeFlags.Enum) !== 0;
  let selected: readonly EnumMemberInfo[];
  if (wholeEnum) {
    selected = members;
  } else {
    const values: (string | number)[] = [];
    const constituents = (type.flags & ts.TypeFlags.Union) !== 0
      ? (type as ts.UnionType).types
      : [type];
    for (const member of constituents) {
      const memberSymbol = resolveSymbol(member.getSymbol(), checker);
      for (const declarationNode of memberSymbol?.declarations ?? []) {
        if (!ts.isEnumMember(declarationNode) || declarationNode.parent !== owner) continue;
        const value = checker.getConstantValue(declarationNode);
        if (value !== undefined && !values.includes(value)) values.push(value);
      }
    }
    if (values.length === 0) return null;
    if (values.length === 1) {
      return {
        symbol,
        declaration,
        members: members.filter((entry) => entry.value === values[0]),
        values,
      };
    }
    selected = members.filter((entry) => values.includes(entry.value));
  }
  return {
    symbol,
    declaration,
    members: selected,
    values: selected.map((entry) => entry.value),
  };
}

function decoratorCallsOf(node: ts.Node, checker: ts.TypeChecker): readonly DecoratorCall[] {
  const decorators = ts.getDecorators(node as ts.HasDecorators) ?? [];
  const calls: DecoratorCall[] = [];
  for (const decorator of decorators) {
    let expression: ts.Expression = decorator.expression;
    let args: readonly ts.Expression[] = [];
    if (ts.isCallExpression(expression)) {
      args = expression.arguments;
      expression = expression.expression;
    }
    let name: string | null = null;
    if (ts.isIdentifier(expression)) {
      name = expression.text;
      if (!KNOWN_DECORATORS.has(name)) {
        const resolved = resolveSymbol(checker.getSymbolAtLocation(expression), checker);
        const resolvedName = resolved?.getName();
        if (resolvedName !== undefined && KNOWN_DECORATORS.has(resolvedName)) {
          name = resolvedName;
        }
      }
    } else if (ts.isPropertyAccessExpression(expression)) {
      name = expression.name.text;
    } else if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
      name = expression.argumentExpression.text;
    }
    if (name !== null) calls.push({ name, args });
  }
  return calls;
}

function elementAccessName(expression: ts.Expression): string | number | undefined {
  if (ts.isStringLiteral(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
  ) {
    return -Number(expression.operand.text);
  }
  return undefined;
}

function oneOfValueOf(
  call: DecoratorCall,
  checker: ts.TypeChecker,
): OneOfValue {
  const argument = call.args[0];
  if (argument === undefined) return { valid: false, value: undefined };
  const literal = elementAccessName(argument);
  if (literal !== undefined) {
    return { valid: true, value: literal };
  }
  let symbol: ts.Symbol | undefined;
  if (ts.isPropertyAccessExpression(argument)) {
    symbol = checker.getSymbolAtLocation(argument.name);
    if (symbol === undefined) symbol = checker.getSymbolAtLocation(argument);
  } else {
    symbol = checker.getSymbolAtLocation(argument);
  }
  const resolved = resolveSymbol(symbol, checker);
  for (const declaration of resolved?.declarations ?? []) {
    if (!ts.isEnumMember(declaration)) continue;
    const value = checker.getConstantValue(declaration);
    if (value !== undefined) return { valid: true, value };
  }
  return { valid: false, value: undefined };
}

function decoratorsOf(member: ts.Node, checker: ts.TypeChecker): FieldDecorators {
  let wire: ProtocolPrimitive | null = null;
  let wireName: string | null = null;
  let epochMillis = false;
  let int64OnNumber = false;
  let oneof: OneOfValue | null = null;
  const errors: string[] = [];
  for (const call of decoratorCallsOf(member, checker)) {
    const knownWire = WIRE_DECORATORS.get(call.name);
    if (knownWire !== undefined) {
      if (wireName !== null) {
        errors.push(`нельзя совмещать @${wireName} и @${call.name}`);
      }
      if (epochMillis) {
        errors.push(`нельзя совмещать @EpochMillis и @${call.name}`);
      }
      wire = knownWire;
      wireName = call.name;
      if (call.name === "Int64") int64OnNumber = true;
      continue;
    }
    if (call.name === "EpochMillis") {
      if (epochMillis) errors.push("декоратор @EpochMillis указан повторно");
      if (wireName !== null) {
        errors.push(`нельзя совмещать @${wireName} и @EpochMillis`);
      }
      epochMillis = true;
      continue;
    }
    if (call.name === "OneOf") {
      if (oneof !== null) {
        errors.push("декоратор @OneOf указан повторно");
      }
      oneof = oneOfValueOf(call, checker);
      if (!oneof.valid) errors.push("аргумент @OneOf не является членом enum");
    }
  }
  return { wire, epochMillis, int64OnNumber, oneof, errors };
}

function typeTextOf(state: SerializeState, type: ts.Type): string {
  return state.checker.typeToString(type);
}

function reportTypeUnsupported(
  state: SerializeState,
  type: ts.Type,
  reason?: string,
): null {
  const text = reason ?? `тип ${typeTextOf(state, type)} не поддерживается`;
  state.report(`${state.sourceFile.fileName}: ${state.path.join(".")}: ${text}`);
  return null;
}

function reportPath(state: SerializeState, reason: string): null {
  state.report(`${state.sourceFile.fileName}: ${state.path.join(".")}: ${reason}`);
  return null;
}

function serializeEnum(type: ts.Type, state: SerializeState): SchemaNode | null {
  const info = enumInfoOf(type, state.checker);
  if (info === null) return null;
  if (info.values.length === 1) {
    return { kind: "literal", value: info.values[0]! };
  }
  return { kind: "enum", values: info.values };
}

function serializeUnion(type: ts.UnionType, state: SerializeState): SerializeResult {
  let hasNullish = false;
  const candidates: ts.Type[] = [];
  let booleans = 0;
  let enumMembers = 0;
  let stringLiterals = 0;
  let numberLiterals = 0;
  for (const member of type.types) {
    if ((member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0) {
      hasNullish = true;
      continue;
    }
    if ((member.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      booleans += 1;
      candidates.push(member);
      continue;
    }
    if ((member.flags & ts.TypeFlags.EnumLiteral) !== 0) {
      enumMembers += 1;
      candidates.push(member);
      continue;
    }
    if ((member.flags & ts.TypeFlags.StringLiteral) !== 0) {
      stringLiterals += 1;
      candidates.push(member);
      continue;
    }
    if ((member.flags & ts.TypeFlags.NumberLiteral) !== 0) {
      numberLiterals += 1;
      candidates.push(member);
      continue;
    }
    candidates.push(member);
  }
  let base: SchemaNode | null = null;
  if (candidates.length === 0) {
    base = { kind: "literal", value: null };
    return { node: base, optional: hasNullish };
  }
  if (booleans === 2 && candidates.length === 2) {
    base = primitive("bool");
  } else if (enumMembers === candidates.length) {
    const declaration = enumDeclarationOfType(candidates[0]!, state.checker);
    if (declaration !== null) {
      const values: (string | number)[] = [];
      const ordered: (string | number)[] = [];
      const members = enumMembersOf(declaration, state.checker);
      if (members !== null) {
        for (const member of members) ordered.push(member.value);
      }
      for (const candidate of candidates) {
        const info = enumInfoOf(candidate, state.checker);
        if (info === null) return reportTypeUnsupported(state, type);
        for (const value of info.values) {
          if (!values.includes(value)) values.push(value);
        }
      }
      const sorted = [...ordered].filter((value) => values.includes(value));
      const finalValues = sorted.length === values.length ? sorted : values;
      if (finalValues.length === 1) {
        base = { kind: "literal", value: finalValues[0]! };
      } else {
        base = { kind: "enum", values: finalValues };
      }
    }
  } else if (stringLiterals === candidates.length || numberLiterals === candidates.length) {
    const finalValues = candidates.map((candidate) => {
      if ((candidate.flags & ts.TypeFlags.StringLiteral) !== 0) {
        return (candidate as ts.StringLiteralType).value;
      }
      return (candidate as ts.NumberLiteralType).value;
    });
    if (finalValues.length === 1) {
      base = { kind: "literal", value: finalValues[0]! };
    } else if (finalValues.length > 1) {
      base = { kind: "enum", values: finalValues };
    }
  } else if (candidates.length === 1) {
    const inner = serializeType(candidates[0]!, state);
    if (inner === null) return null;
    base = inner.node;
  }
  if (base === null) {
    return reportTypeUnsupported(
      state,
      type,
      `union ${typeTextOf(state, type)} не поддерживается: нужен enum-дискриминатор или один непустой тип`,
    );
  }
  if (hasNullish && base.kind !== "literal") {
    return { node: { kind: "optional", inner: base }, optional: true };
  }
  return { node: base, optional: hasNullish };
}

function isMapKey(node: SchemaNode): boolean {
  if (node.kind === "enum") {
    return node.values.every((value) => typeof value === "number");
  }
  if (node.kind !== "primitive") return false;
  return node.name === "string"
    || node.name === "bool"
    || node.name === "int32"
    || node.name === "uint32"
    || node.name === "int64"
    || node.name === "uint64"
    || node.name === "fixed32"
    || node.name === "fixed64";
}

function serializeTuple(type: ts.TypeReference, state: SerializeState): SchemaNode | null {
  const target = type.target as ts.TupleType;
  const args = state.checker.getTypeArguments(type);
  const flags = target.elementFlags;
  const elements: SchemaNode[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = flags[index];
    if (flag !== undefined && (flag & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)) !== 0) {
      return reportTypeUnsupported(state, type, "кортеж с rest-элементом не поддерживается");
    }
    const argument = args[index];
    if (argument === undefined) continue;
    const serialized = serializeType(argument, state);
    if (serialized === null) return null;
    const plain = stripOptional(serialized.node);
    let node = plain.node;
    if (flag !== undefined && (flag & ts.ElementFlags.Optional) !== 0 && node.kind !== "literal") {
      node = { kind: "optional", inner: node };
    }
    elements.push(node);
  }
  return { kind: "tuple", elements };
}

function serializeClass(type: ts.Type, state: SerializeState): SchemaNode | null {
  const info = classDeclarationOf(type, state.checker);
  if (info === null) return null;
  const runtime = state.runtimeRef(info.symbol);
  if (runtime.kind === "error") {
    return reportPath(state, runtime.reason);
  }
  if (!isSafeReference(runtime.reference)) {
    return reportPath(state, "класс недоступен в рантайме: ссылка не является корректным идентификатором");
  }
  return { kind: "class", reference: runtime.reference };
}

function serializeObject(type: ts.Type, state: SerializeState): SchemaNode | null {
  if (state.checker.isTupleType(type)) {
    return serializeTuple(type as ts.TypeReference, state);
  }
  const names = typeNamesOf(type, state.checker);
  const args = typeArgumentsOf(type, state.checker);
  for (const name of names) {
    if (BYTES_NAMES.has(name) && isBuiltinTypeName(type, name, state.checker)) {
      return primitive("bytes");
    }
  }
  if (names.some((name) => name === "Date" && isBuiltinTypeName(type, name, state.checker))) {
    return primitive("date");
  }
  const arrayName = names.find(
    (name) => (name === "Array" || name === "ReadonlyArray")
      && isBuiltinTypeName(type, name, state.checker),
  );
  if (arrayName !== undefined || state.checker.isArrayType(type)) {
    const element = args[0] ?? state.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    if (element === undefined) {
      return reportTypeUnsupported(state, type, "массив без типа элемента не поддерживается");
    }
    const serialized = serializeType(element, state);
    if (serialized === null) return null;
    return { kind: "array", element: serialized.node };
  }
  if (
    names.some(
      (name) => (name === "Map" || name === "ReadonlyMap")
        && isBuiltinTypeName(type, name, state.checker),
    )
  ) {
    const key = args[0];
    const value = args[1];
    if (key === undefined || value === undefined) {
      return reportTypeUnsupported(state, type, "Map без параметров типа не поддерживается");
    }
    const keyNode = serializeType(key, state);
    if (keyNode === null) return null;
    if (keyNode.optional) {
      return reportTypeUnsupported(state, key, "optional-ключи Map не поддерживаются");
    }
    const plainKey = stripOptional(keyNode.node).node;
    let normalizedKey = plainKey;
    if (plainKey.kind === "literal" && typeof plainKey.value === "string") {
      normalizedKey = primitive("string");
    } else if (plainKey.kind === "literal" && typeof plainKey.value === "number") {
      normalizedKey = primitive("int32");
    } else if (plainKey.kind === "enum" && plainKey.values.every((value) => typeof value === "string")) {
      normalizedKey = primitive("string");
    }
    if (!isMapKey(normalizedKey)) {
      return reportTypeUnsupported(
        state,
        key,
        `тип ключа ${typeTextOf(state, key)} не поддерживается в Map`,
      );
    }
    const valueNode = serializeType(value, state);
    if (valueNode === null) return null;
    return { kind: "map", key: normalizedKey, value: valueNode.node };
  }
  if (
    names.some(
      (name) => (name === "Set" || name === "ReadonlySet")
        && isBuiltinTypeName(type, name, state.checker),
    )
  ) {
    const element = args[0];
    if (element === undefined) {
      return reportTypeUnsupported(state, type, "Set без параметра типа не поддерживается");
    }
    const serialized = serializeType(element, state);
    if (serialized === null) return null;
    const plainElement = stripOptional(serialized.node);
    if (plainElement.optional) {
      return reportTypeUnsupported(state, element, "optional-элементы Set не поддерживаются");
    }
    return { kind: "set", element: plainElement.node };
  }
  if (names.some((name) => name === "Record" && isBuiltinTypeName(type, name, state.checker))) {
    const value = args[1];
    if (value === undefined) {
      return reportTypeUnsupported(state, type, "Record без параметра значения не поддерживается");
    }
    const serialized = serializeType(value, state);
    if (serialized === null) return null;
    return { kind: "map", key: primitive("string"), value: serialized.node };
  }
  for (const name of names) {
    if (UNSUPPORTED_NAMES.has(name) && isBuiltinTypeName(type, name, state.checker)) {
      return reportTypeUnsupported(state, type);
    }
  }
  const classInfo = classDeclarationOf(type, state.checker);
  if (classInfo !== null) {
    return serializeClass(type, state);
  }
  if (type.getCallSignatures().length > 0) {
    return reportTypeUnsupported(state, type);
  }
  const properties = state.checker.getPropertiesOfType(type);
  const stringIndex = state.checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (properties.length === 0 && stringIndex !== undefined) {
    const serialized = serializeType(stringIndex, state);
    if (serialized === null) return null;
    return { kind: "map", key: primitive("string"), value: serialized.node };
  }
  return reportTypeUnsupported(
    state,
    type,
    `объектный тип ${typeTextOf(state, type)} не поддерживается: используйте класс`,
  );
}

function serializeTypeUncached(type: ts.Type, state: SerializeState): SerializeResult {
  const flags = type.flags;
  if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0) {
    return reportTypeUnsupported(state, type);
  }
  if ((flags & (ts.TypeFlags.Never | ts.TypeFlags.Void)) !== 0) {
    return reportTypeUnsupported(state, type);
  }
  if ((flags & ts.TypeFlags.Boolean) !== 0) return { node: primitive("bool"), optional: false };
  if ((flags & ts.TypeFlags.String) !== 0) return { node: primitive("string"), optional: false };
  if ((flags & ts.TypeFlags.Number) !== 0) return { node: primitive("float64"), optional: false };
  if ((flags & ts.TypeFlags.BigInt) !== 0) return { node: primitive("bigint"), optional: false };
  if ((flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) !== 0) {
    return reportTypeUnsupported(state, type);
  }
  if ((flags & ts.TypeFlags.Union) !== 0) {
    return serializeUnion(type as ts.UnionType, state);
  }
  if ((flags & ts.TypeFlags.Intersection) !== 0) {
    return reportTypeUnsupported(state, type);
  }
  if ((flags & (ts.TypeFlags.Enum | ts.TypeFlags.EnumLiteral)) !== 0) {
    const enumNode = serializeEnum(type, state);
    if (enumNode === null) return reportTypeUnsupported(state, type);
    return { node: enumNode, optional: false };
  }
  if ((flags & ts.TypeFlags.StringLiteral) !== 0) {
    return { node: { kind: "literal", value: (type as ts.StringLiteralType).value }, optional: false };
  }
  if ((flags & ts.TypeFlags.NumberLiteral) !== 0) {
    return { node: { kind: "literal", value: (type as ts.NumberLiteralType).value }, optional: false };
  }
  if ((flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    const value = (type as ts.Type & { intrinsicName?: string }).intrinsicName === "true";
    return { node: { kind: "literal", value }, optional: false };
  }
  if ((flags & ts.TypeFlags.BigIntLiteral) !== 0) {
    return { node: primitive("bigint"), optional: false };
  }
  if ((flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0) {
    return { node: { kind: "literal", value: null }, optional: true };
  }
  if ((flags & ts.TypeFlags.Object) !== 0) {
    const object = serializeObject(type, state);
    if (object === null) return null;
    return { node: object, optional: false };
  }
  return reportTypeUnsupported(state, type);
}

function serializeType(type: ts.Type, state: SerializeState): SerializeResult {
  if (state.active.has(type)) {
    return reportPath(state, "рекурсивный тип не поддерживается");
  }
  if (state.active.size >= MAX_DEPTH) {
    return reportPath(state, "превышена глубина вложенности типа");
  }
  state.active.add(type);
  try {
    return serializeTypeUncached(type, state);
  } finally {
    state.active.delete(type);
  }
}

function stripOptional(node: SchemaNode): { readonly node: SchemaNode; readonly optional: boolean } {
  let current = node;
  let optional = false;
  while (current.kind === "optional") {
    optional = true;
    current = current.inner;
  }
  return { node: current, optional };
}

function applyDecorators(
  node: SchemaNode,
  decorators: FieldDecorators,
  state: SerializeState,
): SchemaNode | null {
  for (const error of decorators.errors) {
    return reportPath(state, error);
  }
  const base = node.kind === "primitive" ? node : null;
  if (decorators.wire !== null) {
    const wire = decorators.wire;
    if (base === null) {
      return reportPath(state, `декоратор @${wire} применим только к number или bigint`);
    }
    if (base.name === "float64") {
      if (decorators.int64OnNumber && wire === "int64") {
        return reportPath(
          state,
          "@Int64 на number не поддерживается: 64-битные целые в TS представляются bigint",
        );
      }
      return primitive(wire);
    }
    if (base.name === "bigint") {
      if (wire === "int64") return primitive("bigint");
      if (wire === "uint64" || wire === "fixed64") return primitive(wire);
      return reportPath(state, `декоратор @${wire} недопустим для bigint`);
    }
    return reportPath(state, `декоратор @${wire} недопустим для ${base.name}`);
  }
  if (decorators.epochMillis) {
    if (base === null) return reportPath(state, "декоратор @EpochMillis применим только к number или Date");
    if (base.name === "float64" || base.name === "date") return primitive("date");
    return reportPath(state, `декоратор @EpochMillis недопустим для ${base.name}`);
  }
  return node;
}

function fieldTypeOf(
  member: ts.PropertyDeclaration | ts.AutoAccessorPropertyDeclaration,
  state: SerializeState,
): ts.Type | null {
  if (member.type !== undefined) {
    return state.checker.getTypeFromTypeNode(member.type);
  }
  const symbol = state.checker.getSymbolAtLocation(member.name);
  if (symbol === undefined) return null;
  return state.checker.getTypeOfSymbolAtLocation(symbol, member);
}

function propertyNameOf(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
}

function isAmbientDeclaration(declaration: ts.Declaration): boolean {
  if (declaration.getSourceFile().isDeclarationFile) return true;
  let node: ts.Node | undefined = declaration;
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (hasModifier(node, ts.SyntaxKind.DeclareKeyword)) return true;
    if (ts.isModuleDeclaration(node)) {
      if ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0) return true;
    }
    node = node.parent;
  }
  return false;
}

function collectOwnFields(declaration: ClassLikeDeclaration): readonly RawField[] {
  const fields: RawField[] = [];
  for (const member of declaration.members) {
    if (!ts.isPropertyDeclaration(member) && !ts.isAutoAccessorPropertyDeclaration(member)) {
      continue;
    }
    if (hasModifier(member, ts.SyntaxKind.StaticKeyword)) continue;
    if (
      hasModifier(member, ts.SyntaxKind.PrivateKeyword)
      || hasModifier(member, ts.SyntaxKind.ProtectedKeyword)
    ) {
      continue;
    }
    if (ts.isPrivateIdentifier(member.name)) continue;
    const name = propertyNameOf(member.name);
    if (name === null) continue;
    fields.push({ name, member });
  }
  return fields;
}

function baseClassOf(
  declaration: ClassLikeDeclaration,
  checker: ts.TypeChecker,
): ClassLikeDeclaration | null {
  const clause = declaration.heritageClauses?.find(
    (entry) => entry.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const expression = clause?.types[0]?.expression;
  if (expression === undefined) return null;
  const symbol = resolveSymbol(checker.getSymbolAtLocation(expression), checker);
  if (symbol === undefined) return null;
  for (const candidate of symbol.declarations ?? []) {
    if (isClassLikeDeclaration(candidate)) return candidate;
  }
  const value = symbol.valueDeclaration;
  if (value !== undefined && isClassLikeDeclaration(value)) return value;
  return null;
}

function collectFields(
  declaration: ClassLikeDeclaration,
  checker: ts.TypeChecker,
): readonly RawField[] {
  const chain: ClassLikeDeclaration[] = [];
  const seen = new Set<ClassLikeDeclaration>();
  let current: ClassLikeDeclaration | null = declaration;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    chain.unshift(current);
    current = baseClassOf(current, checker);
  }
  const merged = new Map<string, RawField>();
  for (const owner of chain) {
    for (const field of collectOwnFields(owner)) {
      merged.set(field.name, field);
    }
  }
  return [...merged.values()];
}

function lowerCamel(name: string): string {
  if (name.length === 0) return name;
  return `${name[0]!.toLowerCase()}${name.slice(1)}`;
}

function variantOrder(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return utf8Compare(String(left), String(right));
}

function renderNode(node: SchemaNode): string {
  switch (node.kind) {
    case "primitive":
      return JSON.stringify(node.name);
    case "literal":
      return `["literal",${JSON.stringify(node.value)}]`;
    case "enum":
      return `["enum",[${node.values.map((value) => JSON.stringify(value)).join(",")}]]`;
    case "class":
      return `["class",()=>${node.reference}]`;
    case "array":
      return `["array",${renderNode(node.element)}]`;
    case "tuple":
      return `["tuple",[${node.elements.map(renderNode).join(",")}]]`;
    case "map":
      return `["map",${renderNode(node.key)},${renderNode(node.value)}]`;
    case "set":
      return `["set",${renderNode(node.element)}]`;
    case "optional":
      return `["optional",${renderNode(node.inner)}]`;
  }
}

function renderField(field: ProtocolFieldSchema): string {
  return `{ kind: "field", name: ${JSON.stringify(field.name)}, type: ${renderNode(field.type)}, optional: ${field.optional} }`;
}

function renderVariant(variant: ProtocolVariantSchema): string {
  return `{ value: ${JSON.stringify(variant.value)}, field: ${JSON.stringify(variant.field)}, type: ${renderNode(variant.type)} }`;
}

function renderOneof(oneof: ProtocolOneofSchema): string {
  return `{ kind: "oneof", name: ${JSON.stringify(oneof.name)}, enum: () => ${oneof.enumReference}, variants: [${oneof.variants.map(renderVariant).join(", ")}] }`;
}

function closingPosition(
  sourceFile: ts.SourceFile,
  declaration: ClassLikeDeclaration,
): number {
  const end = declaration.getEnd();
  const position = end - 1;
  if (sourceFile.text[position] === "}") return position;
  const fallback = sourceFile.text.lastIndexOf("}", end);
  return fallback >= 0 ? fallback : position;
}

function blockIndentation(
  sourceFile: ts.SourceFile,
  position: number,
  declaration: ClassLikeDeclaration,
): { readonly closing: string; readonly lead: string } {
  const lineStart = sourceFile.text.lastIndexOf("\n", position - 1) + 1;
  const prefix = sourceFile.text.slice(lineStart, position);
  if (lineStart > 0 && /^[ \t]*$/.test(prefix)) {
    return { closing: prefix, lead: "" };
  }
  const declarationStart = declaration.getStart(sourceFile);
  const declarationLineStart = sourceFile.text.lastIndexOf("\n", declarationStart - 1) + 1;
  const declarationPrefix = sourceFile.text.slice(declarationLineStart, declarationStart);
  const closing = /^[ \t]*$/.test(declarationPrefix) ? declarationPrefix : "";
  return { closing, lead: `${sourceFile.text.includes("\r\n") ? "\r\n" : "\n"}${closing}` };
}

interface SchemaEntryRender {
  readonly name: string;
  readonly render: () => string;
}

function buildBlock(
  sourceFile: ts.SourceFile,
  declaration: ClassLikeDeclaration,
  entries: readonly SchemaEntryRender[],
  oneofs: readonly ProtocolOneofSchema[],
): { readonly position: number; readonly code: string } {
  const position = closingPosition(sourceFile, declaration);
  const indentation = blockIndentation(sourceFile, position, declaration);
  const newline = sourceFile.text.includes("\r\n") ? "\r\n" : "\n";
  const inner = `${indentation.closing}${INDENT_UNIT}${INDENT_UNIT}`;
  const deep = `${inner}${INDENT_UNIT}`;
  const body: string[] = [];
  body.push(`${inner}version: 1,`);
  body.push(`${inner}fields: [`);
  for (const entry of entries) body.push(`${deep}${entry.render()},`);
  body.push(`${inner}],`);
  body.push(`${inner}oneofs: [`);
  for (const oneof of oneofs) body.push(`${deep}${renderOneof(oneof)},`);
  body.push(`${inner}],`);
  const code = [
    `${indentation.lead}${INDENT_UNIT}static {`,
    `${inner}this[Symbol.for(${JSON.stringify(SCHEMA_KEY)})] = {`,
    ...body,
    `${inner}};`,
    `${indentation.closing}${INDENT_UNIT}}`,
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

interface OneofResult {
  readonly oneofs: readonly ProtocolOneofSchema[];
  readonly variantFields: ReadonlySet<string>;
  readonly valid: boolean;
}

function buildOneofs(
  prepared: readonly PreparedField[],
  className: string,
  state: SerializeState,
): OneofResult {
  const candidates = prepared.filter(
    (field) => field.enumInfo !== null && !field.optional,
  );
  const explicit = prepared.filter((field) => field.oneof !== null);
  const groups = new Map<string, { candidate: PreparedField; variants: Map<string, ProtocolVariantSchema> }>();
  const variantOwner = new Map<string, string>();
  let valid = true;
  const fail = (path: string, reason: string): void => {
    valid = false;
    state.report(`${state.sourceFile.fileName}: ${path}: ${reason}`);
  };

  const addVariant = (
    candidate: PreparedField,
    field: PreparedField,
    value: string | number,
  ): void => {
    const owner = variantOwner.get(field.name);
    if (owner !== undefined && owner !== candidate.name) {
      fail(
        `${className}.${field.name}`,
        `поле-вариант относится к нескольким дискриминаторам (${owner}, ${candidate.name})`,
      );
      return;
    }
    let group = groups.get(candidate.name);
    if (group === undefined) {
      group = { candidate, variants: new Map<string, ProtocolVariantSchema>() };
      groups.set(candidate.name, group);
    }
    const key = String(value);
    const existing = group.variants.get(key);
    if (existing !== undefined) {
      fail(
        `${className}.${candidate.name}`,
        `значение oneof ${key} встречается у полей ${existing.field} и ${field.name}`,
      );
      return;
    }
    variantOwner.set(field.name, candidate.name);
    group.variants.set(key, { value, field: field.name, type: field.node });
  };

  for (const field of explicit) {
    const spec = field.oneof;
    if (spec === null) continue;
    if (!spec.valid || spec.value === undefined) {
      fail(`${className}.${field.name}`, "аргумент @OneOf не является членом enum");
      continue;
    }
    const matches = candidates.filter(
      (candidate) => candidate.enumInfo?.values.includes(spec.value as string | number) ?? false,
    );
    if (matches.length === 0) {
      fail(
        `${className}.${field.name}`,
        `значение @OneOf(${String(spec.value)}) не найдено ни в одном enum-дискриминаторе`,
      );
      continue;
    }
    if (matches.length > 1) {
      fail(
        `${className}.${field.name}`,
        `значение @OneOf(${String(spec.value)}) встречается в нескольких enum-дискриминаторах`,
      );
      continue;
    }
    const candidate = matches[0]!;
    if (!field.optional) {
      fail(
        `${className}.${field.name}`,
        "вариант oneof должен быть optional-полем",
      );
      continue;
    }
    addVariant(candidate, field, spec.value);
  }

  for (const candidate of candidates) {
    const info = candidate.enumInfo;
    if (info === null) continue;
    for (const member of info.members) {
      const fieldName = lowerCamel(member.name);
      const named = prepared.find((entry) => entry.name === fieldName);
      if (named === undefined) continue;
      if (variantOwner.has(named.name)) continue;
      if (named.oneof !== null) continue;
      if (!named.optional) {
        fail(`${className}.${fieldName}`, "вариант oneof должен быть optional-полем");
        continue;
      }
      addVariant(candidate, named, member.value);
    }
  }

  const oneofs: ProtocolOneofSchema[] = [];
  const variantFields = new Set<string>();
  for (const [name, group] of groups) {
    const info = group.candidate.enumInfo;
    if (info === null) continue;
    if (info.members.some((member) => typeof member.value !== "number")) {
      fail(`${className}.${name}`, "oneof требует числовые значения enum-дискриминатора");
      continue;
    }
    state.path.length = 0;
    state.path.push(className, name);
    const runtime = state.runtimeRef(info.symbol);
    if (runtime.kind === "error") {
      fail(`${className}.${name}`, runtime.reason);
      continue;
    }
    if (!isSafeReference(runtime.reference)) {
      fail(
        `${className}.${name}`,
        "enum-дискриминатор недоступен в рантайме: ссылка не является корректным идентификатором",
      );
      continue;
    }
    const variants = [...group.variants.values()].sort((left, right) =>
      variantOrder(left.value, right.value),
    );
    for (const variant of variants) variantFields.add(variant.field);
    oneofs.push({ name, enumReference: runtime.reference, variants });
  }
  if (!valid) return { oneofs: [], variantFields: new Set<string>(), valid: false };
  return { oneofs, variantFields, valid: true };
}

export function generateProtocolBlocks(
  options: ProtocolCodegenOptions,
): readonly ProtocolBlock[] {
  const { sourceFile, checker, runtimeRef } = options;
  const reported = new Set<string>();
  const strict = options.strict === true;
  const report = (message: string): void => {
    if (reported.has(message)) return;
    reported.add(message);
    options.diagnostics?.(message);
    if (strict) throw new Error(message);
  };
  const classes: ClassLikeDeclaration[] = [];
  collectClasses(sourceFile, classes);
  const blocks: ProtocolBlock[] = [];

  for (const declaration of classes) {
    if (declaration.getSourceFile() !== sourceFile) continue;
    if (isAmbientDeclaration(declaration)) continue;
    if (options.shouldGenerate !== undefined && !options.shouldGenerate(declaration)) continue;
    const className = classLikeName(declaration);
    const declarationText = sourceFile.text.slice(
      declaration.getStart(sourceFile),
      declaration.getEnd(),
    );
    if (declarationText.includes(SCHEMA_KEY)) continue;
    const raw = collectFields(declaration, checker);
    if (raw.length === 0) continue;
    const state: SerializeState = {
      checker,
      runtimeRef,
      sourceFile,
      report,
      active: new Set<ts.Type>(),
      path: [className],
    };
    const prepared: PreparedField[] = [];
    for (const field of raw) {
      state.path.length = 0;
      state.path.push(className, field.name);
      const decorators = decoratorsOf(field.member, checker);
      const type = fieldTypeOf(field.member, state);
      if (type === null) {
        report(`${sourceFile.fileName}: ${className}.${field.name}: не удалось определить тип поля`);
        continue;
      }
      const serialized = serializeType(type, state);
      if (serialized === null) continue;
      const stripped = stripOptional(serialized.node);
      const optional = stripped.optional
        || serialized.optional
        || field.member.questionToken !== undefined;
      const withDecorators = applyDecorators(stripped.node, decorators, state);
      if (withDecorators === null) continue;
      const enumInfo = field.member.questionToken === undefined && !optional
        ? enumInfoOf(type, checker)
        : null;
      prepared.push({
        name: field.name,
        type,
        node: withDecorators,
        optional,
        enumInfo,
        oneof: decorators.oneof,
      });
    }
    if (prepared.length === 0) continue;
    state.path.length = 0;
    const oneofResult = buildOneofs(prepared, className, state);
    if (!oneofResult.valid) continue;
    const oneofNames = new Set(oneofResult.oneofs.map((oneof) => oneof.name));
    const fieldSchemas: ProtocolFieldSchema[] = prepared
      .filter((field) => !oneofResult.variantFields.has(field.name))
      .filter((field) => !oneofNames.has(field.name))
      .map((field) => ({ name: field.name, type: field.node, optional: field.optional }));
    const entries: { readonly name: string; readonly field: ProtocolFieldSchema | null; readonly oneof: ProtocolOneofSchema | null }[] = [];
    for (const field of fieldSchemas) {
      entries.push({ name: field.name, field, oneof: null });
    }
    for (const oneof of oneofResult.oneofs) {
      entries.push({ name: oneof.name, field: null, oneof });
    }
    entries.sort((left, right) => utf8Compare(left.name, right.name));
    const orderedFields: ProtocolFieldSchema[] = [];
    const orderedOneofs: ProtocolOneofSchema[] = [];
    const renders: SchemaEntryRender[] = [];
    for (const entry of entries) {
      if (entry.field !== null) {
        orderedFields.push(entry.field);
        const field = entry.field;
        renders.push({ name: entry.name, render: () => renderField(field) });
      } else if (entry.oneof !== null) {
        orderedOneofs.push(entry.oneof);
        const oneof = entry.oneof;
        renders.push({ name: entry.name, render: () => renderOneof(oneof) });
      }
    }
    if (orderedFields.length === 0 && orderedOneofs.length === 0) continue;
    const block = buildBlock(sourceFile, declaration, renders, orderedOneofs);
    blocks.push({
      ...block,
      className,
      fields: orderedFields,
      oneofs: orderedOneofs,
    });
  }
  return blocks;
}
