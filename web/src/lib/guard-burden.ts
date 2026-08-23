import { pointsForHours, slotDurationHours } from "@/lib/fairness-math";
import {
  type FlatSlot,
  isGuardKind,
  isStandbyKind,
  parseTimeMinutes,
  slotDurationMinutes,
  slotEatsRest,
} from "@/lib/mission-utils";
import type {
  FairnessRules,
  GuardBandRule,
  MissionPositionKind,
  MissionSchedulingRules,
  MissionType,
} from "@/lib/types";
import {
  DEFAULT_FAIRNESS_RULES,
  DEFAULT_GUARD_BANDS,
  DEFAULT_REST_PENALTIES,
} from "@/lib/types";

/** Standard 4-hour wall-clock band ranges (scores live in FairnessRules.guard_bands). */
export const GUARD_BAND_TIME_RANGES = [
  { startMin: 0, endMin: 240 }, // 00:00–04:00
  { startMin: 240, endMin: 480 }, // 04:00–08:00
  { startMin: 480, endMin: 720 }, // 08:00–12:00
  { startMin: 720, endMin: 960 }, // 12:00–16:00
  { startMin: 960, endMin: 1200 }, // 16:00–20:00
  { startMin: 1200, endMin: 1440 }, // 20:00–00:00
] as const;

/** @deprecated use GUARD_BAND_TIME_RANGES — kept for imports that expect band objects */
export const GUARD_TIME_BANDS = GUARD_BAND_TIME_RANGES;

const BAND_WIDTH_MIN = 240; // 4 hours
const BAND_WIDTH_HOURS = BAND_WIDTH_MIN / 60;

export function resolveGuardBands(rules?: FairnessRules): GuardBandRule[] {
  return rules?.guard_bands?.length === GUARD_BAND_TIME_RANGES.length
    ? rules.guard_bands
    : DEFAULT_GUARD_BANDS;
}

export function resolveGuardHoursFactor(rules?: FairnessRules): number {
  const factor = rules?.guard_hours_factor;
  return factor != null && factor >= 0 ? factor : DEFAULT_FAIRNESS_RULES.guard_hours_factor;
}

export function resolveRestPenalties(rules?: FairnessRules): number[] {
  return rules?.rest_penalties?.length === DEFAULT_REST_PENALTIES.length
    ? rules.rest_penalties
    : [...DEFAULT_REST_PENALTIES];
}

/** Points per hour for a band row (includes guard_hours_factor). */
export function guardBandPointsPerHour(
  bandScore: number,
  hoursFactor = DEFAULT_FAIRNESS_RULES.guard_hours_factor,
): number {
  return (bandScore / BAND_WIDTH_HOURS) * hoursFactor;
}

/** Points for a full 4h band at the standard rate (for display). */
export function guardBandScoreForFullBlock(
  bandScore: number,
  hoursFactor = DEFAULT_FAIRNESS_RULES.guard_hours_factor,
): number {
  return Math.round(guardBandPointsPerHour(bandScore, hoursFactor) * BAND_WIDTH_HOURS * 100) / 100;
}

export type BurdenTimelineBlock = {
  wallStartMin: number;
  calendarDayOffset: number;
  durationMinutes: number;
  eatsRest: boolean;
  positionKind: MissionPositionKind;
  missionType: MissionType;
  seatCount: number;
  startTime: string;
  endTime: string;
  slotId?: string;
};

export type GuardAssignmentBurdenDetail = {
  slotId?: string;
  timeLabel: string;
  seatCount: number;
  isSolo: boolean;
  baseBurden: number;
  restPenaltyBefore: number;
  restHoursBefore: number | null;
  totalContribution: number;
};

export type PersonBurdenBreakdown = {
  guardBaseBurden: number;
  restPenalties: number;
  /** Non-guard, non-kitchen missions (עב״ס, כוננות, וכו׳) */
  otherMissionPoints: number;
  /** Kitchen-only points for the day */
  kitchenPoints: number;
  /** Guard + rest + עב״ס/כוננות — excludes kitchen */
  dutyPoints: number;
  guardAssignmentCount: number;
  totalBurden: number;
  guardDetails: GuardAssignmentBurdenDetail[];
};

function absoluteStart(block: BurdenTimelineBlock): number {
  return block.calendarDayOffset * 1440 + block.wallStartMin;
}

function absoluteEnd(block: BurdenTimelineBlock): number {
  return absoluteStart(block) + block.durationMinutes;
}

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

/** Overlap minutes between a wall-clock slot and a standard band (handles midnight wrap). */
export function overlapSlotWithBand(
  slotStartMin: number,
  slotDurationMin: number,
  bandStartMin: number,
  bandEndMin: number,
): number {
  let total = 0;
  for (const seg of wallTimelineSegments(slotStartMin, slotDurationMin)) {
    total += segmentOverlap(seg.start, seg.end, bandStartMin, bandEndMin);
  }
  return total;
}

/** Score for a full 4-hour band (solo vs paired), including the hours factor. */
export function getGuardTimeBandScore(
  bandIndex: number,
  isSolo: boolean,
  rules?: FairnessRules,
): number {
  const bands = resolveGuardBands(rules);
  const band = bands[bandIndex];
  if (!band) return 0;
  const bandScore = isSolo ? band.solo : band.paired;
  return guardBandScoreForFullBlock(bandScore, resolveGuardHoursFactor(rules));
}

/**
 * Time-of-day guard burden — proportional to shift length (like כרמל / עב״ס):
 * guard_hours_factor × שעות × (ציון רצועת 4ש׳ ÷ 4).
 */
export function getGuardBaseBurden(
  startTime: string,
  endTime: string,
  seatCount: number,
  rules?: FairnessRules,
): number {
  const startMin = parseTimeMinutes(startTime);
  if (startMin === null) return 0;
  const durationMin = slotDurationMinutes(startTime, endTime);
  if (durationMin <= 0) return 0;

  const bands = resolveGuardBands(rules);
  const hoursFactor = resolveGuardHoursFactor(rules);
  const isSolo = seatCount <= 1;
  let total = 0;
  for (let i = 0; i < GUARD_BAND_TIME_RANGES.length; i++) {
    const range = GUARD_BAND_TIME_RANGES[i];
    const band = bands[i];
    if (!band) continue;
    const overlap = overlapSlotWithBand(startMin, durationMin, range.startMin, range.endMin);
    if (overlap <= 0) continue;
    const overlapHours = overlap / 60;
    const bandScore = isSolo ? band.solo : band.paired;
    total += overlapHours * guardBandPointsPerHour(bandScore, hoursFactor);
  }
  return Math.round(total * 100) / 100;
}

export function getGuardBaseBurdenForSlot(
  slot: FlatSlot,
  seatCount?: number,
  rules?: FairnessRules,
): number {
  return getGuardBaseBurden(
    slot.startTime,
    slot.endTime,
    seatCount ?? slot.seatCount,
    rules,
  );
}

/** Rest penalty from hours of rest between assignments (fairness metric, not hard constraint). */
export function getRestPenalty(restHours: number, rules?: FairnessRules): number {
  const penalties = resolveRestPenalties(rules);
  if (restHours >= 16) return penalties[0];
  if (restHours >= 12) return penalties[1];
  if (restHours >= 10) return penalties[2];
  if (restHours >= 8) return penalties[3];
  if (restHours >= 7) return penalties[4];
  if (restHours >= 6) return penalties[5];
  if (restHours >= 5) return penalties[6];
  if (restHours >= 4) return penalties[7];
  return penalties[8];
}

/** Tiers shown on the fairness page — mirrors getRestPenalty(). */
export const REST_PENALTY_TIERS = [
  { restHoursLabel: "16 שעות ומעלה", penalty: 0, index: 0 },
  { restHoursLabel: "12–16 שעות", penalty: 1, index: 1 },
  { restHoursLabel: "10–12 שעות", penalty: 2, index: 2 },
  { restHoursLabel: "8–10 שעות", penalty: 3, index: 3 },
  { restHoursLabel: "7–8 שעות", penalty: 4, index: 4 },
  { restHoursLabel: "6–7 שעות", penalty: 5, index: 5 },
  { restHoursLabel: "5–6 שעות", penalty: 7, index: 6 },
  { restHoursLabel: "4–5 שעות", penalty: 9, index: 7 },
  { restHoursLabel: "פחות מ-4 שעות", penalty: 12, index: 8 },
] as const;

export function restPenaltyTiersFromRules(rules: FairnessRules) {
  const penalties = resolveRestPenalties(rules);
  return REST_PENALTY_TIERS.map((tier) => ({
    restHoursLabel: tier.restHoursLabel,
    penalty: penalties[tier.index],
    index: tier.index,
  }));
}

export const GUARD_TIME_BAND_LABELS = [
  "00:00–04:00",
  "04:00–08:00",
  "08:00–12:00",
  "12:00–16:00",
  "16:00–20:00",
  "20:00–00:00",
] as const;

export const GUARD_TIME_BAND_HELP = [
  "לילה מאוחר — הכי קשה",
  "לפנות בוקר",
  "בוקר — הקלה יחסית",
  "צהריים",
  "אחר הצהריים",
  "ערב",
] as const;

function isRestRelevantBlock(block: BurdenTimelineBlock): boolean {
  return block.eatsRest;
}

function isKitchenBlock(block: BurdenTimelineBlock): boolean {
  return block.positionKind === "kitchen" || block.missionType === "kitchen";
}

function legacyPointsForBlock(
  block: BurdenTimelineBlock,
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
): number {
  const hours = slotDurationHours(block.startTime, block.endTime);
  if (isKitchenBlock(block)) {
    const perShift =
      scheduling?.kitchen?.points_per_shift !== false &&
      block.missionType === "kitchen";
    return pointsForHours(hours, "kitchen", rules, { perShift });
  }
  if (block.positionKind === "duty" || block.missionType === "base_work") {
    return pointsForHours(hours, "duty", rules);
  }
  if (block.positionKind === "standby_carmel_a") {
    return pointsForHours(hours, "standby_a", rules);
  }
  if (block.positionKind === "standby_carmel_b") {
    return pointsForHours(hours, "standby_b", rules);
  }
  if (isStandbyKind(block.positionKind)) {
    return pointsForHours(hours, "standby", rules);
  }
  return 0;
}

export function getRestHoursBetween(
  earlier: BurdenTimelineBlock,
  later: BurdenTimelineBlock,
): number {
  const gapMin = absoluteStart(later) - absoluteEnd(earlier);
  return Math.max(0, gapMin / 60);
}

export function sortBlocksChronologically(
  blocks: BurdenTimelineBlock[],
): BurdenTimelineBlock[] {
  return [...blocks].sort(
    (a, b) => absoluteStart(a) - absoluteStart(b) || absoluteEnd(a) - absoluteEnd(b),
  );
}

export function findPreviousRelevantBlock(
  sorted: BurdenTimelineBlock[],
  target: BurdenTimelineBlock,
): BurdenTimelineBlock | null {
  const targetStart = absoluteStart(target);
  let prev: BurdenTimelineBlock | null = null;
  for (const block of sorted) {
    if (!isRestRelevantBlock(block)) continue;
    const end = absoluteEnd(block);
    if (end <= targetStart && block !== target) {
      if (!prev || absoluteEnd(prev) <= end) prev = block;
    }
  }
  return prev;
}

function findPreviousRelevant(
  sorted: BurdenTimelineBlock[],
  target: BurdenTimelineBlock,
): BurdenTimelineBlock | null {
  return findPreviousRelevantBlock(sorted, target);
}

/** Rest penalty attributed to a guard when placed after `prev` (gap counted once). */
export function restPenaltyBeforeGuard(
  guard: BurdenTimelineBlock,
  prev: BurdenTimelineBlock | null,
  rules?: FairnessRules,
): { penalty: number; restHours: number | null } {
  if (!prev) return { penalty: 0, restHours: null };
  const restHours = getRestHoursBetween(prev, guard);
  return { penalty: getRestPenalty(restHours, rules), restHours };
}

/** Full burden for one guard assignment (base + rest-before only — no double counting). */
export function calculateGuardAssignmentBurden(
  guard: BurdenTimelineBlock,
  prevRelevant: BurdenTimelineBlock | null,
  rules?: FairnessRules,
): GuardAssignmentBurdenDetail {
  const baseBurden = getGuardBaseBurden(
    guard.startTime,
    guard.endTime,
    guard.seatCount,
    rules,
  );
  const { penalty, restHours } = restPenaltyBeforeGuard(guard, prevRelevant, rules);
  return {
    slotId: guard.slotId,
    timeLabel: `${guard.startTime}–${guard.endTime}`,
    seatCount: guard.seatCount,
    isSolo: guard.seatCount <= 1,
    baseBurden,
    restPenaltyBefore: penalty,
    restHoursBefore: restHours,
    totalContribution: Math.round((baseBurden + penalty) * 100) / 100,
  };
}

/** Projected rest penalties when placing a new guard (before + after, for candidate comparison). */
export function projectedRestPenaltiesForCandidate(
  candidateGuard: BurdenTimelineBlock,
  existingBlocks: BurdenTimelineBlock[],
  rules?: FairnessRules,
): number {
  const relevant = sortBlocksChronologically(existingBlocks.filter(isRestRelevantBlock));
  const prev = findPreviousRelevant(relevant, candidateGuard);
  const before = restPenaltyBeforeGuard(candidateGuard, prev, rules).penalty;

  const candidateStart = absoluteStart(candidateGuard);
  const candidateEnd = absoluteEnd(candidateGuard);
  let next: BurdenTimelineBlock | null = null;
  for (const block of relevant) {
    const start = absoluteStart(block);
    if (start >= candidateEnd) {
      if (!next || start < absoluteStart(next)) next = block;
    }
  }

  let after = 0;
  if (next) {
    after = getRestPenalty(getRestHoursBetween(candidateGuard, next), rules);
  }

  return before + after;
}

/** Total burden from a person's assignment history (single canonical interpretation). */
export function calculatePersonBurden(
  blocks: BurdenTimelineBlock[],
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
): PersonBurdenBreakdown {
  const sorted = sortBlocksChronologically(blocks);
  const relevant = sorted.filter(isRestRelevantBlock);

  let guardBaseBurden = 0;
  let restPenalties = 0;
  let otherMissionPoints = 0;
  let kitchenPoints = 0;
  let guardAssignmentCount = 0;
  const guardDetails: GuardAssignmentBurdenDetail[] = [];

  for (const block of sorted) {
    if (isGuardKind(block.positionKind)) {
      guardAssignmentCount += 1;
      const prev = findPreviousRelevant(relevant, block);
      const detail = calculateGuardAssignmentBurden(block, prev, rules);
      guardBaseBurden += detail.baseBurden;
      restPenalties += detail.restPenaltyBefore;
      guardDetails.push(detail);
    } else if (isKitchenBlock(block)) {
      kitchenPoints += legacyPointsForBlock(block, rules, scheduling);
    } else {
      otherMissionPoints += legacyPointsForBlock(block, rules, scheduling);
    }
  }

  const dutyPoints =
    Math.round((guardBaseBurden + restPenalties + otherMissionPoints) * 100) / 100;
  const totalBurden = Math.round((dutyPoints + kitchenPoints) * 100) / 100;

  return {
    guardBaseBurden: Math.round(guardBaseBurden * 100) / 100,
    restPenalties: Math.round(restPenalties * 100) / 100,
    otherMissionPoints: Math.round(otherMissionPoints * 100) / 100,
    kitchenPoints: Math.round(kitchenPoints * 100) / 100,
    dutyPoints,
    guardAssignmentCount,
    totalBurden,
    guardDetails,
  };
}

export function blockFromFlatSlot(
  slot: FlatSlot,
  missionType: MissionType,
  seatCount?: number,
): BurdenTimelineBlock {
  return {
    wallStartMin: slot.wallStartMin,
    calendarDayOffset: slot.calendarDayOffset,
    durationMinutes: slot.durationMinutes,
    eatsRest: slotEatsRest(slot),
    positionKind: slot.positionKind,
    missionType,
    seatCount: seatCount ?? slot.seatCount,
    startTime: slot.startTime,
    endTime: slot.endTime,
    slotId: slot.slotId,
  };
}

export function calculateProjectedCandidateBurden(
  personName: string,
  slot: FlatSlot,
  existingBlocks: BurdenTimelineBlock[],
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
  seatCount?: number,
): number {
  void personName;
  const newBlock = blockFromFlatSlot(slot, slot.missionType, seatCount);
  const combined = [...existingBlocks, newBlock];
  return calculatePersonBurden(combined, rules, scheduling).dutyPoints;
}

export function calculateProjectedKitchenBurden(
  personName: string,
  slot: FlatSlot,
  existingBlocks: BurdenTimelineBlock[],
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
  seatCount?: number,
): number {
  void personName;
  const newBlock = blockFromFlatSlot(slot, slot.missionType, seatCount);
  const combined = [...existingBlocks, newBlock];
  return calculatePersonBurden(combined, rules, scheduling).kitchenPoints;
}

/** Slot difficulty for guard auto-assign ordering (higher = fill first). */
export function guardSlotDifficultyRank(
  slot: FlatSlot,
  eligibleCount: number,
  rules?: FairnessRules,
): number {
  const base = getGuardBaseBurdenForSlot(slot, undefined, rules);
  const soloBonus = slot.seatCount <= 1 ? 20 : 0;
  const scarcity = eligibleCount <= 0 ? 1000 : 100 / (eligibleCount + 1);
  return base * 100 + soloBonus + scarcity + slot.seatCount * 5;
}
