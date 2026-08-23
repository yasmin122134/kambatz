/** Mean absolute deviation from the mean — lower is more evenly spread. */
export function meanAbsoluteDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const mad = values.reduce((s, v) => s + Math.abs(v - mean), 0) / values.length;
  return Math.round(mad * 1000) / 1000;
}

export function spreadWithOverrides(
  baseBurdenByName: Map<string, number>,
  rosterNames: string[],
  overrides: Map<string, number>,
): number {
  const values = rosterNames.map(
    (name) => overrides.get(name) ?? baseBurdenByName.get(name) ?? 0,
  );
  return meanAbsoluteDeviation(values);
}
