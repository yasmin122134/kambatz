export type BurdenHistogramBin = {
  label: string;
  min: number;
  max: number;
  count: number;
  names: string[];
  includesHighlight: boolean;
};

export type BurdenDistributionSummary = {
  bins: BurdenHistogramBin[];
  mean: number;
  median: number;
  maxCount: number;
  assignedCount: number;
  idleCount: number;
  binWidth: number;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatBinEdge(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round1((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return round1(sorted[mid]);
}

function autoBinWidth(min: number, max: number, count: number): number {
  const range = Math.max(max - min, 0.5);
  const targetBins = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(count))));
  const raw = range / targetBins;
  if (raw <= 1) return 0.5;
  if (raw <= 2) return 1;
  if (raw <= 5) return 2;
  return Math.ceil(raw / 5) * 5;
}

/** Histogram of justice-point burden across the roster. */
export function buildBurdenHistogram(
  roster: { personName: string; fairnessPoints: number }[],
  options?: { binWidth?: number; highlightName?: string },
): BurdenDistributionSummary {
  const highlightName = options?.highlightName;
  const assigned = roster.filter((r) => r.fairnessPoints > 0);
  const idleCount = roster.length - assigned.length;
  const values = assigned.map((r) => r.fairnessPoints);

  if (!values.length) {
    const idleNames = roster.filter((r) => r.fairnessPoints <= 0).map((r) => r.personName);
    return {
      bins:
        idleCount > 0
          ? [
              {
                label: "0",
                min: 0,
                max: 0,
                count: idleCount,
                names: idleNames,
                includesHighlight: highlightName
                  ? idleNames.includes(highlightName)
                  : false,
              },
            ]
          : [],
      mean: 0,
      median: 0,
      maxCount: idleCount,
      assignedCount: 0,
      idleCount,
      binWidth: 1,
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const binWidth = options?.binWidth ?? autoBinWidth(min, max, values.length);
  const start = Math.floor(min / binWidth) * binWidth;
  const end = Math.ceil(max / binWidth) * binWidth;

  const bins: BurdenHistogramBin[] = [];
  for (let edge = start; edge < end + binWidth * 0.001; edge += binWidth) {
    const binMin = round1(edge);
    const binMax = round1(edge + binWidth);
    const inBin = assigned.filter((r) => {
      const v = r.fairnessPoints;
      const isLast = binMax >= end - 0.001;
      return v >= binMin && (v < binMax - 0.001 || isLast);
    });
    if (binMax >= end && inBin.length === 0 && edge > start) continue;
    bins.push({
      label: `${formatBinEdge(binMin)}–${formatBinEdge(binMax)}`,
      min: binMin,
      max: binMax,
      count: inBin.length,
      names: inBin.map((r) => r.personName),
      includesHighlight: highlightName
        ? inBin.some((r) => r.personName === highlightName)
        : false,
    });
  }

  if (idleCount > 0) {
    bins.unshift({
      label: "0",
      min: 0,
      max: 0,
      count: idleCount,
      names: roster.filter((r) => r.fairnessPoints <= 0).map((r) => r.personName),
      includesHighlight: highlightName
        ? roster.some(
            (r) => r.personName === highlightName && r.fairnessPoints <= 0,
          )
        : false,
    });
  }

  const mean = round1(values.reduce((s, v) => s + v, 0) / values.length);
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0);

  return {
    bins,
    mean,
    median: median(values),
    maxCount,
    assignedCount: assigned.length,
    idleCount,
    binWidth,
  };
}
