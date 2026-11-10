import "./env";
import { execFileSync } from "node:child_process";
import { Bench } from "tinybench";
import {
  hydrate as silentHydrate,
  type MountHandle,
} from "@ivlev-dev/silent-core";
import { documentRef } from "./env";
import { ROWS, silentApp } from "./ssr-app";

const TIME = 500;
const WARMUP = 100;

const silentHtml = execFileSync("pnpm", ["exec", "tsx", "ssr-html.ts"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
});

async function main(): Promise<void> {
  const bench = new Bench({ time: TIME, warmupTime: WARMUP, throws: true });

  bench.add("silent hydrate", async () => {
    const target = documentRef.createElement("div");
    target.innerHTML = silentHtml;
    documentRef.body.appendChild(target);
    const handle: MountHandle = await silentHydrate(target, silentApp as never, {
      onMismatch: () => undefined,
    });
    handle.dispose();
    target.remove();
  });

  await bench.run();

  const rows = bench.tasks.map((task) => ({
    scenario: task.name,
    "ops/s":
      task.result.state === "completed"
        ? Math.round(task.result.throughput.mean).toLocaleString("ru-RU")
        : "n/a",
  }));
  console.log(`Гидрация: ${ROWS} элементов, лучший результат tinybench`);
  console.table(rows);
  console.log(
    "Solid hydrate требует разметку с data-hk от JSX-компилятора, поэтому в этом наборе измеряется только Silent.",
  );
}

await main();
