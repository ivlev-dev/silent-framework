import { describe, expect, it } from "vitest";
import { Field, Form, Required } from "../src/index.js";

/**
 * Smoke-гейт производительности, а не бенчмарк: пороги намеренно с большим
 * запасом (5–10× локальных медиан), чтобы ловить O(n²) и деградации на
 * порядок, но не микрошумы и различия CI.
 */

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function measure(run: () => void, samples = 3): number {
  run();
  const times: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return median(times);
}

class PerfForm extends Form {
  @Field() public accessor f0 = "";
  @Field() public accessor f1 = "";
  @Field() @Required() public accessor f2 = "";
  @Field() public accessor f3 = "";
  @Field() public accessor f4 = "";
  @Field() public accessor f5 = "";
  @Field() public accessor f6 = "";
  @Field() public accessor f7 = "";
  @Field() public accessor f8 = "";
  @Field() public accessor f9 = "";
  @Field() public accessor f10 = "";
  @Field() public accessor f11 = "";
  @Field() public accessor f12 = "";
  @Field() public accessor f13 = "";
  @Field() public accessor f14 = "";
  @Field() public accessor f15 = "";
}

describe("перф-гейт формы", () => {
  it("кэш props, ошибки, записи, validateField и агрегаты", async () => {
    const form = new PerfForm();
    for (let index = 0; index < 16; index += 1) {
      form.setValues({ [`f${index}`]: `v${index}` } as never);
    }
    form.setFieldErrors("f0", ["Ошибка 0"]);
    form.setFieldErrors("f1", ["Ошибка 1"]);
    form.setFieldErrors("f2", ["Ошибка 2"]);
    const props = form.getFieldProps("f0");

    const getProps = measure(() => {
      for (let index = 0; index < 100_000; index += 1) {
        form.getFieldProps("f0");
      }
    });

    const errorReads = measure(() => {
      for (let index = 0; index < 10_000; index += 1) {
        void props.errors;
        void props.error;
        void props.isValid;
      }
    });

    const writes = measure(() => {
      for (let index = 0; index < 5_000; index += 1) {
        form.setValues({ f0: `a${index}` } as never);
        props.setValue(`b${index}`);
      }
    });

    const validateStart = performance.now();
    for (let index = 0; index < 100; index += 1) {
      await form.validateField("f2");
    }
    const validateField = performance.now() - validateStart;

    const aggregates = measure(() => {
      for (let index = 0; index < 1_000; index += 1) {
        void form.values;
        void form.isReady;
      }
    });

    console.log(
      JSON.stringify({
        getFieldProps100k: Number(getProps.toFixed(2)),
        errorReads10k: Number(errorReads.toFixed(2)),
        writes10k: Number(writes.toFixed(2)),
        validateField100: Number(validateField.toFixed(2)),
        valuesReady1000: Number(aggregates.toFixed(2)),
      }),
    );

    expect(getProps).toBeLessThan(2_000);
    expect(errorReads).toBeLessThan(2_000);
    expect(writes).toBeLessThan(3_000);
    expect(validateField).toBeLessThan(5_000);
    expect(aggregates).toBeLessThan(2_000);
  });
});
