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
const clientPath = join(cacheDirectory, "silent-app.mjs");
const ssrPath = join(cacheDirectory, "silent-app-ssr.mjs");
const fixture = join(benchRoot, "fixtures", "silent-app.tsx");

mkdirSync(cacheDirectory, { recursive: true });
writeFileSync(clientPath, compileSilent(fixture, false));
writeFileSync(ssrPath, compileSilent(fixture, true));

const clientModule = (await import(pathToFileURL(clientPath).href)) as SilentModule;
const ssrModule = (await import(pathToFileURL(ssrPath).href)) as SilentModule;

export const ROWS: number = clientModule.ROWS;

export function silentApp(): Node {
  return clientModule.App({ title: TITLE });
}

export function silentSsrApp(): Node {
  return ssrModule.App({ title: TITLE });
}

export const silentHtml: string = (await renderToString(silentSsrApp, {})).html;
