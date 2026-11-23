import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { protocol } from "../src/vite.js";

interface CodecResult {
  readonly hex: string;
  readonly decoded: string;
}

interface VectorResult {
  readonly hex: string;
  readonly decoded: Record<string, unknown>;
}

interface IntegrationBundle {
  readonly sampleStatic: () => CodecResult;
  readonly samplePlain: () => CodecResult;
  readonly staticToPlain: () => string;
  readonly plainToStatic: () => string;
  readonly vectorStatic: () => VectorResult;
  readonly vectorPlain: () => string;
  readonly vectorToStatic: (hex: string) => Record<string, unknown>;
}

const projects: string[] = [];
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const runtime = path.join(repoRoot, "packages/protocol/src/index.ts");
const vector = JSON.parse(
  readFileSync(path.join(repoRoot, "protocol/vectors/user.json"), "utf8"),
) as { readonly hex: string; readonly fields: Record<string, unknown> };

afterEach(() => {
  for (const directory of projects.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const MODEL = [
  "function Int32(): any { return () => {}; }",
  "function OneOf(value: unknown): any { return () => {}; }",
  "",
  "export enum Kind { Created = 1, Updated = 2, Deleted = 3 }",
  "",
  "export class Address {",
  "  public x: number = 0;",
  "  public y: number = 0;",
  "}",
  "",
  "export class Payload {",
  '  public text: string = "";',
  "}",
  "",
  "export class Sample {",
  "  public active: boolean = false;",
  "  @Int32() public age: number = 0;",
  "  public buffer: ArrayBuffer = new ArrayBuffer(0);",
  "  public bytes: Uint8Array = new Uint8Array();",
  "  public createdAt: Date = new Date(0);",
  "  public id: bigint = 0n;",
  "  public list: string[] = [];",
  "  public map: Map<string, number> = new Map();",
  "  public maybe: string | null = null;",
  "  public maybeList: Array<string | null> = [];",
  "  public meta: Record<string, number> = {};",
  '  public name: string = "";',
  "  public point: Address = new Address();",
  "  public pointMap: Map<string, Address> = new Map();",
  "  public roles: Set<string> = new Set();",
  "  public score: number = 0;",
  '  public tuple: [string, number, boolean] = ["", 0, false];',
  "  public view: Uint16Array = new Uint16Array();",
  "  public kind: Kind = Kind.Created;",
  "  @OneOf(Kind.Created) public created?: Payload;",
  "  @OneOf(Kind.Updated) public updated?: string;",
  "  @OneOf(Kind.Deleted) public deleted?: null;",
  "}",
  "",
  "export class VectorAddress {",
  '  public city: string = "";',
  "  @Int32() public zip: number = 0;",
  "}",
  "",
  "export class VectorUser {",
  "  public active: boolean = false;",
  "  public address: VectorAddress = new VectorAddress();",
  "  @Int32() public age: number = 0;",
  "  public createdAt: Date = new Date(0);",
  "  public email?: string;",
  "  public id: bigint = 0n;",
  '  public name: string = "";',
  "  public roles: Set<string> = new Set();",
  "  public score: number = 0;",
  "  public tags: string[] = [];",
  "}",
  "",
].join("\n");

const PLAIN = [
  "export class PlainAddress {",
  "  constructor() { this.x = 0; this.y = 0; }",
  "}",
  "",
  "export class PlainPayload {",
  '  constructor() { this.text = ""; }',
  "}",
  "",
  "export class PlainSample {",
  "  constructor() {",
  "    this.active = false;",
  "    this.age = 0;",
  "    this.buffer = new ArrayBuffer(0);",
  "    this.bytes = new Uint8Array();",
  "    this.createdAt = new Date(0);",
  "    this.id = 0n;",
  "    this.list = [];",
  "    this.map = new Map();",
  "    this.maybe = null;",
  "    this.maybeList = [];",
  "    this.meta = {};",
  '    this.name = "";',
  "    this.point = new PlainAddress();",
  "    this.pointMap = new Map();",
  "    this.roles = new Set();",
  "    this.score = 0;",
  '    this.tuple = ["", 0, false];',
  "    this.view = new Uint16Array();",
  "    this.kind = 1;",
  "    this.created = undefined;",
  "    this.updated = undefined;",
  "    this.deleted = undefined;",
  "  }",
  "}",
  "",
].join("\n");

const MAIN = [
  'import { decode, defineProtocol, encode } from "@ivlev-dev/silent-protocol";',
  'import { Address, Kind, Payload, Sample, VectorAddress, VectorUser } from "./model";',
  'import { PlainAddress, PlainPayload, PlainSample } from "./plain.mjs";',
  "",
  "function definePlainSchemas() {",
  "  defineProtocol(PlainAddress, {",
  '    fields: [{ name: "x", type: "float64" }, { name: "y", type: "float64" }],',
  "  });",
  "  defineProtocol(PlainPayload, { fields: [{ name: \"text\", type: \"string\" }] });",
  "  defineProtocol(PlainSample, {",
  "    fields: [",
  '      { name: "active", type: "bool" },',
  '      { name: "age", type: "int32" },',
  '      { name: "buffer", type: "bytes" },',
  '      { name: "bytes", type: "bytes" },',
  '      { name: "createdAt", type: "date" },',
  '      { name: "id", type: "bigint" },',
  '      { name: "list", type: ["array", "string"] },',
  '      { name: "map", type: ["map", "string", "float64"] },',
  '      { name: "maybe", type: "string", optional: true },',
  '      { name: "maybeList", type: ["array", ["optional", "string"]] },',
  '      { name: "meta", type: ["map", "string", "float64"] },',
  '      { name: "name", type: "string" },',
  '      { name: "point", type: ["class", () => PlainAddress] },',
  '      { name: "pointMap", type: ["map", "string", ["class", () => PlainAddress]] },',
  '      { name: "roles", type: ["set", "string"] },',
  '      { name: "score", type: "float64" },',
  '      { name: "tuple", type: ["tuple", ["string", "float64", "bool"]] },',
  '      { name: "view", type: "bytes" },',
  "    ],",
  "    oneofs: [",
  "      {",
  '        name: "kind",',
  "        enum: () => Kind,",
  "        variants: [",
  '          { value: 1, field: "created", type: ["class", () => PlainPayload] },',
  '          { value: 2, field: "updated", type: "string" },',
  '          { value: 3, field: "deleted", type: null },',
  "        ],",
  "      },",
  "    ],",
  "  });",
  "}",
  "",
  "function defineVectorSchemas() {",
  "  defineProtocol(VectorAddress, {",
  '    fields: [{ name: "city", type: "string" }, { name: "zip", type: "int32" }],',
  "  });",
  "  defineProtocol(VectorUser, {",
  "    fields: [",
  '      { name: "active", type: "bool" },',
  '      { name: "address", type: ["class", () => VectorAddress] },',
  '      { name: "age", type: "int32" },',
  '      { name: "createdAt", type: "date" },',
  '      { name: "email", type: "string", optional: true },',
  '      { name: "id", type: "bigint" },',
  '      { name: "name", type: "string" },',
  '      { name: "roles", type: ["set", "string"] },',
  '      { name: "score", type: "float64" },',
  '      { name: "tags", type: ["array", "string"] },',
  "    ],",
  "  });",
  "}",
  "",
  "function makeSample(Ctor, AddressCtor, PayloadCtor, kind) {",
  "  const sample = new Ctor();",
  "  sample.active = true;",
  "  sample.age = 30;",
  "  sample.buffer = new Uint8Array([4, 5]).buffer;",
  "  sample.bytes = new Uint8Array([1, 2, 3]);",
  "  sample.createdAt = new Date(1700000000123);",
  "  sample.id = 9007199254740993n;",
  '  sample.list = ["b", "а"];',
  '  sample.map = new Map([["b", 2], ["a", 1]]);',
  '  sample.maybe = null;',
  '  sample.maybeList = ["x", null, "z"];',
  "  sample.meta = { b: 2, a: 1 };",
  '  sample.name = "Иван";',
  "  sample.point = Object.assign(new AddressCtor(), { x: 1.5, y: -2 });",
  '  sample.pointMap = new Map([["k", Object.assign(new AddressCtor(), { x: 3, y: 4 })]]);',
  '  sample.roles = new Set(["user", "admin"]);',
  "  sample.score = 12.5;",
  '  sample.tuple = ["t", 1.5, true];',
  "  sample.view = new Uint16Array([258, 515]);",
  "  sample.kind = kind;",
  "  if (kind === 1) sample.created = Object.assign(new PayloadCtor(), { text: \"p\" });",
  "  if (kind === 2) sample.updated = \"u\";",
  "  if (kind === 3) sample.deleted = null;",
  "  return sample;",
  "}",
  "",
  "function makeVectorUser() {",
  "  const user = new VectorUser();",
  "  user.active = true;",
  '  user.address.city = "Москва";',
  "  user.address.zip = 101000;",
  "  user.age = 30;",
  "  user.createdAt = new Date(1700000000000);",
  '  user.email = "user@example.com";',
  "  user.id = 1234567890123n;",
  '  user.name = "Ivan";',
  '  user.roles = new Set(["admin", "user"]);',
  "  user.score = 12.5;",
  '  user.tags = ["a", "b"];',
  "  return user;",
  "}",
  "",
  "function toHex(bytes) {",
  "  return [...bytes].map((byte) => byte.toString(16).padStart(2, \"0\")).join(\"\");",
  "}",
  "",
  "function fromHex(hex) {",
  "  return new Uint8Array(hex.match(/../g).map((part) => parseInt(part, 16)));",
  "}",
  "",
  "function snapshot(value) {",
  "  return JSON.stringify(value, (key, item) => {",
  "    if (item instanceof Map) return { map: [...item.entries()] };",
  "    if (item instanceof Set) return { set: [...item] };",
  "    if (item instanceof Uint8Array) return { bytes: [...item] };",
  "    if (item instanceof Date) return { date: item.getTime() };",
  "    if (typeof item === \"bigint\") return { bigint: item.toString() };",
  "    return item;",
  "  });",
  "}",
  "",
  "export function sampleStatic() {",
  "  const sample = makeSample(Sample, Address, Payload, 1);",
  "  const bytes = encode(sample);",
  "  return { hex: toHex(bytes), decoded: snapshot(decode(Sample, bytes)) };",
  "}",
  "",
  "export function samplePlain() {",
  "  definePlainSchemas();",
  "  const sample = makeSample(PlainSample, PlainAddress, PlainPayload, 1);",
  "  const bytes = encode(sample);",
  "  return { hex: toHex(bytes), decoded: snapshot(decode(PlainSample, bytes)) };",
  "}",
  "",
  "export function staticToPlain() {",
  "  definePlainSchemas();",
  "  const bytes = encode(makeSample(Sample, Address, Payload, 2));",
  "  return snapshot(decode(PlainSample, bytes));",
  "}",
  "",
  "export function plainToStatic() {",
  "  definePlainSchemas();",
  "  const bytes = encode(makeSample(PlainSample, PlainAddress, PlainPayload, 3));",
  "  return snapshot(decode(Sample, bytes));",
  "}",
  "",
  "export function vectorStatic() {",
  "  const user = makeVectorUser();",
  "  const bytes = encode(user);",
  "  return {",
  "    hex: toHex(bytes),",
  "    decoded: JSON.parse(snapshot(decode(VectorUser, bytes))),",
  "  };",
  "}",
  "",
  "export function vectorPlain() {",
  "  defineVectorSchemas();",
  "  return toHex(encode(makeVectorUser()));",
  "}",
  "",
  "export function vectorToStatic(hex) {",
  "  defineVectorSchemas();",
  "  return JSON.parse(snapshot(decode(VectorUser, fromHex(hex))));",
  "}",
  "",
].join("\n");

async function buildProject(directory: string): Promise<IntegrationBundle> {
  writeFileSync(
    path.join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        experimentalDecorators: true,
        useDefineForClassFields: true,
        noEmit: true,
      },
      include: ["*.ts"],
    }),
  );
  writeFileSync(path.join(directory, "model.ts"), MODEL);
  writeFileSync(path.join(directory, "plain.mjs"), PLAIN);
  writeFileSync(path.join(directory, "main.ts"), MAIN);
  await build({
    root: directory,
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: {
        "@ivlev-dev/silent-protocol": runtime,
      },
    },
    plugins: [protocol()],
    build: {
      write: true,
      minify: false,
      target: "esnext",
      outDir: path.join(directory, "dist"),
      emptyOutDir: true,
      lib: {
        entry: path.join(directory, "main.ts"),
        formats: ["es"],
        fileName: "main",
      },
    },
  });
  return await import(
    `${pathToFileURL(path.join(directory, "dist", "main.mjs")).href}?v=${Date.now()}`
  ) as IntegrationBundle;
}

describe("protocol() + static codecs", () => {
  it("совпадает с generic-кодеком и с cross-vector user.json", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "silent-protocol-codec-"));
    projects.push(directory);
    const bundle = await buildProject(directory);
    const staticResult = bundle.sampleStatic();
    const plainResult = bundle.samplePlain();
    expect(staticResult.hex).toBe(plainResult.hex);
    expect(staticResult.decoded).toBe(plainResult.decoded);
    expect(JSON.parse(staticResult.decoded)).toMatchObject({
      active: true,
      age: 30,
      name: "Иван",
      kind: 1,
    });
    const fromStatic = JSON.parse(bundle.staticToPlain()) as Record<string, unknown>;
    expect(fromStatic).toMatchObject({ kind: 2, updated: "u" });
    expect(fromStatic).not.toHaveProperty("created");
    const fromPlain = JSON.parse(await Promise.resolve(bundle.plainToStatic())) as Record<string, unknown>;
    expect(fromPlain).toMatchObject({ kind: 3, deleted: null });
    expect(fromPlain).not.toHaveProperty("updated");
    const vectorResult = bundle.vectorStatic();
    expect(vectorResult.hex).toBe(vector.hex);
    expect(vectorResult.hex).toBe(bundle.vectorPlain());
    expect(bundle.vectorToStatic(vector.hex)).toMatchObject({
      active: vector.fields["active"],
      address: vector.fields["address"],
      age: vector.fields["age"],
      createdAt: new Date(Number(vector.fields["createdAt"])).toISOString(),
      email: vector.fields["email"],
      id: { bigint: vector.fields["id"] },
      name: vector.fields["name"],
      roles: { set: vector.fields["roles"] },
      score: vector.fields["score"],
      tags: vector.fields["tags"],
    });
  });
});
