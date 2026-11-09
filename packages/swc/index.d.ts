export interface NativeTransformResult {
  code: string;
  map: string | null;
  diagnostics: string[];
}

export function transform(
  source: string,
  filename: string,
  optionsJson: string,
  indexJson: string,
): string;

export function scan(root: string): string;

export function version(): string;
