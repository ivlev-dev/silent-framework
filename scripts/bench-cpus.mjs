import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function allowedCpus() {
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const match = status.match(/Cpus_allowed_list:\s*(\S+)/);
    if (match === null) {
      return null;
    }
    const list = [];
    for (const part of match[1].split(",")) {
      const [from, to] = part.split("-").map(Number);
      if (to === undefined) {
        list.push(from);
      } else {
        for (let index = from; index <= to; index += 1) {
          list.push(index);
        }
      }
    }
    return list.length === 0 ? null : list;
  } catch {
    return null;
  }
}

function firstCpus(count) {
  const available = allowedCpus();
  if (available === null) {
    return `0-${String(count - 1)}`;
  }
  return available.slice(0, count).join(",");
}

const raw = process.argv.slice(2);
const separator = raw.indexOf("--");
const command = separator >= 0 ? raw.slice(0, separator) : raw;
const args = separator >= 0 ? raw.slice(separator + 1) : [];

if (command.length === 0) {
  console.error("bench-cpus: не указана команда");
  process.exit(2);
}

const cpus = process.env.SILENT_BENCH_CPUS ?? firstCpus(4);
const taskset =
  process.platform === "linux" &&
  cpus !== "" &&
  cpus !== "off" &&
  (existsSync("/usr/bin/taskset") || existsSync("/bin/taskset"));

const file = taskset ? "taskset" : command[0];
const argv = taskset ? ["-c", cpus, ...command, ...args] : [...command.slice(1), ...args];

const result = spawnSync(file, argv, { stdio: "inherit", env: process.env });
if (result.error !== undefined) {
  console.error(`bench-cpus: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
