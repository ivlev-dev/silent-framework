import type { Form } from "./form.js";

export interface WizardOptions {
  /** Валидировать текущий шаг перед движением вперёд. По умолчанию `true`. */
  readonly validateStep?: boolean;
}

/**
 * Пошаговая форма. Wizard не владеет шагами: `dispose()` только
 * блокирует дальнейшие переходы и не освобождает переданные формы.
 */
export class FormWizard {
  private currentIndex = 0;
  private readonly validateOnStep: boolean;
  private disposed = false;

  constructor(
    private readonly stepList: readonly Form[],
    options?: WizardOptions,
  ) {
    if (stepList.length === 0) {
      throw new TypeError("FormWizard: нужен хотя бы один шаг");
    }
    this.validateOnStep = options?.validateStep ?? true;
  }

  get steps(): readonly Form[] {
    return this.stepList;
  }

  get index(): number {
    return this.currentIndex;
  }

  get current(): Form {
    return this.stepList[this.currentIndex]!;
  }

  get isFirst(): boolean {
    return this.currentIndex === 0;
  }

  get isLast(): boolean {
    return this.currentIndex === this.stepList.length - 1;
  }

  /** Готовность текущего шага. */
  get isReady(): boolean {
    return this.current.isReady;
  }

  /** Dirty, если изменён хотя бы один шаг. */
  get isDirty(): boolean {
    return this.stepList.some((step) => step.isDirty);
  }

  /** Объединённые ошибки шагов (локальные ключи). */
  get errors(): Readonly<Record<string, readonly string[]>> {
    const result: Record<string, readonly string[]> = {};
    for (const step of this.stepList) {
      for (const [key, messages] of Object.entries(step.errors)) {
        result[key] = messages;
      }
    }
    return result;
  }

  async validateStep(index = this.currentIndex): Promise<boolean> {
    const step = this.stepList[index];
    return step === undefined ? false : step.validate();
  }

  async validateAll(): Promise<boolean> {
    const results = await Promise.all(this.stepList.map((step) => step.validate()));
    return results.every(Boolean);
  }

  /** Валидирует текущий шаг (если включено) и переходит вперёд. */
  async next(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    const valid = this.validateOnStep ? await this.validateStep() : true;
    if (!valid) {
      return false;
    }
    if (!this.isLast) {
      this.currentIndex += 1;
    }
    return true;
  }

  back(): void {
    if (this.disposed || this.isFirst) {
      return;
    }
    this.currentIndex -= 1;
  }

  /**
   * Переход к шагу. При движении вперёд валидирует текущий шаг;
   * назад — без валидации.
   */
  async goTo(index: number): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    if (!Number.isInteger(index) || index < 0 || index >= this.stepList.length) {
      return false;
    }
    if (index > this.currentIndex && this.validateOnStep) {
      const valid = await this.validateStep();
      if (!valid) {
        return false;
      }
    }
    this.currentIndex = index;
    return true;
  }

  /** Значения шагов по строковым индексам. */
  values(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (let index = 0; index < this.stepList.length; index += 1) {
      result[String(index)] = this.stepList[index]!.values;
    }
    return result;
  }

  /** Wizard не владеет шагами: формы не освобождаются. */
  dispose(): void {
    this.disposed = true;
  }
}
