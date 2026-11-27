// Замер производительности собранного SPA на preview-сервере.
//
// Что измеряется:
// - initial: LCP/CLS/TBT/INP, время до mount и route-ready, число запросов;
// - каждая страница: LCP, CLS, TBT, INP после сценарного взаимодействия,
//   количество DOM-мутаций (прокси числа обновлений), память JS-heap;
// - переходы между страницами: время от клика до отрисованного контента;
// - чанки: gzip/brotli размеры из dist и соответствие бюджету.
//
// Требует собранный dist и запущенный backend на 127.0.0.1:6108
// (`cargo run -p silent-example-ui-server`). Без backend метрики данных
// недостижимы, скрипт падает с понятной ошибкой.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import {
  launchBrowser,
  selectBrowserName,
} from "../../../scripts/lib/browser.mjs";
import { collectBundleReport } from "./bundle-budget.mjs";

const uiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browserName = selectBrowserName();
const backend = process.env.SILENT_UI_BACKEND ?? "http://127.0.0.1:6108";
const jsonOnly = process.argv.includes("--json");
const noFail = process.argv.includes("--no-fail");

export const LIMITS = {
  lcp: Number(process.env.PERF_LCP_MS ?? 120),
  inp: Number(process.env.PERF_INP_MS ?? 100),
  tbt: Number(process.env.PERF_TBT_MS ?? 50),
  cls: Number(process.env.PERF_CLS ?? 0),
  initialKb: Number(process.env.BUNDLE_INITIAL_KB ?? 60),
  routeKb: Number(process.env.BUNDLE_ROUTE_KB ?? 30),
};

const INIT_SCRIPT = `
  window.__silentPerf = {
    lcp: 0,
    lcpElement: null,
    cls: 0,
    longTasks: [],
    events: [],
    fetches: [],
    mutations: 0,
  };
  const record = (entry) => {
    if (entry.startTime < window.__silentPerf.lcp) return;
    window.__silentPerf.lcp = entry.startTime;
    const element = entry.element;
    window.__silentPerf.lcpElement = element
      ? {
          tag: element.tagName,
          class: typeof element.className === "string" ? element.className.slice(0, 120) : "",
          text: (element.textContent ?? "").trim().slice(0, 80),
        }
      : null;
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record(entry);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__silentPerf.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__silentPerf.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__silentPerf.events.push({
          name: entry.name,
          start: entry.startTime,
          duration: entry.duration,
        });
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__silentPerf.mutations += entry.length ?? 0;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  const mutationObserver = new MutationObserver((records) => {
    window.__silentPerf.mutations += records.length;
  });
  window.__silentPerf.observeMutations = () => {
    const root = document.querySelector("#app");
    if (root !== null) {
      mutationObserver.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
    window.__silentPerf.fetches.push(url);
    return originalFetch(...args);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.__silentPerf.observeMutations(), { once: true });
  } else {
    window.__silentPerf.observeMutations();
  }
`;

function summarize(perf) {
  const longTasks = perf.longTasks ?? [];
  const tbt = longTasks.reduce(
    (sum, entry) => sum + Math.max(0, entry.duration - 50),
    0,
  );
  const events = perf.events ?? [];
  const inp = events.reduce((max, entry) => Math.max(max, entry.duration), 0);
  return {
    lcp: Number(perf.lcp.toFixed(1)),
    lcpElement: perf.lcpElement,
    cls: Number(perf.cls.toFixed(4)),
    tbt: Number(tbt.toFixed(1)),
    inp: Number(inp.toFixed(1)),
    longTasks: longTasks.length,
    events: events.length,
    slowestEvents: events
      .slice()
      .sort((left, right) => right.duration - left.duration)
      .slice(0, 3)
      .map((entry) => ({ name: entry.name, duration: Number(entry.duration.toFixed(1)) })),
  };
}

async function apiAvailable() {
  try {
    const response = await fetch(`${backend}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

const ROUTES = [
  {
    path: "/",
    heading: "Dashboard",
    ready: ".app-metrics .app-stat",
    interaction: async (page) => {
      await page.getByRole("button", { name: /Включить (тёмную|светлую) тему/u }).click();
      await page.waitForTimeout(120);
      await page.getByRole("button", { name: /Включить (тёмную|светлую) тему/u }).click();
    },
  },
  {
    path: "/projects",
    heading: "Проекты",
    ready: ".sui-data-table[data-loaded]",
    interaction: async (page) => {
      await page.locator(".app-field--search input").fill("api");
      await page.waitForTimeout(120);
      await page.locator(".app-field--search input").fill("");
      await page.locator(".sui-data-table__th").nth(2).click();
    },
  },
  {
    path: "/team",
    heading: "Команда",
    ready: ".app-members .app-member-card",
    interaction: async (page) => {
      await page.getByRole("button", { name: /Включить (тёмную|светлую) тему/u }).click();
      await page.waitForTimeout(120);
      await page.getByRole("button", { name: /Включить (тёмную|светлую) тему/u }).click();
    },
  },
  {
    path: "/settings",
    heading: "Настройки",
    ready: "#settings-fullName",
    interaction: async (page) => {
      await page.locator("#settings-fullName").fill("Ада Ловлейс 2");
      await page.waitForTimeout(120);
      await page.locator(".app-form-readiness__item").nth(4).click();
    },
  },
];

async function heapSize(context, page) {
  if (browserName !== "chromium") return null;
  try {
    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    const { metrics } = await session.send("Performance.getMetrics");
    const entry = metrics.find((metric) => metric.name === "JSHeapUsedSize");
    await session.detach().catch(() => undefined);
    return entry === undefined ? null : Number((entry.value / 1024 / 1024).toFixed(2));
  } catch {
    return null;
  }
}

async function measureRoute(browser, base, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`HTTP ${String(response.status())}: ${response.url()}`);
    }
  });

  try {
    await page.goto(`${base}${route.path}`, { waitUntil: "load", timeout: 20_000 });
    await page.waitForSelector("h2", { timeout: 10_000 });
    await page.waitForSelector(route.ready, { timeout: 15_000 });
    if (route.path === "/projects") {
      await page.waitForFunction(
        () => document.querySelector(".sui-data-table")?.hasAttribute("data-loading") === false,
        undefined,
        { timeout: 15_000 },
      );
    }
    await page.waitForTimeout(800);
    const load = await page.evaluate(() => ({
      perf: window.__silentPerf,
      marks: Object.fromEntries(
        performance
          .getEntriesByType("mark")
          .map((mark) => [mark.name, Number(mark.startTime.toFixed(1))]),
      ),
      lcpEntries: 0,
    }));
    const memoryBefore = await heapSize(context, page);
    const mutationBefore = load.perf.mutations;
    await route.interaction(page);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__silentPerf);
    const memoryAfter = await heapSize(context, page);

    return {
      path: route.path,
      ok: errors.length === 0,
      errors,
      load: summarize(load.perf),
      afterInteraction: summarize(after),
      interactionMutations: after.mutations - mutationBefore,
      fetches: load.perf.fetches.length,
      fetchUrls: [...new Set(load.perf.fetches)],
      marks: load.marks,
      memoryMb: memoryAfter ?? memoryBefore,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function measureTransitions(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const transitions = [];
  try {
    await page.goto(`${base}/`, { waitUntil: "load", timeout: 20_000 });
    await page.waitForSelector(".app-metrics .app-stat", { timeout: 15_000 });
    const steps = [
      ["Проекты", "/projects", ".sui-data-table[data-loaded]"],
      ["Команда", "/team", ".app-members .app-member-card"],
      ["Настройки", "/settings", "#settings-fullName"],
      ["Dashboard", "/", ".app-metrics .app-stat"],
    ];
    for (const [label, path, ready] of steps) {
      const started = Date.now();
      await page.getByRole("button", { name: label, exact: true }).first().click();
      await page.waitForFunction(
        (expected) => location.pathname === expected,
        path,
        { timeout: 15_000 },
      );
      await page.waitForSelector(ready, { timeout: 15_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      transitions.push({ to: path, ms: Date.now() - started });
    }
    return transitions;
  } finally {
    await context.close().catch(() => undefined);
  }
}

function evaluateLimits(report) {
  const failures = [];
  const check = (value, limit, label) => {
    if (value > limit) failures.push(`${label}: ${String(value)} > ${String(limit)}`);
  };
  check(report.initial.load.lcp, LIMITS.lcp, "initial LCP, ms");
  check(report.initial.load.tbt, LIMITS.tbt, "initial TBT, ms");
  check(report.initial.load.cls, LIMITS.cls, "initial CLS");
  for (const route of report.routes) {
    check(route.afterInteraction.inp, LIMITS.inp, `${route.path}: INP, ms`);
    check(route.load.tbt, LIMITS.tbt, `${route.path}: TBT, ms`);
    check(route.load.cls, LIMITS.cls, `${route.path}: CLS`);
  }
  check(report.bundle.initialKb, LIMITS.initialKb, "initial JS, kB gzip");
  for (const chunk of report.bundle.routes) {
    check(chunk.kb, LIMITS.routeKb, `${chunk.file}: kB gzip`);
  }
  return failures;
}

async function main() {
  if (!(await apiAvailable())) {
    throw new Error(
      `Backend недоступен на ${backend}. Запустите examples/ui/server на порту 6108.`,
    );
  }
  const previousCwd = process.cwd();
  process.chdir(uiDir);
  let server = null;
  let browser = null;
  try {
    server = await preview({
      configFile: join(uiDir, "vite.config.ts"),
      root: uiDir,
      logLevel: "error",
      preview: { host: "127.0.0.1", port: 0 },
    });
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === "string") {
      throw new Error("Не удалось определить порт preview");
    }
    const base = `http://127.0.0.1:${String(address.port)}`;
    const launched = await launchBrowser(browserName);
    browser = launched.browser;

    const initial = await measureRoute(browser, base, {
      path: "/",
      heading: "Dashboard",
      ready: ".app-metrics .app-stat",
      interaction: async () => {},
    });
    const routes = [];
    for (const route of ROUTES) {
      routes.push(await measureRoute(browser, base, route));
    }
    const transitions = await measureTransitions(browser, base);
    const bundle = collectBundleReport({ silent: true });

    const report = {
      url: base,
      browser: browserName,
      backend,
      initial: {
        load: initial.load,
        marks: initial.marks,
        fetches: initial.fetches,
        fetchUrls: initial.fetchUrls,
        memoryMb: initial.memoryMb,
        errors: initial.errors,
      },
      routes,
      transitions,
      bundle,
      limits: LIMITS,
    };
    const failures = evaluateLimits(report);
    report.failures = failures;

    if (jsonOnly) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
    if (failures.length > 0 && !noFail) {
      process.exitCode = 1;
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    process.chdir(previousCwd);
  }
}

function printReport(report) {
  const line = (label, value, limit) =>
    `  ${label.padEnd(34)} ${String(value).padStart(9)}${limit === undefined ? "" : `   (лимит ${String(limit)})`}`;
  console.log("Начальная загрузка");
  console.log(line("LCP, ms", report.initial.load.lcp, report.limits.lcp));
  console.log(line("TBT, ms", report.initial.load.tbt, report.limits.tbt));
  console.log(line("CLS", report.initial.load.cls, report.limits.cls));
  console.log(line("mount, ms", report.initial.marks["silent:mounted"] ?? "—"));
  console.log(line("route-ready, ms", report.initial.marks["silent:route-ready"] ?? "—"));
  console.log(line("запросов к API", report.initial.fetches));
  console.log(line("JS heap, MB", report.initial.memoryMb ?? "—"));
  if (report.initial.load.lcpElement !== null) {
    console.log(
      `  LCP-элемент                       ${report.initial.load.lcpElement.tag}.${report.initial.load.lcpElement.class}`,
    );
  }
  console.log("\nСтраницы");
  for (const route of report.routes) {
    console.log(
      `  ${route.path.padEnd(12)} LCP ${String(route.load.lcp).padStart(6)}  TBT ${String(route.load.tbt).padStart(5)}  ` +
        `INP ${String(route.afterInteraction.inp).padStart(5)}  CLS ${String(route.load.cls).padStart(5)}  ` +
        `мутаций ${String(route.interactionMutations).padStart(4)}  запросов ${String(route.fetches).padStart(2)}  ` +
        `heap ${route.memoryMb ?? "—"} MB${route.ok ? "" : "  ОШИБКИ"}`,
    );
    for (const error of route.errors.slice(0, 3)) console.log(`    ! ${error}`);
    if (route.afterInteraction.slowestEvents.length > 0) {
      console.log(
        `    медленные события: ${route.afterInteraction.slowestEvents
          .map((event) => `${event.name} ${String(event.duration)} ms`)
          .join(", ")}`,
      );
    }
  }
  console.log("\nПереходы");
  console.log(`  ${report.transitions.map((item) => `${item.to} ${String(item.ms)} ms`).join("  ·  ")}`);
  console.log("\nЧанки");
  console.log(`  initial JS ${report.bundle.initialKb.toFixed(2)} kB gzip (лимит ${String(report.limits.initialKb)})`);
  for (const chunk of report.bundle.routes) {
    console.log(`  route ${chunk.file.padEnd(34)} ${chunk.kb.toFixed(2)} kB gzip (лимит ${String(report.limits.routeKb)})`);
  }
  for (const chunk of report.bundle.vendors) {
    console.log(`  vendor ${chunk.file.padEnd(33)} ${chunk.kb.toFixed(2)} kB gzip`);
  }
  if (report.failures.length > 0) {
    console.error("\nПревышены цели производительности:");
    for (const failure of report.failures) console.error(`  - ${failure}`);
  } else {
    console.log("\nЦели производительности достигнуты.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
