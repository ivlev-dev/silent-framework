import { Bench } from "tinybench";

export interface BenchTask {
  readonly name: string;
  readonly fn: () => void | Promise<void>;
}

export interface BenchSuite {
  readonly name: string;
  readonly tasks: readonly BenchTask[];
}

export interface BenchOptionsConfig {
  readonly time: number;
  readonly warmupTime: number;
}

const DEFAULTS: BenchOptionsConfig = { time: 500, warmupTime: 100 };

export async function runSuite(
  suite: BenchSuite,
  config: BenchOptionsConfig = DEFAULTS,
): Promise<Map<string, number>> {
  const bench = new Bench({
    time: config.time,
    warmupTime: config.warmupTime,
    throws: true,
  });
  for (const task of suite.tasks) {
    bench.add(task.name, task.fn);
  }
  await bench.run();
  const results = new Map<string, number>();
  for (const task of bench.tasks) {
    const result = task.result;
    if (result.state === "completed") {
      results.set(task.name, result.throughput.mean);
    }
  }
  return results;
}
