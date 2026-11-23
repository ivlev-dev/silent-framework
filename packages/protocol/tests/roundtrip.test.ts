import { describe, expect, it } from "vitest";
import { decode, defineProtocol, encode } from "../src/index.js";
import { hex } from "./helpers.js";

enum Role {
  Admin = 1,
  User = 2,
  Guest = 3,
}

class Address {
  public city = "";
  public zip = "";
}

class AdminPayload {
  public scope = "";
}

class Profile {
  public id = 0n;
  public name = "";
  public nickname: string | undefined = undefined;
  public active = false;
  public rating = 0;
  public balance = 0n;
  public createdAt = new Date(0);
  public tags: string[] = [];
  public scores = new Map<string, number>();
  public roles = new Set<Role>();
  public address: Address | undefined = undefined;
  public meta: Record<string, string> = {};
  public pair: [number, string | null | undefined] = [0, undefined];
  public blob = new Uint8Array();
  public choice: Role = Role.Admin;
  public admin: AdminPayload | undefined = undefined;
  public guest: null | undefined = undefined;
}

defineProtocol(Address, {
  fields: [
    { name: "city", type: "string" },
    { name: "zip", type: "string" },
  ],
});

defineProtocol(AdminPayload, {
  fields: [{ name: "scope", type: "string" }],
});

defineProtocol(Profile, {
  fields: [
    { name: "id", type: "uint64" },
    { name: "name", type: "string" },
    { name: "nickname", type: "string", optional: true },
    { name: "active", type: "bool" },
    { name: "rating", type: "float32" },
    { name: "balance", type: "bigint" },
    { name: "createdAt", type: "date" },
    { name: "tags", type: ["array", "string"] },
    { name: "scores", type: ["map", "string", "int32"] },
    { name: "roles", type: ["set", ["enum", [1, 2, 3]]] },
    { name: "address", type: ["class", () => Address], optional: true },
    { name: "meta", type: ["record", "string"] },
    { name: "pair", type: ["tuple", ["int32", ["optional", "string"]]] },
    { name: "blob", type: "bytes" },
  ],
  oneofs: [
    {
      name: "choice",
      enum: () => Role,
      variants: [
        { value: Role.Admin, field: "admin", type: ["class", () => AdminPayload] },
        { value: Role.Guest, field: "guest", type: null },
      ],
    },
  ],
});

function filled(): Profile {
  const profile = new Profile();
  profile.id = 18446744073709551615n;
  profile.name = "Иван";
  profile.nickname = "vanya";
  profile.active = true;
  profile.rating = 4.5;
  profile.balance = -123456789n;
  profile.createdAt = new Date("2024-01-02T03:04:05.006Z");
  profile.tags = ["b", "a", "привет"];
  profile.scores = new Map([["z", 1], ["a", -2], ["м", 3]]);
  profile.roles = new Set([Role.Guest, Role.Admin]);
  const address = new Address();
  address.city = "Москва";
  address.zip = "101000";
  profile.address = address;
  profile.meta = { z: "end", a: "start" };
  profile.pair = [7, "seven"];
  profile.blob = new Uint8Array([0, 1, 254, 255]);
  profile.choice = Role.Admin;
  const admin = new AdminPayload();
  admin.scope = "all";
  profile.admin = admin;
  return profile;
}

describe("roundtrip сложной модели", () => {
  it("восстанавливает все поля", () => {
    const profile = filled();
    const restored = decode(Profile, encode(profile));
    expect(restored.id).toBe(profile.id);
    expect(restored.name).toBe(profile.name);
    expect(restored.nickname).toBe(profile.nickname);
    expect(restored.active).toBe(profile.active);
    expect(restored.rating).toBe(Math.fround(4.5));
    expect(restored.balance).toBe(profile.balance);
    expect(restored.createdAt.getTime()).toBe(profile.createdAt.getTime());
    expect(restored.tags).toEqual(profile.tags);
    expect([...restored.scores]).toEqual([
      ["a", -2],
      ["z", 1],
      ["м", 3],
    ]);
    expect([...restored.roles].sort()).toEqual([...profile.roles].sort());
    expect(restored.address?.city).toBe("Москва");
    expect(restored.address?.zip).toBe("101000");
    expect(restored.meta).toEqual(profile.meta);
    expect(restored.pair).toEqual([7, "seven"]);
    expect([...restored.blob]).toEqual([0, 1, 254, 255]);
    expect(restored.choice).toBe(Role.Admin);
    expect(restored.admin?.scope).toBe("all");
    expect(restored.guest).toBeUndefined();
  });

  it("кодирование детерминировано", () => {
    const first = encode(filled());
    const second = encode(filled());
    expect([...first]).toEqual([...second]);
    const restored = decode(Profile, first);
    expect(hex(encode(restored))).toBe(hex(first));
  });

  it("порядок вставки Map и Set не влияет", () => {
    const a = filled();
    a.scores = new Map([["z", 1], ["a", -2], ["м", 3]]);
    a.roles = new Set([Role.Guest, Role.Admin]);
    const b = filled();
    b.scores = new Map([["м", 3], ["z", 1], ["a", -2]]);
    b.roles = new Set([Role.Admin, Role.Guest]);
    expect([...encode(a)]).toEqual([...encode(b)]);
  });

  it("roundtrip пустого профиля", () => {
    const profile = new Profile();
    profile.choice = Role.Guest;
    const restored = decode(Profile, encode(profile));
    expect(restored.id).toBe(0n);
    expect(restored.name).toBe("");
    expect(restored.nickname).toBeUndefined();
    expect(restored.tags).toEqual([]);
    expect(restored.scores.size).toBe(0);
    expect(restored.roles.size).toBe(0);
    expect(restored.address).toBeUndefined();
    expect(restored.meta).toEqual({});
    expect(restored.pair).toEqual([0, undefined]);
    expect(restored.blob.length).toBe(0);
    expect(restored.choice).toBe(Role.Guest);
    expect(restored.guest).toBeNull();
  });

  it("не мутирует входное значение", () => {
    const profile = filled();
    const mapBefore = [...profile.scores];
    const tagsBefore = [...profile.tags];
    encode(profile);
    expect([...profile.scores]).toEqual(mapBefore);
    expect(profile.tags).toEqual(tagsBefore);
  });
});
