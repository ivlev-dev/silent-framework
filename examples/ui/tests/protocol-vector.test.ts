import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode, encode, ProtocolError } from "@ivlev-dev/silent-protocol";
import {
  ApiErrorBody,
  Project,
  ProjectInput,
  ProjectPage,
  ProjectPatch,
  ProjectMeta,
  UploadResult,
} from "../src/api/types.js";

interface Vector {
  readonly name: string;
  readonly description: string;
  readonly hex: string;
  readonly fields: Record<string, unknown>;
}

function readVector(name: string): Vector {
  return JSON.parse(
    readFileSync(
      new URL(`../protocol-vectors/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as Vector;
}

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(
    value.match(/../gu)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function roundtrip<T extends object>(ctor: new () => T, vector: Vector): T {
  const decoded = decode(ctor, fromHex(vector.hex));
  expect(toHex(encode(decoded))).toBe(vector.hex);
  return decoded;
}

function projectFrom(fields: Record<string, unknown>): Project {
  const project = new Project();
  project.budget = fields["budget"] as number;
  project.createdAt = new Date(fields["createdAt"] as number);
  project.id = fields["id"] as number;
  project.name = fields["name"] as string;
  project.owner = fields["owner"] as string;
  project.status = fields["status"] as Project["status"];
  project.tags = [...(fields["tags"] as string[])];
  return project;
}

describe("кросс-языковой вектор Project", () => {
  it("декодирует байты, созданные Rust", () => {
    const vector = readVector("project");
    const project = decode(Project, fromHex(vector.hex));
    const expected = projectFrom(vector.fields);
    expect(project.budget).toBe(expected.budget);
    expect(project.createdAt.getTime()).toBe(expected.createdAt.getTime());
    expect(project.id).toBe(expected.id);
    expect(project.name).toBe(expected.name);
    expect(project.owner).toBe(expected.owner);
    expect(project.status).toBe(expected.status);
    expect(project.tags).toEqual(expected.tags);
  });

  it("кодирует те же байты, что и Rust", () => {
    const vector = readVector("project");
    expect(toHex(encode(projectFrom(vector.fields)))).toBe(vector.hex);
  });

  it("поддерживает пустые строки и пустой массив tags", () => {
    const vector = readVector("project-empty");
    const project = roundtrip(Project, vector);
    expect(project).toEqual(projectFrom(vector.fields));
    expect(project.tags).toEqual([]);
    expect(project.createdAt.getTime()).toBe(0);
  });
});

describe("кросс-языковой вектор ProjectPage", () => {
  it("декодирует вложенные проекты, кириллицу и границы uint32", () => {
    const vector = readVector("project-page");
    const page = roundtrip(ProjectPage, vector);
    expect(page.items).toHaveLength(3);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(10);
    expect(page.total).toBe(3);

    expect(page.items[0]?.name).toBe("Платформа");
    expect(page.items[0]?.createdAt.getTime()).toBe(1_700_000_000_000);
    expect(page.items[0]?.tags).toEqual(["api", "docs"]);

    expect(page.items[1]?.name).toBe("");
    expect(page.items[1]?.tags).toEqual([]);

    expect(page.items[2]?.id).toBe(4294967295);
    expect(page.items[2]?.createdAt.getTime()).toBe(-86_400_000);
    expect(page.items[2]?.budget).toBe(1_000_000_000_000);
    expect(page.items[2]?.status).toBe("paused");
    expect(page.items[2]?.tags).toEqual(["кириллица", "unicode-тег"]);
  });

  it("кодирует страницу обратно в байты Rust", () => {
    const vector = readVector("project-page");
    const page = new ProjectPage();
    page.items = (vector.fields["items"] as Record<string, unknown>[]).map(
      projectFrom,
    );
    page.page = vector.fields["page"] as number;
    page.pageSize = vector.fields["pageSize"] as number;
    page.total = vector.fields["total"] as number;
    expect(toHex(encode(page))).toBe(vector.hex);
  });
});

describe("кросс-языковой вектор ProjectMeta", () => {
  it("кодирует и декодирует владельцев, статусы и теги", () => {
    const vector = readVector("project-meta");
    const meta = roundtrip(ProjectMeta, vector);
    expect(meta.owners).toEqual(["Ада Ловлейс", "Иван Лебедев"]);
    expect(meta.statuses).toEqual(["active", "review", "done", "paused"]);
    expect(meta.tags).toEqual(["api", "кириллица"]);
  });

  it("поддерживает пустые массивы", () => {
    const vector = readVector("project-meta-empty");
    expect(vector.hex).toBe("000000");
    const meta = roundtrip(ProjectMeta, vector);
    expect(meta.owners).toEqual([]);
    expect(meta.statuses).toEqual([]);
    expect(meta.tags).toEqual([]);
  });
});

describe("кросс-языковой вектор ProjectInput", () => {
  it("кодирует обязательные поля без bitmap", () => {
    const vector = readVector("project-input");
    const input = roundtrip(ProjectInput, vector);
    expect(input.name).toBe("Платформа");
    expect(input.owner).toBe("Ада Ловлейс");
    expect(input.status).toBe("review");
    expect(input.tags).toEqual(["api", "docs"]);
    expect(input.budget).toBe(4242.5);
  });

  it("поддерживает пустые строки и tags", () => {
    const vector = readVector("project-input-empty");
    const input = roundtrip(ProjectInput, vector);
    expect(input.name).toBe("");
    expect(input.tags).toEqual([]);
  });
});

describe("кросс-языковой вектор ProjectPatch", () => {
  it("кодирует bitmap как в Rust", () => {
    const patch = new ProjectPatch();
    patch.status = "done";
    patch.tags = ["release"];
    expect(toHex(encode(patch))).toBe(readVector("project-patch").hex);
    expect(readVector("project-patch").hex).toBe("1802010772656c65617365");
  });

  it("различает отсутствующее поле и пустой массив", () => {
    const partial = roundtrip(ProjectPatch, readVector("project-patch"));
    expect(partial.status).toBe("done");
    expect(partial.tags).toEqual(["release"]);
    expect(partial.name).toBeUndefined();
    expect(partial.budget).toBeUndefined();

    const empty = roundtrip(ProjectPatch, readVector("project-patch-empty"));
    expect(empty).toEqual(new ProjectPatch());

    const tagsEmpty = roundtrip(
      ProjectPatch,
      readVector("project-patch-tags-empty"),
    );
    expect(tagsEmpty.tags).toEqual([]);
    expect(tagsEmpty.name).toBeUndefined();
    expect(toHex(encode(tagsEmpty))).toBe("1000");
  });

  it("отвергает неизвестный статус", () => {
    expect(() => decode(ProjectPatch, new Uint8Array([0x08, 9]))).toThrow(
      ProtocolError,
    );
  });
});

describe("кросс-языковые векторы ApiError и UploadResult", () => {
  it("ApiError декодируется с кириллицей", () => {
    const vector = readVector("api-error");
    const error = roundtrip(ApiErrorBody, vector);
    expect(error.code).toBe("invalid_query");
    expect(error.message).toBe("Параметр `pageSize` должен быть от 10 до 100");
  });

  it("UploadResult сохраняет size на границе uint32", () => {
    const vector = readVector("upload-result");
    const upload = roundtrip(UploadResult, vector);
    expect(upload.id).toBe("6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0f");
    expect(upload.name).toBe("заметки 2026.txt");
    expect(upload.mime).toBe("text/plain; charset=utf-8");
    expect(upload.size).toBe(4294967295);
    expect(upload.url).toBe(
      "/uploads/6f1a3c1e-1f9f-4f1a-9f0e-5d6b7c8d9e0f.txt",
    );
  });
});

describe("лимиты и негативные случаи", () => {
  const page = fromHex(readVector("project-page").hex);

  it("применяет maxSize как в Rust (2 MiB и меньше)", () => {
    expect(() => decode(ProjectPage, page, { maxSize: 16 })).toThrow(
      ProtocolError,
    );
    expect(() => decode(ProjectPage, page, { maxSize: 2 * 1024 * 1024 })).not.toThrow();
  });

  it("применяет maxDepth к вложенным Project", () => {
    expect(() => decode(ProjectPage, page, { maxDepth: 1 })).toThrow(
      ProtocolError,
    );
    expect(() => decode(ProjectPage, page, { maxDepth: 4 })).not.toThrow();
  });

  it("применяет maxSize при кодировании", () => {
    const value = new ProjectPage();
    value.items = [projectFrom(readVector("project").fields)];
    value.page = 1;
    value.pageSize = 10;
    value.total = 1;
    expect(() => encode(value, { maxSize: 16 })).toThrow(ProtocolError);
  });

  it("отвергает пустой, обрезанный и удлинённый буфер", () => {
    expect(() => decode(Project, new Uint8Array([]))).toThrow(ProtocolError);
    expect(() => decode(Project, page.slice(0, page.length - 1))).toThrow(
      ProtocolError,
    );
    const trailing = new Uint8Array(page.length + 1);
    trailing.set(page);
    expect(() => decode(ProjectPage, trailing)).toThrow(ProtocolError);
  });

  it("отвергает битый UTF-8 и неверный bool", () => {
    expect(() => decode(Project, fromHex("0000000000000000000101ff"))).toThrow(
      ProtocolError,
    );
    expect(() => decode(ApiErrorBody, new Uint8Array([0x00]))).toThrow(
      ProtocolError,
    );
  });
});
