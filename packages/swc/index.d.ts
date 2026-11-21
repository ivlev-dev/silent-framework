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

export function scan(root: string, optionsJson: string): string;

export function scanFiles(
  root: string,
  filesJson: string,
  optionsJson: string,
): string;

export function version(): string;
