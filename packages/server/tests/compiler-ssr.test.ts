import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { transform } from "../../swc/index.js";
import { renderToString } from "../src/render.js";

const testsDirectory = fileURLToPath(new URL(".", import.meta.url));
const temporaryDirectories: string[] = [];

interface TransformOutput {
  readonly code: string;
}

interface CompiledModule {
  readonly View: Parameters<typeof renderToString>[0];
}

function compile(source: string, options: Record<string, unknown>): string {
  const output = JSON.parse(
    transform(source, "/proj/src/view.tsx", JSON.stringify(options), "{}"),
  ) as TransformOutput;
  return output.code;
}

async function load(code: string): Promise<CompiledModule> {
  const directory = mkdtempSync(join(testsDirectory, ".tmp-compiler-ssr-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "view.mjs");
  writeFileSync(file, code, "utf8");
  return (await import(pathToFileURL(file).href)) as CompiledModule;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SSR-код компилятора", () => {
  it("рендерит For и Index внутри шаблона с динамическим атрибутом", async () => {
    const code = compile(
      `import { For, Index } from "@ivlev-dev/silent-core";
export function View(props: { items: string[]; title: string; active: boolean }) {
  return (
    <div class={props.active ? "on" : "off"} title={props.title}>
      <p>{props.title}</p>
      <ul>
        <For each={props.items}>{(item) => <li>{item}</li>}</For>
      </ul>
      <ol>
        <Index each={props.items}>{(item) => <li>{item()}</li>}</Index>
      </ol>
    </div>
  );
}`,
      { ssr: true },
    );
    const { View } = await load(code);
    const { html } = await renderToString(View, {
      props: { items: ["one", "two"], title: "T", active: true },
    });

    expect(html).toContain('class="on"');
    expect(html).toContain('title="T"');
    expect(html).toContain("<p>T");
    expect(html.match(/<li>one/g)?.length).toBe(2);
    expect(html.match(/<li>two/g)?.length).toBe(2);
    expect(html).not.toContain("<ul><!--silent-hole-");
    expect(html).not.toContain("<ol><!--silent-hole-");
  });

  it("не теряет For при серверном fallback из-за metadata", async () => {
    const code = compile(
      `import { For } from "@ivlev-dev/silent-core";
export function View(props: { items: string[] }) {
  return (
    <div>
      <title>Список</title>
      <ul>
        <For each={props.items}>{(item) => <li>{item}</li>}</For>
      </ul>
    </div>
  );
}`,
      { ssr: true },
    );
    const { View } = await load(code);
    const { html } = await renderToString(View, {
      props: { items: ["alpha", "beta"] },
    });

    expect(html).toContain("<li>alpha");
    expect(html).toContain("<li>beta");
    expect(html).not.toContain("<ul><!--silent-hole-");
  });
});
