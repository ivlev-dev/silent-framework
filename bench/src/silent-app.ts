import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderToString } from "@ivlev-dev/silent-server";
import { compileSilent } from "./silent-compile";

interface SilentModule {
  readonly ROWS: number;
  readonly App: (props: { readonly title: string }) => Node;
}

const TITLE = "Title";
const benchRoot = join(import.meta.dirname, "..");
const cacheDirectory = join(benchRoot, "node_modules", ".silent-bench");
const outputPath = join(cacheDirectory, "silent-app.mjs");

mkdirSync(cacheDirectory, { recursive: true });
writeFileSync(
  outputPath,
  compileSilent(join(benchRoot, "fixtures", "silent-app.tsx")),
);

const silentModule = (await import(
  pathToFileURL(outputPath).href
)) as SilentModule;

export const ROWS: number = silentModule.ROWS;

export function silentApp(): Node {
  return silentModule.App({ title: TITLE });
}

export const silentHtml: string = (await renderToString(silentApp, {})).html;
