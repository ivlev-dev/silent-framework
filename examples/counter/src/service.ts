export interface CounterService {
  log(message: string): void;
  timestamp(): string;
}

export class ConsoleCounterService implements CounterService {
  log(message: string): void {
    console.log(`[counter] ${message}`);
  }

  timestamp(): string {
    return new Date().toISOString();
  }
}
