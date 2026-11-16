// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "@ivlev-dev/silent-server";
import { templateHoles } from "../src/dom";
import { hydrateIslands } from "../src/hydrate";

function island(label: string) {
  return function Island(): Node {
    return templateHoles(`<section class="island">${label}</section>`)().node;
  };
}

describe("hydrateIslands", () => {
  it("гидратирует независимые SSR-острова, оставляя статическую оболочку", async () => {
    const first = await renderToString(island("first"));
    const second = await renderToString(island("second"));
    const shell = document.createElement("main");
    shell.innerHTML = `<h1>static</h1><div id="first">${first.html}</div><p>static</p><div id="second">${second.html}</div>`;
    document.body.appendChild(shell);

    const handles = await hydrateIslands([
      { target: shell.querySelector("#first")!, app: island("first") },
      { target: shell.querySelector("#second")!, app: island("second") },
    ]);

    expect(shell.querySelector("#first .island")?.textContent).toBe("first");
    expect(shell.querySelector("#second .island")?.textContent).toBe("second");
    expect(shell.querySelector("h1")?.textContent).toBe("static");
    expect(shell.querySelector("p")?.textContent).toBe("static");

    for (const handle of handles) {
      handle.dispose();
    }
    expect(shell.querySelector("#first")?.textContent).toBe("");
    expect(shell.querySelector("#second")?.textContent).toBe("");
  });
});
