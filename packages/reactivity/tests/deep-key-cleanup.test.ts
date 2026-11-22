import { describe, expect, it } from "vitest";
import {
  createRenderEffect,
  createSignal,
  deepReactive,
  flushSync,
  getReactivityStats,
} from "../src/index.js";

const signalDelta = (before: number): number =>
  getReactivityStats().signalsCreated - before;

describe("динамические ключи deep-прокси не оставляют мёртвых сигналов", () => {
  it("сигнал поля удаляется, когда эффект перестаёт его читать", () => {
    const state = deepReactive({ active: 1 });
    const [enabled, setEnabled] = createSignal(true);
    createRenderEffect(() => {
      if (enabled()) {
        void state.active;
      }
    });
    flushSync();

    const afterFirstRead = getReactivityStats().signalsCreated;
    setEnabled(false);
    flushSync();
    setEnabled(true);
    flushSync();

    // Если бы запись осталась в record.fields, сигнал переиспользовался бы
    // и счётчик не вырос; рост на 1 означает повторное создание после очистки.
    expect(signalDelta(afterFirstRead)).toBe(1);
  });

  it("чтение динамических отсутствующих ключей реагирует на добавление", () => {
    const state = deepReactive<Record<string, number>>({});
    const [key, setKey] = createSignal("k0");
    let runs = 0;
    createRenderEffect(() => {
      void state[key()];
      runs += 1;
    });
    flushSync();
    expect(runs).toBe(1);

    // Постоянная смена ключа не должна ломать отслеживание: каждый новый
    // отсутствующий ключ получает сигнал, старый снимается при reconcile.
    for (let index = 1; index < 50; index += 1) {
      setKey(`k${index}`);
      flushSync();
    }
    expect(runs).toBe(50);

    state.k49 = 1;
    flushSync();
    expect(runs).toBe(51);
    expect(state.k49).toBe(1);
  });

  it("слот Map удаляется после ухода observer'а и создаётся заново", () => {
    const map = deepReactive(
      new Map<string, number>([
        ["a", 1],
        ["b", 2],
      ]),
    );
    const [key, setKey] = createSignal("a");
    createRenderEffect(() => {
      map.get(key());
    });
    flushSync();

    const afterFirstRead = getReactivityStats().signalsCreated;
    setKey("b");
    flushSync();
    setKey("a");
    flushSync();

    // Переход a → b создаёт слот b (+1), возврат к a пересоздаёт удалённый
    // слот a (+1). Без очистки было бы только +1.
    expect(signalDelta(afterFirstRead)).toBe(2);
    expect(map.get("a")).toBe(1);
  });
});
