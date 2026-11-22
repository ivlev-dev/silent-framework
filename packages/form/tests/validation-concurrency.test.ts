import { describe, expect, it } from "vitest";
import { Custom, Field, Form } from "../src/index.js";

interface Gate {
  readonly promise: Promise<boolean>;
  resolve(value: boolean): void;
}

function deferred(): Gate {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Дать движку валидации дойти до асинхронного правила. */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("конкурентные проверки одного поля", () => {
  it("два параллельных validate() поля на валидном значении оба true", async () => {
    const gates: Gate[] = [];
    class ConcurrentForm extends Form {
      @Field()
      @Custom(async () => {
        const current = deferred();
        gates.push(current);
        return current.promise;
      })
      public accessor code = "ok";
    }

    const form = new ConcurrentForm();
    await Promise.resolve();
    const props = form.getFieldProps("code");

    const first = props.validate();
    const second = props.validate();
    await settle();
    expect(gates).toHaveLength(2);

    // Первый прогон завершается раньше второго: его токен уже перекрыт,
    // но поколение и значение те же, поэтому вердикт обязан быть true.
    gates[0]!.resolve(true);
    await expect(first).resolves.toBe(true);

    gates[1]!.resolve(true);
    await expect(second).resolves.toBe(true);

    expect(form.errors).toEqual({});
    expect(props.error).toBeUndefined();
  });

  it("изменение значения во время проверки делает прогон устаревшим", async () => {
    const gates: Gate[] = [];
    class ChangedForm extends Form {
      @Field()
      @Custom(async () => {
        const current = deferred();
        gates.push(current);
        return current.promise;
      })
      public accessor code = "ok";
    }

    const form = new ChangedForm();
    await Promise.resolve();

    const pending = form.getFieldProps("code").validate();
    await settle();
    expect(gates).toHaveLength(1);

    form.getFieldProps("code").setValue("changed");
    gates[0]!.resolve(true);

    await expect(pending).resolves.toBe(false);
    expect(form.errors).toEqual({});
  });

  it("поздний прогон не перетирает ошибки более нового", async () => {
    const gates: Gate[] = [];
    class ErrorForm extends Form {
      @Field()
      @Custom(async () => {
        const current = deferred();
        gates.push(current);
        return current.promise;
      })
      public accessor code = "ok";
    }

    const form = new ErrorForm();
    await Promise.resolve();
    const props = form.getFieldProps("code");

    const first = props.validate();
    const second = props.validate();
    await settle();
    expect(gates).toHaveLength(2);

    // Новый прогон завершается первым и записывает ошибку.
    gates[1]!.resolve(false);
    await expect(second).resolves.toBe(false);
    expect(props.errors.length).toBeGreaterThan(0);
    expect(form.errors["code"]).toBeDefined();

    // Старый прогон завершается позже: он возвращает свой вердикт,
    // но не должен снимать ошибку, записанную новым прогоном.
    gates[0]!.resolve(true);
    await expect(first).resolves.toBe(true);
    expect(props.errors.length).toBeGreaterThan(0);
    expect(form.errors["code"]).toBeDefined();
  });
});
