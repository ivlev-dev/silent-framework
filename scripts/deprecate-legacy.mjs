import { execFileSync } from "node:child_process";

const names = ["reactivity", "di", "core", "swc", "vite", "server"];
const dryRun = process.argv.includes("--dry-run");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const name of names) {
  const legacy = `@ivlev98/silent-${name}`;
  const current = `@ivlev-dev/silent-${name}`;
  const message = `Перенесён в ${current}`;
  const args = ["deprecate", `${legacy}@*`, message];
  if (dryRun) {
    console.log(`${npm} ${args.join(" ")}`);
    continue;
  }
  execFileSync(npm, args, { stdio: "inherit" });
  console.log(`deprecate: ${legacy} -> ${current}`);
}

console.log(dryRun ? "deprecate: dry-run" : "deprecate: ok");
