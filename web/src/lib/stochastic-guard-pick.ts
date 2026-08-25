import { isGuardKind } from "@/lib/mission-utils";
import { type ScheduleTracker } from "@/lib/scheduling-engine";
import { pickRandomIndex } from "@/lib/seeded-random";
import type { FairnessRules, MissionSchedulingRules, Person } from "@/lib/types";
import type { FlatSlot } from "@/lib/mission-utils";

/** Guard seats: pick randomly among top fairly-ranked candidates. */
export const GUARD_STOCHASTIC_TOP_K = 5;

export type GuardCandidateContext = {
  slot: FlatSlot;
  roster: Person[];
  tracker: ScheduleTracker;
  rules: FairnessRules;
  meanPrior: number;
  scheduling?: MissionSchedulingRules;
  seatCount?: number;
  rng: () => number;
};

/** Candidates must already be sorted by fairness (best first). */
export function pickStochasticGuardCandidate<T extends Person>(
  sortedCandidates: T[],
  ctx: GuardCandidateContext,
): T | null {
  if (!sortedCandidates.length) return null;
  if (!isGuardKind(ctx.slot.positionKind)) return sortedCandidates[0];
  const pool = sortedCandidates.slice(
    0,
    Math.min(GUARD_STOCHASTIC_TOP_K, sortedCandidates.length),
  );
  return pool[pickRandomIndex(ctx.rng, pool.length)] ?? sortedCandidates[0];
}

/** Pairs must already be sorted by fairness spread (best first). */
export function pickStochasticGuardPair<T extends Person[]>(
  sortedPairs: T[],
  ctx: GuardCandidateContext,
): T | null {
  if (!sortedPairs.length) return null;
  if (!isGuardKind(ctx.slot.positionKind)) return sortedPairs[0];
  const pool = sortedPairs.slice(0, Math.min(GUARD_STOCHASTIC_TOP_K, sortedPairs.length));
  return pool[pickRandomIndex(ctx.rng, pool.length)] ?? sortedPairs[0];
}
