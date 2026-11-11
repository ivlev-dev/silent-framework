import "./env";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
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
import { ROWS, silentApp } from "./ssr-app";
import { compileSolid } from "./solid-compile";

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

const TIME = 500;
const WARMUP = 100;
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

const silentHtml = execFileSync("pnpm", ["exec", "tsx", "ssr-html.ts"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
});

const solidHtml = execFileSync("pnpm", ["exec", "tsx", "solid-ssr-html.ts"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
});

if (!silentHtml.includes("<li>")) {
  throw new Error("silent: пустой SSR-результат");
}
if (!solidHtml.includes("<li")) {
  throw new Error("solid: пустой SSR-результат");
}
if (!solidHtml.includes("data-hk")) {
  throw new Error("solid: в SSR-разметке нет data-hk");
}

function format(value: number | undefined): string {
  return value === undefined
    ? "n/a"
    : Math.round(value).toLocaleString("ru-RU");
}

async function main(): Promise<void> {
  const bench = new Bench({ time: TIME, warmupTime: WARMUP, throws: true });

  bench.add("silent hydrate", async () => {
    const target = documentRef.createElement("div");
    target.innerHTML = silentHtml;
    documentRef.body.appendChild(target);
    const handle: MountHandle = await silentHydrate(target, silentApp as never, {
      onMismatch: () => undefined,
    });
    handle.dispose();
    target.remove();
  });

  bench.add(
    "solid hydrate",
    () => {
      const target = documentRef.createElement("div");
      target.innerHTML = solidHtml;
      documentRef.body.appendChild(target);
      const dispose = solidHydrate(solidApp, target);
      dispose();
      target.remove();
    },
    { beforeEach: resetSolidHydration },
  );

  await bench.run();

  const results = new Map<string, number>();
  for (const task of bench.tasks) {
    if (task.result.state === "completed") {
      results.set(task.name, task.result.throughput.mean);
    }
  }

  const silentOps = results.get("silent hydrate");
  const solidOps = results.get("solid hydrate");
  const ratio =
    silentOps === undefined || solidOps === undefined || solidOps === 0
      ? "n/a"
      : `${(silentOps / solidOps).toFixed(2)}x`;

  const rows = [
    {
      scenario: "silent hydrate",
      "ops/s": format(silentOps),
      "к solid": ratio,
    },
    {
      scenario: "solid hydrate",
      "ops/s": format(solidOps),
      "к solid": "1.00x",
    },
  ];

  console.log(
    `Гидрация: ${ROWS} элементов, tinybench ${TIME} мс + ${WARMUP} мс warmup`,
  );
  console.log(
    `Node.js ${process.version}, CPU: ${cpus()[0]?.model ?? "unknown"}`,
  );
  console.table(rows);
  console.log("Больше — лучше; silent/solid > 1 — silent быстрее.");
}

await main();
