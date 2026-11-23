import { describe, expect, it } from "vitest";
import { decode, defineProtocol, encode } from "../src/index.js";

const HEX = "01010cd09cd0bed181d0bad0b2d0b090aa0c3c80a0abfef9621075736572406578616d706c652e636f6d9693d89fee47044976616e020561646d696e047573657200000000000029400201610162";

class Address {
  public city = "";
  public zip = 0;
}

class User {
  public active = false;
  public address = new Address();
  public age = 0;
  public createdAt = new Date(0);
  public email: string | undefined = undefined;
  public id = 0n;
  public name = "";
  public roles = new Set<string>();
  public score = 0;
  public tags: string[] = [];
}

defineProtocol(Address, {
  fields: [
    { name: "city", type: "string" },
    { name: "zip", type: "int32" },
  ],
});

defineProtocol(User, {
  fields: [
    { name: "active", type: "bool" },
    { name: "address", type: ["class", () => Address] },
    { name: "age", type: "int32" },
    { name: "createdAt", type: "date" },
    { name: "email", type: "string", optional: true },
    { name: "id", type: "bigint" },
    { name: "name", type: "string" },
    { name: "roles", type: ["set", "string"] },
    { name: "score", type: "float64" },
    { name: "tags", type: ["array", "string"] },
  ],
});

function sample(): User {
  const user = new User();
  user.active = true;
  user.address.city = "Москва";
  user.address.zip = 101000;
  user.age = 30;
  user.createdAt = new Date(1700000000000);
  user.email = "user@example.com";
  user.id = 1234567890123n;
  user.name = "Ivan";
  user.roles = new Set(["admin", "user"]);
  user.score = 12.5;
  user.tags = ["a", "b"];
  return user;
}


function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("кросс-языковой oneof", () => {
  const Kind = { Created: 1, Updated: 2, Deleted: 3 } as const;

  class Payload {
    public count = 0;
    public text = "";
  }

  class Event {
    public kind: number = Kind.Created;
    public created: Payload | undefined = undefined;
    public updated: number | undefined = undefined;
    public deleted: null | undefined = undefined;
  }

  defineProtocol(Payload, {
    fields: [
      { name: "count", type: "int32" },
      { name: "text", type: "string" },
    ],
  });

  defineProtocol(Event, {
    fields: [],
    oneofs: [
      {
        name: "kind",
        enum: () => Kind,
        variants: [
          { value: 1, field: "created", type: ["class", () => Payload] },
          { value: 2, field: "updated", type: "int32" },
          { value: 3, field: "deleted", type: "null" },
        ],
      },
    ],
  });

  it("payload, скаляр и unit совпадают с Rust и Kotlin", () => {
    const created = new Event();
    created.kind = Kind.Created;
    created.created = new Payload();
    created.created.count = 7;
    created.created.text = "hi";
    expect(toHex(encode(created))).toBe("010e026869");

    const updated = new Event();
    updated.kind = Kind.Updated;
    updated.updated = 42;
    expect(toHex(encode(updated))).toBe("0254");

    const deleted = new Event();
    deleted.kind = Kind.Deleted;
    deleted.deleted = null;
    expect(toHex(encode(deleted))).toBe("03");
  });
});

describe("кросс-языковой вектор", () => {
  it("совпадает с Rust и Kotlin", () => {
    expect(toHex(encode(sample()))).toBe(HEX);
  });

  it("декодируется обратно", () => {
    const value = decode(User, fromHex(HEX));
    expect(value.active).toBe(true);
    expect(value.address.city).toBe("Москва");
    expect(value.address.zip).toBe(101000);
    expect(value.age).toBe(30);
    expect(value.createdAt.getTime()).toBe(1700000000000);
    expect(value.email).toBe("user@example.com");
    expect(value.id).toBe(1234567890123n);
    expect(value.name).toBe("Ivan");
    expect([...value.roles]).toEqual(["admin", "user"]);
    expect(value.score).toBe(12.5);
    expect(value.tags).toEqual(["a", "b"]);
  });
});
