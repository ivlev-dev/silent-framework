import { describe, expect, it } from "vitest";
import { decode, defineProtocol, encode } from "../src/index.js";
import { bytesOf, expectProtocolError, hex } from "./helpers.js";

enum EventKind {
  Created = 1,
  Updated = 2,
  Deleted = 3,
}

class CreatedPayload {
  public name = "";
}

class UpdatedPayload {
  public changes = 0;
}

defineProtocol(CreatedPayload, {
  fields: [{ name: "name", type: "string" }],
});

defineProtocol(UpdatedPayload, {
  fields: [{ name: "changes", type: "int32" }],
});

class Event {
  public kind: EventKind = EventKind.Created;
  public created: CreatedPayload | undefined = undefined;
  public updated: UpdatedPayload | undefined = undefined;
  public deleted: null | undefined = undefined;
}

defineProtocol(Event, {
  fields: [],
  oneofs: [
    {
      name: "kind",
      enum: () => EventKind,
      variants: [
        { value: EventKind.Created, field: "created", type: ["class", () => CreatedPayload] },
        { value: EventKind.Updated, field: "updated", type: ["class", () => UpdatedPayload] },
        { value: EventKind.Deleted, field: "deleted", type: null },
      ],
    },
  ],
});

class WithOptional {
  public kind: EventKind = EventKind.Created;
  public created: CreatedPayload | undefined = undefined;
  public note: string | undefined = undefined;
}

defineProtocol(WithOptional, {
  fields: [{ name: "note", type: "string", optional: true }],
  oneofs: [
    {
      name: "kind",
      enum: () => EventKind,
      variants: [
        { value: EventKind.Created, field: "created", type: ["class", () => CreatedPayload] },
      ],
    },
  ],
});

function created(name: string): CreatedPayload {
  const payload = new CreatedPayload();
  payload.name = name;
  return payload;
}

describe("oneof: кодирование", () => {
  it("кодирует выбранный вариант и enum", () => {
    const event = new Event();
    event.kind = EventKind.Created;
    event.created = created("x");
    expect(hex(encode(event))).toBe("010178");
  });

  it("кодирует второй вариант", () => {
    const event = new Event();
    event.kind = EventKind.Updated;
    event.updated = new UpdatedPayload();
    event.updated.changes = 5;
    expect(hex(encode(event))).toBe("020a");
  });

  it("unit-вариант занимает ноль байт payload", () => {
    const event = new Event();
    event.kind = EventKind.Deleted;
    expect(hex(encode(event))).toBe("03");
    const restored = decode(Event, bytesOf(0x03));
    expect(restored.kind).toBe(EventKind.Deleted);
    expect(restored.deleted).toBeNull();
    expect(restored.created).toBeUndefined();
  });

  it("варианты не входят в bitmap", () => {
    const value = new WithOptional();
    value.note = "n";
    value.kind = EventKind.Created;
    value.created = created("x");
    expect(hex(encode(value))).toBe("01010178016e");
  });

  it("oneof занимает позицию дискриминатора", () => {
    const value = new WithOptional();
    value.note = "n";
    value.kind = EventKind.Created;
    value.created = created("x");
    const bytes = encode(value);
    expect(bytes[0]).toBe(0x01);
    expect(bytes[1]).toBe(0x01);
    expect(bytes[2]).toBe(0x01);
    expect(bytes[3]).toBe(0x78);
    expect(bytes[4]).toBe(0x01);
    expect(bytes[5]).toBe(0x6e);
  });

  it("отсутствующий optional не пишет значение", () => {
    const value = new WithOptional();
    value.kind = EventKind.Created;
    value.created = created("x");
    expect(hex(encode(value))).toBe("00010178");
  });
});

describe("oneof: декодирование", () => {
  it("roundtrip всех вариантов", () => {
    const first = new Event();
    first.kind = EventKind.Created;
    first.created = created("hello");
    const second = decode(Event, encode(first));
    expect(second.kind).toBe(EventKind.Created);
    expect(second.created?.name).toBe("hello");
    expect(second.updated).toBeUndefined();
    expect(second.deleted).toBeUndefined();

    const updated = new Event();
    updated.kind = EventKind.Updated;
    updated.updated = new UpdatedPayload();
    updated.updated.changes = -3;
    const restored = decode(Event, encode(updated));
    expect(restored.kind).toBe(EventKind.Updated);
    expect(restored.updated?.changes).toBe(-3);
    expect(restored.created).toBeUndefined();
  });

  it("неизвестное значение enum", () => {
    expectProtocolError(() => decode(Event, bytesOf(0x09)), "unknown_enum");
  });

  it("пустой payload не-unit варианта — обрезка", () => {
    expectProtocolError(() => decode(Event, bytesOf(0x01)), "truncated");
  });
});

describe("oneof: ошибки", () => {
  it("неизвестный дискриминатор при кодировании", () => {
    const event = new Event();
    event.kind = 9 as EventKind;
    expectProtocolError(() => encode(event), "unknown_enum");
  });

  it("дискриминатор не число", () => {
    const event = new Event();
    (event as unknown as { kind: unknown }).kind = "created";
    expectProtocolError(() => encode(event), "oneof");
  });

  it("выбранный вариант без значения", () => {
    const event = new Event();
    event.kind = EventKind.Created;
    expectProtocolError(() => encode(event), "oneof");
  });

  it("более одного варианта", () => {
    const event = new Event();
    event.kind = EventKind.Created;
    event.created = created("x");
    event.updated = new UpdatedPayload();
    expectProtocolError(() => encode(event), "oneof");
  });
});
