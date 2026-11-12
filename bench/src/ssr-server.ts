import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import type { JSX } from "solid-js";
import { renderToString as solidRender } from "solid-js/web";
import { Bench } from "tinybench";
import { renderToString as silentRender } from "@ivlev-dev/silent-server";
import { ROWS, silentSsrApp } from "./silent-app";
import { compileSolid } from "./solid-compile";
import { resolveBenchJsonPath, round2, writeBenchJson } from "./cli";

interface SolidModule {
  readonly App: (props: { readonly title: string }) => JSX.Element;
}

interface HtmlSize {
  readonly bytes: number;
  readonly gzip: number;
}

const TIME = 500;
const WARMUP = 100;
const TITLE = "Title";
const benchRoot = join(import.meta.dirname, "..");
const cacheDirectory = join(benchRoot, "node_modules", ".silent-bench");
const solidPath = join(cacheDirectory, "solid-ssr.mjs");

mkdirSync(cacheDirectory, { recursive: true });
writeFileSync(
  solidPath,
  compileSolid(join(benchRoot, "fixtures", "solid-app.tsx"), "ssr"),
);

const solidModule = (await import(pathToFileURL(solidPath).href)) as SolidModule;
const solidApp = (): JSX.Element => solidModule.App({ title: TITLE });

function measureHtml(html: string): HtmlSize {
  const content = Buffer.from(html);
  return { bytes: content.length, gzip: gzipSync(content).length };
}

function formatBytes(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toLocaleString("ru-RU");
}

function formatKb(value: number | undefined): string {
  return value === undefined ? "n/a" : (value / 1024).toFixed(1);
}

function readOps(ops: ReadonlyMap<string, number>, name: string): number {
  const value = ops.get(name);
  if (value === undefined) {
    throw new Error(`Нет результата для ${name}`);
  }
  return value;
}

function readSize(
  sizes: ReadonlyMap<string, HtmlSize>,
  name: string,
): HtmlSize {
  const value = sizes.get(name);
  if (value === undefined) {
    throw new Error(`Нет размера HTML для ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const silentHtml = (await silentRender(silentSsrApp, {})).html;
  const solidHtml = await solidRender(solidApp);
  const sizes = new Map<string, HtmlSize>([
    ["silent renderToString", measureHtml(silentHtml)],
    ["solid renderToString", measureHtml(solidHtml)],
  ]);

  const bench = new Bench({ time: TIME, warmupTime: WARMUP, throws: true });
  bench.add("silent renderToString", async () => {
    const result = await silentRender(silentSsrApp, {});
    if (!result.html.includes("<li>")) {
      throw new Error("silent: пустой результат");
    }
  });
  bench.add("solid renderToString", async () => {
    const html = await solidRender(solidApp);
    if (!html.includes("<li")) {
      throw new Error("solid: пустой результат");
    }
  });
  await bench.run();

  const ops = new Map<string, number>();
  for (const task of bench.tasks) {
    if (task.result.state === "completed") {
      ops.set(task.name, task.result.throughput.mean);
    }
  }

  const silentSize = readSize(sizes, "silent renderToString");
  const solidSize = readSize(sizes, "solid renderToString");

  writeBenchJson(resolveBenchJsonPath(), {
    app: "ssr",
    silent: {
      ops: round2(readOps(ops, "silent renderToString")),
      htmlBytes: silentSize.bytes,
      htmlGzipBytes: silentSize.gzip,
    },
    solid: {
      ops: round2(readOps(ops, "solid renderToString")),
      htmlBytes: solidSize.bytes,
      htmlGzipBytes: solidSize.gzip,
    },
  });

  const rows = bench.tasks.map((task) => {
    const size = sizes.get(task.name);
    return {
      scenario: task.name,
      "ops/s":
        task.result.state === "completed"
          ? Math.round(task.result.throughput.mean).toLocaleString("ru-RU")
          : "n/a",
      "html, B": formatBytes(size?.bytes),
      "html, KB": formatKb(size?.bytes),
      "html gzip, B": formatBytes(size?.gzip),
      "html gzip, KB": formatKb(size?.gzip),
    };
  });
  console.log(`SSR: ${ROWS} элементов, лучший результат tinybench`);
  console.log(
    `Node.js ${process.version}, CPU: ${cpus()[0]?.model ?? "unknown"}`,
  );
  console.table(rows);
}

await main();
