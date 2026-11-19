// Reading whole numbers from command-line options: digits only, so "", "1.5", "0x10" and "abc" are refused rather than
// silently turned into 0, 1, 16 or NaN.

export function wholeNumber(value: string | undefined, fallback: number, option: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error(`--${option} is a whole number, 0 or more`);
  return Number(value);
}
