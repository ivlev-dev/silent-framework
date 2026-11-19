// @vitest-environment jsdom
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { hydrate, type AnyComponent } from "@ivlev-dev/silent-core";
import { transform } from "../../swc/index.js";
import { renderToString } from "../src/render.js";

const testsDirectory = join(process.cwd(), "tests");
const temporaryDirectories: string[] = [];
const handles: { dispose(): void }[] = [];
const hosts: HTMLElement[] = [];

interface TransformOutput {
  readonly code: string;
}

interface CompiledModule {
  readonly View: AnyComponent;
}

function compile(source: string, options: Record<string, unknown>): string {
  const output = JSON.parse(
    transform(source, "/proj/src/view.tsx", JSON.stringify(options), "{}"),
  ) as TransformOutput;
  return output.code;
}

async function load(code: string): Promise<CompiledModule> {
  const directory = mkdtempSync(join(testsDirectory, ".tmp-compiled-roundtrip-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "view.mjs");
  writeFileSync(file, code, "utf8");
  return (await import(pathToFileURL(file).href)) as CompiledModule;
}

function host(html: string): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.appendChild(element);
  hosts.push(element);
  return element;
}

const SOURCE = `import { For } from "@ivlev-dev/silent-core";
export function View(props: { items: string[]; active: boolean }) {
  return (
    <div class={props.active ? "on" : "off"}>
      <ul>
        <For each={props.items} fallback={<b>none</b>}>
          {(item) => <li>{item}</li>}
        </For>
      </ul>
    </div>
  );
}`;

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.dispose();
  }
  for (const element of hosts.splice(0)) {
    element.remove();
  }
  document.body.replaceChildren();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("roundtrip скомпилированного компонента SSR → hydrate", () => {
  it("гидратирует динамический атрибут, For и fallback", async () => {
    const server = await load(compile(SOURCE, { ssr: true }));
    const client = await load(compile(SOURCE, { hydrate: true }));

    const filled = await renderToString(server.View, {
      props: { items: ["a", "b"], active: true },
    });
    const filledHost = host(filled.html);
    const serverItems = Array.from(filledHost.querySelectorAll("li"));
    const filledMismatches: string[] = [];
    const filledHandle = await hydrate(filledHost, client.View, {
      props: { items: ["a", "b"], active: true },
      onMismatch: (error) => filledMismatches.push(error.message),
    });
    handles.push(filledHandle);

    expect(filledMismatches).toEqual([]);
    expect(filledHost.firstElementChild?.getAttribute("class")).toBe("on");
    expect(Array.from(filledHost.querySelectorAll("li")).map((node) => node.textContent)).toEqual([
      "a",
      "b",
    ]);
    expect(Array.from(filledHost.querySelectorAll("li"))).toEqual(serverItems);
    expect(filledHost.querySelector("b")).toBeNull();

    const empty = await renderToString(server.View, {
      props: { items: [], active: false },
    });
    const emptyHost = host(empty.html);
    const serverFallback = emptyHost.querySelector("b");
    const emptyMismatches: string[] = [];
    const emptyHandle = await hydrate(emptyHost, client.View, {
      props: { items: [], active: false },
      onMismatch: (error) => emptyMismatches.push(error.message),
    });
    handles.push(emptyHandle);

    expect(emptyMismatches).toEqual([]);
    expect(emptyHost.firstElementChild?.getAttribute("class")).toBe("off");
    expect(emptyHost.querySelector("b")).toBe(serverFallback);
    expect(emptyHost.textContent).toBe("none");
  });
});
