import { Bench } from "tinybench";
import { renderToString as silentRender } from "@ivlev-dev/silent-server";
import { escape, renderToString as solidRender, ssr } from "solid-js/web";
import { ROWS, silentApp } from "./ssr-app";

const TIME = 500;
const WARMUP = 100;

function solidApp(): unknown {
  const items = Array.from(
    { length: ROWS },
    (_, index) => ssr(["<li>", "</li>"], escape(String(index))),
  );
  return ssr(
    ['<div class="app"><h1>', '</h1><ul class="list">', "</ul></div>"],
    escape("Title"),
    items,
  );
}

async function main(): Promise<void> {
  const bench = new Bench({ time: TIME, warmupTime: WARMUP, throws: true });
  bench.add("silent renderToString", async () => {
    const result = await silentRender(silentApp as never, {});
    if (!result.html.includes("<li>")) {
      throw new Error("silent: пустой результат");
    }
  });
  bench.add("solid renderToString", async () => {
    const html = await solidRender(solidApp as never);
    if (!html.includes("<li>")) {
      throw new Error("solid: пустой результат");
    }
  });
  await bench.run();

  const rows = bench.tasks.map((task) => ({
    scenario: task.name,
    "ops/s":
      task.result.state === "completed"
        ? Math.round(task.result.throughput.mean).toLocaleString("ru-RU")
        : "n/a",
  }));
  console.log(`SSR: ${ROWS} элементов, лучший результат tinybench`);
  console.table(rows);
}

await main();
