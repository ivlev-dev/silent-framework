/**
 * Стек снапшотов HTML + позиции каретки. Ограничение ~100 шагов;
 * склейка ввода выполняется в компоненте (debounce 300 мс).
 */

export interface HistorySnapshot {
  readonly html: string;
  readonly start: number;
  readonly end: number;
}

export const HISTORY_LIMIT = 100;

export class RichTextHistory {
  #entries: HistorySnapshot[] = [];
  #index = -1;

  get index(): number {
    return this.#index;
  }

  get size(): number {
    return this.#entries.length;
  }

  get current(): HistorySnapshot | null {
    return this.#entries[this.#index] ?? null;
  }

  reset(snapshot: HistorySnapshot): void {
    this.#entries = [snapshot];
    this.#index = 0;
  }

  /**
   * Добавляет снапшот после текущего. Одинаковый HTML не дублируется:
   * смещение каретки без изменения контента не создаёт шаг истории.
   */
  push(snapshot: HistorySnapshot): boolean {
    const current = this.current;
    if (current !== null && current.html === snapshot.html) {
      return false;
    }
    if (this.#index < this.#entries.length - 1) {
      this.#entries = this.#entries.slice(0, this.#index + 1);
    }
    this.#entries.push(snapshot);
    if (this.#entries.length > HISTORY_LIMIT) {
      this.#entries.shift();
    }
    this.#index = this.#entries.length - 1;
    return true;
  }

  canUndo(): boolean {
    return this.#index > 0;
  }

  canRedo(): boolean {
    return this.#index >= 0 && this.#index < this.#entries.length - 1;
  }

  undo(): HistorySnapshot | null {
    if (!this.canUndo()) return null;
    this.#index -= 1;
    return this.current;
  }

  redo(): HistorySnapshot | null {
    if (!this.canRedo()) return null;
    this.#index += 1;
    return this.current;
  }
}
