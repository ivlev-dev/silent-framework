import { describe, expect, it } from "vitest";
import { Container, createToken } from "../src/index.js";

describe("Container.snapshot", () => {
  it("возвращает дерево scope и агрегированные счётчики", async () => {
    const root = new Container("app");
    const token = createToken<{ id: number }>("snapshot-token");
    root.bind(token, () => ({ id: 1 }));
    const first = root.createScope("first");
    const second = first.createScope("second");
    await second.resolve(token);

    const snapshot = root.snapshot();
    expect(snapshot.name).toBe("app");
    expect(snapshot.parent).toBeNull();
    expect(snapshot.disposed).toBe(false);
    expect(snapshot.scopes).toBe(2);
    expect(snapshot.bindings).toBe(1);
    expect(snapshot.resolved).toBe(1);
    expect(snapshot.children).toHaveLength(1);
    expect(snapshot.children[0]?.name).toBe("first");
    expect(snapshot.children[0]?.children[0]?.name).toBe("second");
  });

  it("не считает удалённые scope и переживает dispose", () => {
    const root = new Container("app");
    const scope = root.createScope("scope");
    expect(root.snapshot().scopes).toBe(1);
    scope.dispose();
    expect(root.snapshot().scopes).toBe(0);
    root.dispose();
    const after = root.snapshot();
    expect(after.disposed).toBe(true);
    expect(after.bindings).toBe(0);
    expect(after.children).toHaveLength(0);
  });

  it("не удерживает ссылки на контейнеры в снимке", () => {
    const root = new Container("app");
    root.createScope("child");
    const snapshot = root.snapshot();
    expect(snapshot.children[0]).not.toHaveProperty("parentContainer");
    expect(snapshot.children[0]?.parent).toBe("app");
    expect(JSON.stringify(snapshot)).not.toContain("[object Object]");
  });
});
