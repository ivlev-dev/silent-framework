import "./env";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { PerformanceObserver } from "node:perf_hooks";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Bench } from "tinybench";
import {
  hydrate as silentHydrate,
  type MountHandle,
} from "@ivlev-dev/silent-core";
import type { JSX } from "solid-js";
import { hydrate as solidHydrate } from "solid-js/web";
import { documentRef } from "./env";
import { ROWS, silentApp, silentHtml } from "./silent-app";
import { compileSolid } from "./solid-compile";
import { resolveBenchJsonPath, round2, writeBenchJson } from "./cli";

interface SolidModule {
  readonly App: (props: { readonly title: string }) => JSX.Element;
}

interface SolidHydrationState {
  events: unknown[];
  completed: WeakSet<Node>;
  r: Record<string, unknown>;
  fe: () => void;
  done?: boolean;
}

interface MemorySample {
  readonly beforeKb: number;
  readonly afterKb: number;
  readonly perHydrationKb: number;
  readonly gc: number | null;
}

const TIME = 500;
const WARMUP = 100;
const MEMORY_ITERATIONS = 500;
const benchRoot = join(import.meta.dirname, "..");
const cacheDirectory = join(benchRoot, "node_modules", ".silent-bench");
const domPath = join(cacheDirectory, "solid-dom.mjs");

const hydrationState: SolidHydrationState = {
  events: [],
  completed: new WeakSet<Node>(),
  r: {},
  fe: () => undefined,
};

Object.defineProperty(globalThis, "_$HY", {
  value: hydrationState,
  configurable: true,
  writable: true,
});

function resetSolidHydration(): void {
  hydrationState.events = [];
  hydrationState.completed = new WeakSet<Node>();
  hydrationState.r = {};
  hydrationState.done = false;
}

mkdirSync(cacheDirectory, { recursive: true });
writeFileSync(
  domPath,
  compileSolid(join(benchRoot, "fixtures", "solid-app.tsx"), "dom"),
);

const solidModule = (await import(pathToFileURL(domPath).href)) as SolidModule;
const solidApp = (): JSX.Element => solidModule.App({ title: "Title" });

const solidHtml = execFileSync("pnpm", ["exec", "tsx", "solid-ssr-html.ts"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
});

function canonicalMarkup(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sdata-hk="[^"]*"/g, "")
    .replace(/\sdata-silent-[a-z0-9-]+="[^"]*"/g, "");
}

if (!silentHtml.includes("<li>")) {
  throw new Error("silent: пустой SSR-результат");
}
if (!solidHtml.includes("<li")) {
  throw new Error("solid: пустой SSR-результат");
}
if (!solidHtml.includes("data-hk")) {
  throw new Error("solid: в SSR-разметке нет data-hk");
}
assert.equal(
  canonicalMarkup(silentHtml),
  canonicalMarkup(solidHtml),
  "видимая разметка silent и solid различается",
);

function format(value: number | undefined): string {
  return value === undefined
    ? "n/a"
    : Math.round(value).toLocaleString("ru-RU");
}

function formatKb(value: number): string {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function readOps(value: number | undefined, name: string): number {
  if (value === undefined) {
    throw new Error(`Нет результата для ${name}`);
  }
  return value;
}

function createGcCounter(): { readonly stop: () => number | null } {
  if (!PerformanceObserver.supportedEntryTypes.includes("gc")) {
    return { stop: () => null };
  }
  let count = 0;
  const observer = new PerformanceObserver((list) => {
    count += list.getEntries().length;
  });
  observer.observe({ entryTypes: ["gc"] });
  return {
    stop: () => {
      count += observer.takeRecords().length;
      observer.disconnect();
      return count;
    },
  };
}

async function measureMemory(
  run: () => Promise<void> | void,
): Promise<MemorySample> {
  await run();
  const counter = createGcCounter();
  const before = process.memoryUsage().heapUsed;
  for (let index = 0; index < MEMORY_ITERATIONS; index += 1) {
    await run();
  }
  const after = process.memoryUsage().heapUsed;
  const gc = counter.stop();
  return {
    beforeKb: before / 1024,
    afterKb: after / 1024,
    perHydrationKb: (after - before) / 1024 / MEMORY_ITERATIONS,
    gc,
  };
}

async function hydrateSilent(): Promise<void> {
  const target = documentRef.createElement("div");
  target.innerHTML = silentHtml;
  documentRef.body.appendChild(target);
  const handle: MountHandle = await silentHydrate(target, silentApp, {
    onMismatch: () => undefined,
  });
  handle.dispose();
  target.remove();
}

function hydrateSolid(): void {
  const target = documentRef.createElement("div");
  target.innerHTML = solidHtml;
  documentRef.body.appendChild(target);
  const dispose = solidHydrate(solidApp, target);
  dispose();
  target.remove();
}

async function main(): Promise<void> {
  const bench = new Bench({ time: TIME, warmupTime: WARMUP, throws: true });

  bench.add("silent hydrate", hydrateSilent);

  bench.add("solid hydrate", hydrateSolid, {
    beforeEach: resetSolidHydration,
  });

  await bench.run();

  const results = new Map<string, number>();
  for (const task of bench.tasks) {
    if (task.result.state === "completed") {
      results.set(task.name, task.result.throughput.mean);
    }
  }

  const silentOps = results.get("silent hydrate");
  const solidOps = results.get("solid hydrate");
  const ratioValue =
    silentOps === undefined || solidOps === undefined || solidOps === 0
      ? 0
      : silentOps / solidOps;
  const ratio =
    silentOps === undefined || solidOps === undefined || solidOps === 0
      ? "n/a"
      : `${ratioValue.toFixed(2)}x`;

  const silentMemory = await measureMemory(hydrateSilent);
  const solidMemory = await measureMemory(() => {
    resetSolidHydration();
    hydrateSolid();
  });

  const rows = [
    {
      scenario: "silent hydrate",
      "ops/s": format(silentOps),
      "к solid": ratio,
      "heap, KB/гидр.": formatKb(silentMemory.perHydrationKb),
      GC: silentMemory.gc === null ? "n/a" : String(silentMemory.gc),
    },
    {
      scenario: "solid hydrate",
      "ops/s": format(solidOps),
      "к solid": "1.00x",
      "heap, KB/гидр.": formatKb(solidMemory.perHydrationKb),
      GC: solidMemory.gc === null ? "n/a" : String(solidMemory.gc),
    },
  ];

  writeBenchJson(resolveBenchJsonPath(), {
    app: "hydrate",
    silent: {
      ops: round2(readOps(silentOps, "silent hydrate")),
      heapKbPerHydration: round2(silentMemory.perHydrationKb),
    },
    solid: {
      ops: round2(readOps(solidOps, "solid hydrate")),
      heapKbPerHydration: round2(solidMemory.perHydrationKb),
    },
    ratio: round2(ratioValue),
  });

  console.log(
    `Гидрация: ${ROWS} элементов, tinybench ${TIME} мс + ${WARMUP} мс warmup`,
  );
  console.log(
    `Node.js ${process.version}, CPU: ${cpus()[0]?.model ?? "unknown"}`,
  );
  console.log(
    `Память: ${MEMORY_ITERATIONS} гидраций, heapUsed silent ${Math.round(silentMemory.beforeKb)} → ${Math.round(silentMemory.afterKb)} KB, solid ${Math.round(solidMemory.beforeKb)} → ${Math.round(solidMemory.afterKb)} KB`,
  );
  console.table(rows);
  console.log("Больше — лучше; silent/solid > 1 — silent быстрее.");
}

await main();
