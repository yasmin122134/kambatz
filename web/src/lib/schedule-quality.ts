import {
  calculatePersonBurden,
  getRestHoursBetween,
  getRestPenalty,
  sortBlocksChronologically,
  type BurdenTimelineBlock,
} from "@/lib/guard-burden";
import { spreadWithOverrides } from "@/lib/fairness-spread";
import type { ScheduleTracker } from "@/lib/scheduling-engine";
import type { FairnessRules, Person } from "@/lib/types";

function activeRosterMembers(people: Person[]): Person[] {
  return people.filter((p) => p.active);
}

function rosterBurdenSpread(
  roster: Person[],
  tracker: ScheduleTracker,
  rules: FairnessRules,
  bucket: "duty" | "kitchen",
): number {
  const map = new Map<string, number>();
  for (const person of activeRosterMembers(roster)) {
    const key = bucket === "kitchen" ? "kitchenPoints" : "dutyPoints";
    const stored = tracker[key][person.name];
    if (stored != null) {
      map.set(person.name, stored);
    } else {
      map.set(person.name, calculatePersonBurden(tracker.busy[person.name] || [], rules)[
        bucket === "kitchen" ? "kitchenPoints" : "dutyPoints"
      ]);
    }
  }
  const names = activeRosterMembers(roster).map((p) => p.name);
  return spreadWithOverrides(map, names, new Map());
}

function rosterGuardCountSpread(roster: Person[], tracker: ScheduleTracker): number {
  const map = new Map<string, number>();
  for (const person of activeRosterMembers(roster)) {
    map.set(person.name, (tracker.guardShifts[person.name] || []).length);
  }
  const names = activeRosterMembers(roster).map((p) => p.name);
  return spreadWithOverrides(map, names, new Map());
}

export type RestViolationCounts = {
  /** Rest gaps strictly under 4 hours */
  severe: number;
  /** Rest gaps strictly under 6 hours (includes severe) */
  significant: number;
  /** Rest gaps strictly under 8 hours (includes significant) */
  underEightHours: number;
};

export type ScheduleQualityMetrics = {
  filledSeats: number;
  requiredSeats: number;
  isComplete: boolean;
  restViolations: RestViolationCounts;
  totalRestPenalty: number;
  maxBurden: number;
  minBurden: number;
  burdenSpread: number;
  burdenMad: number;
  guardCountSpread: number;
  kitchenSpread: number;
};

/** Lexicographic score — higher is better. */
export type ScheduleLexScore = number[];

function isRestRelevantBlock(block: BurdenTimelineBlock): boolean {
  return block.eatsRest;
}

export function countRestGapViolations(restHours: number): RestViolationCounts {
  return {
    severe: restHours < 4 ? 1 : 0,
    significant: restHours < 6 ? 1 : 0,
    underEightHours: restHours < 8 ? 1 : 0,
  };
}

export function mergeRestViolationCounts(
  a: RestViolationCounts,
  b: RestViolationCounts,
): RestViolationCounts {
  return {
    severe: a.severe + b.severe,
    significant: a.significant + b.significant,
    underEightHours: a.underEightHours + b.underEightHours,
  };
}

/** Count rest-gap violations between consecutive rest-consuming assignments for one person. */
export function restViolationsForBlocks(blocks: BurdenTimelineBlock[]): {
  violations: RestViolationCounts;
  totalPenalty: number;
} {
  const sorted = sortBlocksChronologically(blocks);
  const relevant = sorted.filter(isRestRelevantBlock);
  let violations: RestViolationCounts = { severe: 0, significant: 0, underEightHours: 0 };
  let totalPenalty = 0;

  for (let i = 1; i < relevant.length; i++) {
    const prev = relevant[i - 1];
    const next = relevant[i];
    const restHours = getRestHoursBetween(prev, next);
    violations = mergeRestViolationCounts(violations, countRestGapViolations(restHours));
    totalPenalty += getRestPenalty(restHours);
  }

  return { violations, totalPenalty };
}

export function totalBurdenForPerson(
  person: Person,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
): number {
  const breakdown = calculatePersonBurden(tracker.busy[person.name] || [], rules);
  const priorAdj = ((person.prior_score || 0) - meanPrior) * rules.hist;
  return Math.round((breakdown.dutyPoints + priorAdj) * 100) / 100;
}

export function computeScheduleQuality(input: {
  tracker: ScheduleTracker;
  people: Person[];
  rules: FairnessRules;
  meanPrior: number;
  filledSeats: number;
  requiredSeats: number;
}): ScheduleQualityMetrics {
  const roster = activeRosterMembers(input.people);
  let restViolations: RestViolationCounts = { severe: 0, significant: 0, underEightHours: 0 };
  let totalRestPenalty = 0;

  for (const person of roster) {
    const blocks = (input.tracker.busy[person.name] || []) as BurdenTimelineBlock[];
    const personRest = restViolationsForBlocks(blocks);
    restViolations = mergeRestViolationCounts(restViolations, personRest.violations);
    const breakdown = calculatePersonBurden(blocks, input.rules);
    totalRestPenalty += breakdown.restPenalties;
  }

  const burdens = roster.map((p) =>
    totalBurdenForPerson(p, input.tracker, input.rules, input.meanPrior),
  );
  const maxBurden = burdens.length ? Math.max(...burdens) : 0;
  const minBurden = burdens.length ? Math.min(...burdens) : 0;
  const burdenSpread = Math.round((maxBurden - minBurden) * 1000) / 1000;
  const burdenMad = rosterBurdenSpread(
    input.people,
    input.tracker,
    input.rules,
    "duty",
  );
  const guardCountSpread = rosterGuardCountSpread(input.people, input.tracker);
  const kitchenSpread = rosterBurdenSpread(
    input.people,
    input.tracker,
    input.rules,
    "kitchen",
  );

  return {
    filledSeats: input.filledSeats,
    requiredSeats: input.requiredSeats,
    isComplete: input.filledSeats >= input.requiredSeats && input.requiredSeats > 0,
    restViolations,
    totalRestPenalty: Math.round(totalRestPenalty * 100) / 100,
    maxBurden,
    minBurden,
    burdenSpread,
    burdenMad,
    guardCountSpread,
    kitchenSpread,
  };
}

export function scheduleLexScore(metrics: ScheduleQualityMetrics): ScheduleLexScore {
  return [
    metrics.filledSeats,
    metrics.isComplete ? 1 : 0,
    -metrics.restViolations.severe,
    -metrics.restViolations.significant,
    -Math.round(metrics.totalRestPenalty * 100),
    -Math.round(metrics.maxBurden * 100),
    -Math.round(metrics.burdenSpread * 1000),
    -Math.round(metrics.burdenMad * 1000),
    -Math.round(metrics.guardCountSpread * 1000),
  ];
}

export function lexBetter(a: ScheduleLexScore, b: ScheduleLexScore): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

export function formatScheduleQualitySummary(metrics: ScheduleQualityMetrics): string[] {
  const lines = [
    `כיסוי: ${metrics.filledSeats} / ${metrics.requiredSeats} משבצות`,
    `מנוחה: פחות מ-4 שעות: ${metrics.restViolations.severe}, 4–6 שעות: ${Math.max(0, metrics.restViolations.significant - metrics.restViolations.severe)}, סה״כ עונש מנוחה: ${metrics.totalRestPenalty}`,
    `הוגנות: עומס מקס׳ ${metrics.maxBurden}, מינ׳ ${metrics.minBurden}, פער ${metrics.burdenSpread}, MAD ${metrics.burdenMad}`,
  ];
  if (metrics.guardCountSpread > 0) {
    lines.push(`פיזור שמירות (MAD): ${metrics.guardCountSpread}`);
  }
  return lines;
}
