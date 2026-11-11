import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const benchRoot = join(import.meta.dirname, "..");
const cacheRoot = join(benchRoot, "node_modules", ".silent-bench", "browser");

const APP = process.argv[2] ?? "silent";
const appRoot = join(benchRoot, "browser", APP);
const clientDir = join(cacheRoot, APP, "client");
const ssrFile = join(cacheRoot, APP, "ssr", "entry-server.js");

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

function findChrome(): string {
  const base = join(homedir(), ".cache", "ms-playwright");
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith("chromium-")) continue;
    for (const candidate of [
      join(base, entry, "chrome-linux64", "chrome"),
      join(base, entry, "chrome-linux", "chrome"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Chromium не найден");
}

async function ssrHtml(): Promise<string> {
  const module = (await import(`${pathToFileURL(ssrFile).href}?v=${String(Date.now())}`)) as {
    render(): Promise<{ html: string }> | { html: string };
  };
  const result = await module.render();
  return result.html;
}

async function serve(root: string): Promise<{ url: string; close(): Promise<void> }> {
  const base = resolve(root);
  const prefix = `${base}${sep}`;
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    const file = resolve(base, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!file.startsWith(prefix) || !existsSync(file) || !statSync(file).isFile()) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("content-type", TYPES.get(extname(file)) ?? "application/octet-stream");
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("нет порта");
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

interface ProfileNode {
  readonly id: number;
  readonly hitCount?: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
  };
}

const html = await ssrHtml();
const server = await serve(clientDir);
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.addInitScript("globalThis.__name = globalThis.__name || ((value) => value);");

try {
  await page.goto(server.url, { waitUntil: "load" });
  await page.waitForFunction(() => (window as unknown as { __hydrateBench?: unknown }).__hydrateBench !== undefined);

  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Profiler.start");

  await page.evaluate(async (markup: string) => {
    const api = (window as unknown as {
      __hydrateBench?: { hydrate(container: Element): Promise<() => void> };
    }).__hydrateBench;
    if (api === undefined) throw new Error("нет api");
    const containers: HTMLElement[] = [];
    for (let index = 0; index < 200; index += 1) {
      const container = document.createElement("div");
      container.innerHTML = markup;
      document.body.appendChild(container);
      containers.push(container);
    }
    for (const container of containers) {
      const dispose = await api.hydrate(container);
      dispose();
      container.remove();
    }
  }, html);

  const { profile } = (await session.send("Profiler.stop")) as unknown as {
    profile: { nodes: ProfileNode[]; samples: number[] };
  };

  const byId = new Map<number, ProfileNode>();
  for (const node of profile.nodes) byId.set(node.id, node);
  const self = new Map<string, number>();
  for (const sample of profile.samples) {
    const node = byId.get(sample);
    if (node === undefined) continue;
    const frame = node.callFrame;
    const key = `${frame.functionName || "(anon)"} @ ${frame.url
      .replace(/^.*\/silent-framework\//, "")
      .replace(/^http:\/\/127\.0\.0\.1:\d+\//, "")}:${String(frame.lineNumber + 1)}`;
    self.set(key, (self.get(key) ?? 0) + 1);
  }
  const total = profile.samples.length;
  const rows = [...self.entries()].sort((left, right) => right[1] - left[1]).slice(0, 30);
  console.log(`${APP}: ${String(total)} сэмплов`);
  for (const [key, value] of rows) {
    console.log(`${((value / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
  }
} finally {
  await browser.close();
  await server.close();
}
