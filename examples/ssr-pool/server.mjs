import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRenderPool } from "@ivlev-dev/silent-server/pool";
import { createServer as createViteServer } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 5176);
const production = process.env.NODE_ENV === "production";
const concurrency = Number(process.env.WEB_CONCURRENCY ?? 2);

const contentTypes = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".woff2", "font/woff2"],
]);

const vite = production
  ? null
  : await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: "custom",
    });

const pool = production
  ? createRenderPool(
      new URL("./dist/server/entry-server.js", import.meta.url),
      {
        workers:
          Number.isFinite(concurrency) && concurrency > 0
            ? Math.trunc(concurrency)
            : 2,
        name: "ssr-pool-example",
      },
    )
  : null;

if (pool !== null) {
  await pool.ready();
}

const templatePath = production
  ? join(root, "dist", "client", "index.html")
  : join(root, "index.html");

let headUpdates = 0;
let activeStreams = 0;

const HEAD_TOKEN = "<!--app-head-->";
const HTML_TOKEN = "<!--app-html-->";

function splitTemplate(template) {
  const headIndex = template.indexOf(HEAD_TOKEN);
  const htmlIndex = template.indexOf(HTML_TOKEN);
  if (headIndex === -1 || htmlIndex === -1 || htmlIndex < headIndex) {
    throw new Error("index.html: ожидаются маркеры <!--app-head--> и <!--app-html-->");
  }
  return {
    beforeHead: template.slice(0, headIndex),
    afterHead: template.slice(headIndex + HEAD_TOKEN.length, htmlIndex),
    afterHtml: template.slice(htmlIndex + HTML_TOKEN.length),
  };
}

async function loadTemplate(request) {
  const template = await readFile(templatePath, "utf8");
  return vite === null
    ? template
    : vite.transformIndexHtml(request.url ?? "/", template);
}

function renderArgs(url) {
  const rawDelay = Number(url.searchParams.get("delay") ?? 0);
  const delayMs = Number.isFinite(rawDelay)
    ? Math.min(Math.max(Math.trunc(rawDelay), 0), 30_000)
    : 0;
  return {
    title: url.searchParams.get("title") ?? "Silent SSR Pool",
    delayMs,
    late: url.searchParams.get("late") === "1",
    fail: url.searchParams.get("fail") === "1",
    req: url.searchParams.get("req") ?? "main",
  };
}

function errorStatus(error) {
  const code = error?.code;
  if (
    code === "queue-full" ||
    code === "pool-closed" ||
    code === "timeout" ||
    code === "worker-exited" ||
    code === "busy"
  ) {
    return 503;
  }
  return 500;
}

function sendError(response, error) {
  if (response.headersSent) {
    response.destroy(error);
    return;
  }
  response.statusCode = errorStatus(error);
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(error instanceof Error ? error.stack : String(error));
}

function writeStreamStart(response, head, parts) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  response.write(parts.beforeHead);
  response.write(head);
  response.write(parts.afterHead);
}

function waitDrain(response) {
  return new Promise((resolve) => {
    const done = () => {
      response.off("drain", done);
      response.off("close", done);
      resolve();
    };
    response.on("drain", done);
    response.on("close", done);
  });
}

async function writeChunk(response, chunk) {
  if (response.destroyed || response.writableEnded) {
    return false;
  }
  if (response.write(chunk)) {
    return true;
  }
  await waitDrain(response);
  return !response.destroyed && !response.writableEnded;
}

async function renderUnary(args) {
  if (pool !== null) {
    return await pool.render([args]);
  }
  const module = await vite.ssrLoadModule("/src/entry-server.tsx");
  return await module.render(args);
}

async function handlePage(request, response) {
  const args = renderArgs(new URL(request.url ?? "/", "http://localhost"));
  const template = await loadTemplate(request);
  const parts = splitTemplate(template);
  const { html, head } = await renderUnary(args);
  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    `${parts.beforeHead}${head}${parts.afterHead}${html}${parts.afterHtml}`,
  );
}

async function handleStream(request, response) {
  const args = renderArgs(new URL(request.url ?? "/", "http://localhost"));
  const template = await loadTemplate(request);
  const parts = splitTemplate(template);

  const controller = new AbortController();
  const onRequestClose = () => {
    if (!response.writableEnded) {
      controller.abort(new Error("клиент закрыл соединение"));
    }
  };
  request.on("close", onRequestClose);
  activeStreams += 1;

  try {
    if (pool !== null) {
      const handle = pool.renderStream([args], {
        signal: controller.signal,
        onHead(_head, info) {
          if (info.final) {
            headUpdates += 1;
          }
        },
      });
      const head = await handle.head;
      writeStreamStart(response, head, parts);
      for await (const chunk of handle.stream) {
        if (!(await writeChunk(response, chunk))) {
          break;
        }
      }
      await handle.done;
      if (!response.destroyed && !response.writableEnded) {
        response.end(parts.afterHtml);
      }
      return;
    }

    // dev: рендер в main-потоке, head собирается из onHead.
    const module = await vite.ssrLoadModule("/src/entry-server.tsx");
    let started = false;
    const stream = module.renderStream(args, {
      signal: controller.signal,
      onHead(head, info) {
        if (info.final) {
          headUpdates += 1;
          return;
        }
        if (!started) {
          started = true;
          writeStreamStart(response, head, parts);
        }
      },
      onShell() {},
    });
    for await (const chunk of stream) {
      if (!started) {
        continue;
      }
      if (!(await writeChunk(response, chunk))) {
        break;
      }
    }
    if (!started) {
      throw new Error("renderStream завершился без onHead");
    }
    if (!response.destroyed && !response.writableEnded) {
      response.end(parts.afterHtml);
    }
  } finally {
    request.off("close", onRequestClose);
    activeStreams -= 1;
  }
}

function handleStats(response) {
  const base =
    pool === null
      ? {
          state: "inline",
          workers: { total: 0, booting: 0, idle: 0, busy: 0 },
          queueDepth: 0,
          completed: 0,
          failed: 0,
          timedOut: 0,
          aborted: 0,
          rejectedOverflow: 0,
          restarts: 0,
          deaths: 0,
          staleMessages: 0,
        }
      : pool.stats();
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      ...base,
      mode: production ? "pool" : "inline",
      headUpdates,
      activeStreams,
    }),
  );
}

function serveStatic(request, response) {
  const url = (request.url ?? "/").split("?")[0];
  const file = normalize(join(root, "dist", "client", url));
  if (!file.startsWith(join(root, "dist", "client"))) {
    response.statusCode = 403;
    response.end("Forbidden");
    return true;
  }
  if (!existsSync(file) || extname(file) === ".html") {
    return false;
  }
  response.setHeader(
    "content-type",
    contentTypes.get(extname(file)) ?? "application/octet-stream",
  );
  createReadStream(file).pipe(response);
  return true;
}

async function handle(request, response) {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  try {
    if (pathname === "/__stats") {
      handleStats(response);
      return;
    }
    if (pathname === "/") {
      await handlePage(request, response);
      return;
    }
    if (pathname === "/stream") {
      await handleStream(request, response);
      return;
    }
    if (production && serveStatic(request, response)) {
      return;
    }
    if (vite !== null) {
      vite.middlewares(request, response, () => {
        response.statusCode = 404;
        response.end("not found");
      });
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  } catch (error) {
    if (vite !== null) {
      vite.ssrFixStacktrace(error);
    }
    sendError(response, error);
  }
}

const server = createServer((request, response) => {
  void handle(request, response);
});

server.listen(port, () => {
  const address = server.address();
  const actualPort =
    address !== null && typeof address === "object" ? address.port : port;
  console.log(`ssr-pool: http://localhost:${actualPort}/`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  server.close();
  try {
    await pool?.close({ timeoutMs: 3_000 });
  } catch (error) {
    console.error(error);
  }
  server.closeAllConnections?.();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
