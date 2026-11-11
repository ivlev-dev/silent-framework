import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";

export type SolidGenerate = "dom" | "ssr";

export function compileSolid(filename: string, generate: SolidGenerate): string {
  const source = readFileSync(filename, "utf8");
  const result = transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [
      ["babel-preset-solid", { generate, hydratable: true }],
      ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
    ],
  });

  if (result?.code === undefined || result.code === null) {
    throw new Error("Babel не скомпилировал " + filename);
  }

  return result.code;
}
