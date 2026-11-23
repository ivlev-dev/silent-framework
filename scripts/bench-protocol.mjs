import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { protocol } from "../packages/protocol-vite/dist/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const BENCH_DIR = path.join(ROOT, "packages/protocol-vite/.tmp-bench-protocol");
const SRC_DIR = path.join(BENCH_DIR, "src");

const MODEL = `export class Address {
  public city: string = "";
  public zip: number = 0;
}

export class User {
  public id: bigint = 0n;
  public name: string = "";
  public email: string | undefined = undefined;
  public age: number = 0;
  public active: boolean = false;
  public address: Address = new Address();
  public tags: string[] = [];
  public score: number = 0;
}
`;

const MAIN = `import { encode, decode } from "@ivlev-dev/silent-protocol";
import { Address, User } from "./model";

export function sample(): User {
  const user = new User();
  user.id = 1234567890123n;
  user.name = "Ivan";
  user.email = "user@example.com";
  user.age = 30;
  user.active = true;
  user.address.city = "Москва";
  user.address.zip = 101000;
  user.tags = ["a", "b"];
  user.score = 12.5;
  return user;
}

export function clearCodecs(): Map<Function, unknown> {
  const saved = new Map<Function, unknown>();
  for (const ctor of [User, Address]) {
    const symbol = Symbol.for("silent.protocol.codec");
    saved.set(ctor, ctor[symbol]);
    delete ctor[symbol];
  }
  return saved;
}

export function restoreCodecs(saved: Map<Function, unknown>): void {
  const symbol = Symbol.for("silent.protocol.codec");
  for (const [ctor, codec] of saved) ctor[symbol] = codec;
}

export { Address, User, encode, decode };
`;

function stats(label, fn, iterations, rounds) {
  for (let index = 0; index < 20000; index += 1) fn();
  const samples = [];
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) fn();
    samples.push((iterations / (performance.now() - start)) * 1000);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const best = samples[samples.length - 1];
  return { label, median, best, lower: samples[0] };
}

function format(value) {
  return Math.round(value).toLocaleString("ru-RU");
}

function netAllocation(label, fn, iterations) {
  if (typeof globalThis.gc !== "function") return null;
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  for (let index = 0; index < iterations; index += 1) fn();
  const after = process.memoryUsage().heapUsed;
  return Math.max(after - before, 0) / iterations;
}

async function prepare() {
  await rm(BENCH_DIR, { recursive: true, force: true });
  await mkdir(SRC_DIR, { recursive: true });
  await writeFile(path.join(SRC_DIR, "model.ts"), MODEL);
  await writeFile(path.join(SRC_DIR, "main.ts"), MAIN);
  await build({
    root: BENCH_DIR,
    configFile: false,
    logLevel: "silent",
    plugins: [protocol()],
    build: {
      write: true,
      minify: false,
      emptyOutDir: true,
      outDir: "dist",
      lib: { entry: path.join(SRC_DIR, "main.ts"), formats: ["es"], fileName: "main" },
    },
  });
  return import(pathToFileURL(path.join(BENCH_DIR, "dist/main.js")).href);
}

const { sample, encode, decode, User, Address, clearCodecs, restoreCodecs } = await prepare();

const value = sample();
const bytes = encode(value);
const json = JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

const saved = clearCodecs();
const genericBytes = encode(value);
const genericEncode = stats("generic encode", () => encode(value), 100000, 5);
const genericDecode = stats("generic decode", () => decode(User, bytes), 200000, 5);
restoreCodecs(saved);

const sameBytes = Buffer.from(bytes).equals(Buffer.from(genericBytes));
const staticDecoded = decode(User, bytes);

const encodeIterations = 200000;
const decodeIterations = 400000;
const jsonIterations = 400000;

const results = [
  stats("static encode", () => encode(value), encodeIterations, 7),
  genericEncode,
  stats("static decode", () => decode(User, bytes), decodeIterations, 7),
  genericDecode,
  stats("JSON stringify", () => JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)), jsonIterations, 7),
  stats("JSON parse", () => JSON.parse(json), jsonIterations, 7),
];

const bytesPerOp = {
  "static encode": bytes.length,
  "generic encode": bytes.length,
  "static decode": bytes.length,
  "generic decode": bytes.length,
  "JSON stringify": json.length,
  "JSON parse": json.length,
};

console.log(`модель User: ${bytes.length} B binary, ${json.length} B JSON`);
console.log(`байты static === generic: ${sameBytes}`);
console.log(`roundtrip id: ${staticDecoded.id === value.id}, tags: ${staticDecoded.tags.join(",")}`);
console.log("");
console.log("операция            ops/s      MB/s     ns/op");
for (const result of results) {
  const mb = (result.median * bytesPerOp[result.label]) / (1024 * 1024);
  console.log(
    `${result.label.padEnd(20)}${format(result.median).padStart(8)}${mb.toFixed(1).padStart(9)}${(1e9 / result.median).toFixed(0).padStart(8)}`,
  );
}

console.log("");
const allocationLabels = ["static encode", "static decode", "JSON stringify"];
const allocations = [
  netAllocation("static encode", () => encode(value), 5000),
  netAllocation("static decode", () => decode(User, bytes), 5000),
  netAllocation("JSON stringify", () => JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)), 5000),
];
if (allocations[0] === null) {
  console.log("heap: запустите с node --expose-gc для замера аллокаций");
} else {
  console.log("net alloc, B/op:");
  for (let index = 0; index < allocations.length; index += 1) {
    console.log(`${allocationLabels[index].padEnd(20)}${allocations[index].toFixed(0).padStart(8)}`);
  }
}

if (!sameBytes || staticDecoded.id !== value.id || staticDecoded.tags.join(",") !== "a,b") {
  process.exitCode = 1;
}
