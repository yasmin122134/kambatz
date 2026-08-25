import type { FairnessHourlyRates, FairnessRules } from "@/lib/types";
import {
  DEFAULT_FAIRNESS_HOURLY_RATES,
  DEFAULT_FAIRNESS_RULES,
} from "@/lib/types";

const NIGHT_START_MIN = 22 * 60;
const NIGHT_END_MIN = 6 * 60;

function wallTimelineSegments(
  startMin: number,
  durationMin: number,
): Array<{ start: number; end: number }> {
  if (durationMin <= 0) return [];
  const endMin = startMin + durationMin;
  if (endMin <= 1440) return [{ start: startMin, end: endMin }];
  return [
    { start: startMin, end: 1440 },
    { start: 0, end: endMin - 1440 },
  ];
}

function segmentOverlap(a0: number, a1: number, b0: number, b1: number): number {
  const start = Math.max(a0, b0);
  const end = Math.min(a1, b1);
  return Math.max(0, end - start);
}

/** Minutes of a shift that fall in 22:00–06:00. */
export function nightOverlapMinutes(startMin: number, durationMin: number): number {
  let total = 0;
  for (const seg of wallTimelineSegments(startMin, durationMin)) {
    total += segmentOverlap(seg.start, seg.end, NIGHT_START_MIN, 1440);
    total += segmentOverlap(seg.start, seg.end, 0, NIGHT_END_MIN);
  }
  return total;
}

export function resolveHourlyRates(rules?: FairnessRules): FairnessHourlyRates {
  const base = { ...DEFAULT_FAIRNESS_HOURLY_RATES };
  const src = rules?.hourly_rates;
  if (!src) {
    return {
      guard: rules?.solo ?? base.guard,
      guard_night: base.guard_night,
      observation: base.observation,
      base_work: rules?.duty ?? base.base_work,
      standby_a: rules?.standby_a ?? base.standby_a,
      standby_b: rules?.standby_b ?? base.standby_b,
      kitchen: rules?.kitchen ?? base.kitchen,
      reserve_force: base.reserve_force,
    };
  }
  return {
    guard: src.guard ?? base.guard,
    guard_night: src.guard_night ?? base.guard_night,
    observation: src.observation ?? base.observation,
    base_work: src.base_work ?? base.base_work,
    standby_a: src.standby_a ?? base.standby_a,
    standby_b: src.standby_b ?? base.standby_b,
    kitchen: src.kitchen ?? base.kitchen,
    reserve_force: src.reserve_force ?? base.reserve_force,
  };
}

export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}

export { DEFAULT_FAIRNESS_RULES };
