import { ProtocolError } from "./errors.js";
import type { ValidateHook, ValidateResult } from "./types.js";

export const VALIDATION_HOOK: symbol = Symbol.for("silent.validation.validate");

type ValidationOption = boolean | ValidateHook | undefined;

function hookFromGlobal(): ValidateHook | undefined {
  const holder = globalThis as unknown as Record<symbol, unknown>;
  const hook = holder[VALIDATION_HOOK];
  return typeof hook === "function" ? hook as ValidateHook : undefined;
}

function failure(errors: readonly unknown[] | undefined): ProtocolError {
  let details = "";
  if (errors !== undefined && errors.length > 0) {
    try {
      details = `: ${JSON.stringify(errors)}`;
    } catch {
      details = "";
    }
  }
  return new ProtocolError("validation", `значение не прошло валидацию${details}`);
}

function checkResult(result: ValidateResult): void {
  if (typeof result === "boolean") {
    if (!result) throw failure(undefined);
    return;
  }
  if (typeof result !== "object" || result === null || typeof result.valid !== "boolean") {
    throw new ProtocolError("validation", "валидатор вернул неверный результат");
  }
  if (!result.valid) throw failure(result.errors);
}

export function runValidation(value: object, option: ValidationOption): void {
  if (option === undefined || option === false) return;
  let hook: ValidateHook;
  if (option === true) {
    const global = hookFromGlobal();
    if (global === undefined) {
      throw new ProtocolError(
        "validation",
        "валидация запрошена, но хук silent.validation.validate не установлен",
      );
    }
    hook = global;
  } else {
    hook = option;
  }
  let result: ValidateResult;
  try {
    result = hook(value);
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ProtocolError("validation", `валидатор бросил исключение: ${message}`);
  }
  checkResult(result);
}
