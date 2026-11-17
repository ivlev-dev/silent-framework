import { afterEach, describe, expect, it } from "vitest";
import {
  getDevtoolsEvents,
  getDevtoolsSnapshot,
  installDevtools,
  subscribeDevtools,
  uninstallDevtools,
  type DevtoolsEvent,
} from "../src/index";
import { Container } from "@ivlev-dev/silent-di";

const EXPLICIT = Symbol("explicit-service");
const SCOPED = Symbol("scoped-service");

class ImplicitService {}

function makeContainer(): Container {
  return new Container("graph", undefined, { implicitBindings: "allow" });
}

function resolves(events: readonly DevtoolsEvent[]): Extract<
  DevtoolsEvent,
  { type: "resolve" }
>[] {
  return events.filter(
    (event): event is Extract<DevtoolsEvent, { type: "resolve" }> =>
      event.type === "resolve",
  );
}

afterEach(() => {
  uninstallDevtools();
});

describe("DevTools resolve", () => {
  it("эмитит resolve для явных, scoped и неявных токенов", async () => {
    const container = makeContainer();
    container.bind(EXPLICIT, () => ({ id: "explicit" }));
    container.bind(SCOPED, () => ({ id: "scoped" })).inScopedScope();

    installDevtools({ enabled: true });
    const events: DevtoolsEvent[] = [];
    subscribeDevtools((event) => events.push(event));

    await container.resolve(EXPLICIT);
    await container.resolve(SCOPED);
    await container.resolve(ImplicitService);

    const entries = resolves(getDevtoolsEvents());
    expect(entries).toEqual([
      expect.objectContaining({
        token: "explicit-service",
        container: "graph",
        owner: "graph",
        scope: "singleton",
        implicit: false,
        cached: false,
      }),
      expect.objectContaining({
        token: "scoped-service",
        container: "graph",
        owner: "graph",
        scope: "scoped",
        implicit: false,
        cached: false,
      }),
      expect.objectContaining({
        token: "ImplicitService",
        container: "graph",
        owner: "graph",
        scope: "singleton",
        implicit: true,
        cached: false,
      }),
    ]);
    expect(resolves(events)).toHaveLength(3);
  });

  it("помечает повторный резолв как cached", async () => {
    const container = makeContainer();
    container.bind(EXPLICIT, () => ({ id: "explicit" }));

    installDevtools({ enabled: true });
    subscribeDevtools(() => {});

    await container.resolve(EXPLICIT);
    await container.resolve(EXPLICIT);

    const entries = resolves(getDevtoolsEvents());
    expect(entries.map((event) => event.cached)).toEqual([false, true]);
    expect(getDevtoolsSnapshot().listeners.resolutions).toBe(2);
  });

  it("не эмитит resolve для отсутствующего биндинга", async () => {
    const container = makeContainer();

    installDevtools({ enabled: true });
    subscribeDevtools(() => {});

    await expect(container.resolve("missing-token")).rejects.toThrow();

    expect(resolves(getDevtoolsEvents())).toHaveLength(0);
  });

  it("прекращает эмитить resolve после uninstall", async () => {
    const container = makeContainer();
    container.bind(EXPLICIT, () => ({ id: "explicit" }));

    installDevtools({ enabled: true });
    subscribeDevtools(() => {});
    await container.resolve(EXPLICIT);
    expect(resolves(getDevtoolsEvents())).toHaveLength(1);

    uninstallDevtools();

    const events: DevtoolsEvent[] = [];
    subscribeDevtools((event) => events.push(event));
    await container.resolve(EXPLICIT);
    await container.resolve(SCOPED).catch(() => undefined);

    expect(resolves(events)).toHaveLength(0);
  });
});
