import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageNames = ["validation", "validation-vite"];
const packedNames = [...packageNames, "vite", "swc"];
const entryFiles = {
  validation: join("dist", "index.js"),
  "validation-vite": join("dist", "index.js"),
  vite: join("dist", "index.js"),
  swc: "index.js",
};
const output = mkdtempSync(join(tmpdir(), "silent-consumer-"));
const packs = join(output, "packs");
const project = join(output, "project");

function packTarball(name) {
  const directory = join(root, "packages", name);
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  execFileSync(pnpm, ["pack", "--pack-destination", packs], {
    cwd: directory,
    encoding: "utf8",
  });
  const base = manifest.name.slice(1).replace("/", "-");
  const file = join(packs, `${base}-${manifest.version}.tgz`);
  assert.ok(existsSync(file), `pnpm pack не создал ${base}-${manifest.version}.tgz`);
  return file;
}

function storeDirectory() {
  try {
    return execFileSync(pnpm, ["store", "path"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function install(tarballs, viteVersion) {
  const store = storeDirectory();
  const args = ["add", ...tarballs, `vite@${viteVersion}`];
  if (store !== null && store.length > 0) {
    args.push("--store-dir", store, "--package-import-method=copy");
  }
  try {
    execFileSync(pnpm, [...args, "--offline"], {
      cwd: project,
      stdio: "inherit",
    });
    return;
  } catch {
    console.log("consumer: офлайн-установка недоступна, повтор с сетью");
  }
  execFileSync(pnpm, args, { cwd: project, stdio: "inherit" });
}

function writeProject(viteVersion) {
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify(
      {
        name: "silent-consumer-check",
        private: true,
        version: "0.0.0",
        type: "module",
        devDependencies: { vite: viteVersion },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(project, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          experimentalDecorators: false,
          useDefineForClassFields: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(project, "vite.config.ts"),
    [
      'import { defineConfig } from "vite";',
      'import { silent } from "@ivlev-dev/silent-vite";',
      'import { validation } from "@ivlev-dev/silent-validation-vite";',
      "",
      "export default defineConfig({",
      "  plugins: [silent(), validation()],",
      "  build: {",
      "    minify: false,",
      '    lib: { entry: "src/main.ts", formats: ["es"], fileName: "index" },',
      "  },",
      "});",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(project, "src", "main.ts"),
    [
      'import { ValidationModel } from "@ivlev-dev/silent-validation";',
      "",
      "export class User extends ValidationModel {",
      '  public accessor email: string = "";',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(project, "check.mjs"),
    [
      'import { validate } from "@ivlev-dev/silent-validation";',
      'import { User } from "./dist/index.js";',
      "",
      "const valid = new User();",
      'valid.email = "user@example.com";',
      "const validResult = validate(valid);",
      'if (!validResult.valid) throw new Error("валидная модель не прошла проверку: " + JSON.stringify(validResult.errors));',
      "",
      "const invalid = new User();",
      "invalid.email = 123;",
      "const invalidResult = validate(invalid);",
      'if (invalidResult.valid) throw new Error("неверный тип поля email не обнаружен");',
      'const typeError = invalidResult.errors.find((error) => error.field === "email" && error.rule === "type");',
      'if (typeError === undefined) throw new Error("нет ошибки rule=type для email: " + JSON.stringify(invalidResult.errors));',
      "",
      'console.log("consumer: runtime ok");',
      "",
    ].join("\n"),
  );
}

try {
  for (const name of packedNames) {
    assert.ok(
      existsSync(join(root, "packages", name, entryFiles[name])),
      `нет packages/${name}/${entryFiles[name]} — сначала запусти pnpm build`,
    );
  }

  mkdirSync(packs, { recursive: true });
  mkdirSync(project, { recursive: true });

  const tarballs = packedNames.map(packTarball);
  const viteVersion = JSON.parse(
    readFileSync(join(root, "node_modules", "vite", "package.json"), "utf8"),
  ).version;

  writeProject(viteVersion);
  install(tarballs, viteVersion);

  for (const name of packedNames) {
    assert.ok(
      existsSync(
        join(project, "node_modules", "@ivlev-dev", `silent-${name}`, "package.json"),
      ),
      `@ivlev-dev/silent-${name} не установлен из tarball`,
    );
  }

  execFileSync(pnpm, ["exec", "vite", "build"], {
    cwd: project,
    stdio: "inherit",
  });

  const bundlePath = join(project, "dist", "index.js");
  assert.ok(existsSync(bundlePath), "vite build не создал dist/index.js");
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(
    bundle.includes("silent.validation.schema"),
    "в бандле нет схемы silent.validation.schema",
  );
  assert.ok(bundle.includes('"email"'), "в бандле нет поля email");

  execFileSync(process.execPath, [join(project, "check.mjs")], {
    cwd: project,
    stdio: "inherit",
  });

  console.log("consumer: ok");
} catch (error) {
  console.error(
    `consumer: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  rmSync(output, { recursive: true, force: true });
}
