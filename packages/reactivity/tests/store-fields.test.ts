import { describe, expect, it } from "vitest";
import {
  copyReactiveState,
  createRenderEffect,
  flushSync,
  readField,
  storeFor,
  writeField,
  type ReactiveStore,
} from "../src/index";

interface StoreInternals {
  readonly fieldSignals: Map<PropertyKey, unknown>;
}

const internals = (store: ReactiveStore): StoreInternals =>
  store as unknown as StoreInternals;

describe("аллокация сигналов полей store", () => {
  it("не создаёт сигналы для ключей, которые никто не читал", () => {
    const instance: Record<string, number> = {};
    for (let index = 0; index < 1000; index += 1) {
      const key = `field${index}`;
      writeField(instance, key, index, (value) => {
        instance[key] = value;
      });
    }

    expect(internals(storeFor(instance)).fieldSignals.size).toBe(0);
    expect(instance["field0"]).toBe(0);
    expect(instance["field999"]).toBe(999);
  });

  it("обновляет значение и подписчиков после чтения ключа", () => {
    const instance = { count: 0 };
    const read = (): number =>
      readField(instance, "count", () => instance.count);
    const write = (value: number): void => {
      writeField(instance, "count", value, (raw) => {
        instance.count = raw;
      });
    };

    let runs = 0;
    let seen = -1;
    createRenderEffect(() => {
      seen = read();
      runs += 1;
    });
    expect(runs).toBe(1);
    expect(seen).toBe(0);
    expect(internals(storeFor(instance)).fieldSignals.size).toBe(1);

    write(5);
    flushSync();
    expect(seen).toBe(5);
    expect(runs).toBe(2);

    write(5);
    flushSync();
    expect(runs).toBe(2);

    writeField(
      instance,
      "other",
      1,
      (raw) => {
        (instance as { other?: number }).other = raw;
      },
    );
    expect(internals(storeFor(instance)).fieldSignals.size).toBe(1);
  });

  it("копирует поля, записанные без чтения (set без get)", () => {
    const source: Record<string, number> = { count: 0 };
    const target: Record<string, number> = { count: 0 };
    writeField(source, "count", 42, (raw) => {
      source.count = raw;
    });
    writeField(source, "other", 7, (raw) => {
      (source as { other?: number }).other = raw;
    });

    expect(internals(storeFor(source)).fieldSignals.size).toBe(0);
    copyReactiveState(source, target);

    expect(
      readField(target, "count", () => target.count),
    ).toBe(42);
    expect(
      readField(
        target,
        "other",
        () => (target as { other?: number }).other ?? -1,
      ),
    ).toBe(7);
  });
});
