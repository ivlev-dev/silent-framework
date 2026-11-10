import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 5174);
const production = process.env.NODE_ENV === "production";

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

const templatePath = production
  ? join(root, "dist/client/index.html")
  : join(root, "index.html");

async function renderPage(request, response) {
  const template = await readFile(templatePath, "utf8");
  const url = request.url ?? "/";
  const transformed =
    vite === null ? template : await vite.transformIndexHtml(url, template);
  const module =
    vite === null
      ? await import("./dist/server/entry-server.js")
      : await vite.ssrLoadModule("/src/entry-server.tsx");
  const { html, head } = await module.render({ title: "SSR Counter" });
  const page = transformed
    .replace("<!--app-head-->", head)
    .replace("<!--app-html-->", html);
  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(page);
}

function serveStatic(request, response) {
  const url = (request.url ?? "/").split("?")[0];
  const file = normalize(join(root, "dist/client", url));
  if (!file.startsWith(join(root, "dist/client"))) {
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

const server = createServer((request, response) => {
  const fail = (error) => {
    if (vite !== null) {
      vite.ssrFixStacktrace(error);
    }
    response.statusCode = 500;
    response.end(error instanceof Error ? error.stack : String(error));
  };

  if (vite !== null) {
    vite.middlewares(request, response, () => {
      renderPage(request, response).catch(fail);
    });
    return;
  }

  if (serveStatic(request, response)) {
    return;
  }

  renderPage(request, response).catch(fail);
});

server.listen(port, () => {
  console.log(`ssr-counter: http://localhost:${port}/`);
});
