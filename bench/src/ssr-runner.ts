import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const server = spawnSync(
  process.execPath,
  ["--import", "tsx", "src/ssr-server.ts", ...args],
  { stdio: "inherit" },
);
if (server.status !== 0) {
  process.exit(server.status ?? 1);
}
const hydrate = spawnSync(
  process.execPath,
  ["--import", "tsx", "--conditions=browser", "src/ssr-hydrate.ts"],
  { stdio: "inherit" },
);
process.exit(hydrate.status ?? 1);
