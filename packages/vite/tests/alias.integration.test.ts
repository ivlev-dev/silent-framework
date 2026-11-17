import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scan, transform } from "@ivlev-dev/silent-swc";

const root = mkdtempSync(join(tmpdir(), "silent-alias-"));
mkdirSync(join(root, "src", "application"), { recursive: true });
mkdirSync(join(root, "src", "app"), { recursive: true });
writeFileSync(
  join(root, "src", "application", "service.ts"),
  [
    "export interface UsersService { load(): string }",
    "export class UsersServiceDefault implements UsersService {",
    "  load(): string { return 'users'; }",
    "}",
  ].join("\n"),
);
const probeSource = [
  'import type { UsersService } from "@/application/service";',
  "export class Probe {",
  "  constructor(private readonly users: UsersService) {}",
  "  read(): string { return this.users.load(); }",
  "}",
].join("\n");
const probePath = join(root, "src", "app", "probe.ts");
writeFileSync(probePath, probeSource);

const aliases = [{ find: "@/*", replacement: join(root, "src", "*") }];
const aliasesJson = JSON.stringify({ aliases });

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("алиасы в DI-индексе", () => {
  it("индексирует реализации по alias-импорту", () => {
    const indexJson = scan(root, aliasesJson);
    expect(indexJson).toContain("UsersServiceDefault");
    expect(indexJson).toContain("UsersService");
  });

  it("подставляет реализацию для type-импорта через alias", () => {
    const indexJson = scan(root, aliasesJson);
    const result: unknown = JSON.parse(
      transform(probeSource, probePath, aliasesJson, indexJson),
    );
    expect(result).toMatchObject({ code: expect.stringContaining("UsersServiceDefault"), diagnostics: [] });
  });
});
