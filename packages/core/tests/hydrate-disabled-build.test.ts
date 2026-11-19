// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

describe("гидрация в сборке с hydrate: false", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("бросает понятную ошибку вместо мёртвого хэндла", async () => {
    vi.resetModules();
    vi.stubGlobal("__SILENT_HYDRATE__", false);
    const { hydrate } = await import("../src/hydrate.js");

    const target = document.createElement("div");
    target.innerHTML = "<p>server</p>";
    document.body.appendChild(target);

    const App = (): Node => document.createElement("p");

    await expect(hydrate(target, App as never)).rejects.toThrow(
      "hydrate:false — гидрация недоступна",
    );
    expect(target.innerHTML).toBe("<p>server</p>");
  });
});
