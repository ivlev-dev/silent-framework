export const TITLE = "Hydration bench";
export const ROWS = 20;

export interface Row {
  readonly id: number;
  readonly label: string;
}

export function createRows(): readonly Row[] {
  return Array.from({ length: ROWS }, (_, id) => ({
    id,
    label: `Item ${String(id)}`,
  }));
}
