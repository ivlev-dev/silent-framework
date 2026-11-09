import { cpus } from "node:os";
import { silentSuite } from "./silent";
import { solidSuite } from "./solid";
import { runSuite, type BenchSuite } from "./suite";

const RUNS = 3;

function format(value: number | undefined): string {
  return value === undefined ? "n/a" : Math.round(value).toLocaleString("ru-RU");
}

function ratio(silent: number | undefined, solid: number | undefined): string {
  if (silent === undefined || solid === undefined || solid === 0) {
    return "n/a";
  }
  return `${(silent / solid).toFixed(2)}x`;
}

function mergeBest(
  target: Map<string, number>,
  source: Map<string, number>,
): void {
  for (const [name, value] of source) {
    const current = target.get(name);
    if (current === undefined || value > current) {
      target.set(name, value);
    }
  }
}

async function measure(suite: BenchSuite): Promise<Map<string, number>> {
  const best = new Map<string, number>();
  for (let run = 0; run < RUNS; run += 1) {
    console.log(`▶ ${suite.name} (${run + 1}/${RUNS})`);
    mergeBest(best, await runSuite(suite));
  }
  return best;
}

const silentResults = await measure(silentSuite);
const solidResults = await measure(solidSuite);

const rows = silentSuite.tasks.map((task) => {
  const silent = silentResults.get(task.name);
  const solid = solidResults.get(task.name);
  return {
    scenario: task.name,
    "silent ops/s": format(silent),
    "solid ops/s": format(solid),
    "silent/solid": ratio(silent, solid),
  };
});

const cpu = cpus()[0]?.model ?? "unknown";
console.log(`\nCPU: ${cpu}`);
console.log(`Node.js ${process.version}, solid-js 1.9.18, лучший результат из ${RUNS} прогонов`);
console.table(rows);
console.log("Больше — лучше; silent/solid > 1 — silent быстрее.");
