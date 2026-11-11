import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { JSX } from "solid-js";
import { renderToString } from "solid-js/web";
import { compileSolid } from "./solid-compile";

interface SolidModule {
  readonly App: (props: { readonly title: string }) => JSX.Element;
}

const benchRoot = join(import.meta.dirname, "..");
const cacheDirectory = join(benchRoot, "node_modules", ".silent-bench");
const outputPath = join(cacheDirectory, "solid-ssr.mjs");

mkdirSync(cacheDirectory, { recursive: true });
writeFileSync(
  outputPath,
  compileSolid(join(benchRoot, "fixtures", "solid-app.tsx"), "ssr"),
);

const module = (await import(pathToFileURL(outputPath).href)) as SolidModule;
const html = renderToString(() => module.App({ title: "Title" }));
process.stdout.write(html);
