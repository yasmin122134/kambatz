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
  MissionPositionKind,
  MissionSchedulingRules,
  MissionType,
} from "@/lib/types";

/** Standard 4-hour wall-clock bands — higher = harder shift */
export const GUARD_TIME_BANDS = [
  { startMin: 0, endMin: 240, paired: 7, solo: 10 }, // 00:00–04:00
  { startMin: 240, endMin: 480, paired: 6, solo: 9 }, // 04:00–08:00
  { startMin: 480, endMin: 720, paired: 1, solo: 4 }, // 08:00–12:00
  { startMin: 720, endMin: 960, paired: 6, solo: 9 }, // 12:00–16:00
  { startMin: 960, endMin: 1200, paired: 3, solo: 6 }, // 16:00–20:00
  { startMin: 1200, endMin: 1440, paired: 4, solo: 7 }, // 20:00–00:00
] as const;

const BAND_WIDTH_MIN = 240; // 4 hours

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
  otherMissionPoints: number;
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

/** Score for a full 4-hour band (solo vs paired). */
export function getGuardTimeBandScore(
  bandIndex: number,
  isSolo: boolean,
): number {
  const band = GUARD_TIME_BANDS[bandIndex];
  if (!band) return 0;
  return isSolo ? band.solo : band.paired;
}

/**
 * Proportional time-of-day burden for a guard slot.
 * Full 4h in one band → exact table score; partial → (overlap/240) × band score.
 */
export function getGuardBaseBurden(
  startTime: string,
  endTime: string,
  seatCount: number,
): number {
  const startMin = parseTimeMinutes(startTime);
  if (startMin === null) return 0;
  const durationMin = slotDurationMinutes(startTime, endTime);
  if (durationMin <= 0) return 0;

  const isSolo = seatCount <= 1;
  let total = 0;
  for (const band of GUARD_TIME_BANDS) {
    const overlap = overlapSlotWithBand(startMin, durationMin, band.startMin, band.endMin);
    if (overlap <= 0) continue;
    const bandScore = isSolo ? band.solo : band.paired;
    total += (overlap / BAND_WIDTH_MIN) * bandScore;
  }
  return Math.round(total * 100) / 100;
}

export function getGuardBaseBurdenForSlot(slot: FlatSlot, seatCount?: number): number {
  return getGuardBaseBurden(slot.startTime, slot.endTime, seatCount ?? slot.seatCount);
}

/** Rest penalty from hours of rest between assignments (fairness metric, not hard constraint). */
export function getRestPenalty(restHours: number): number {
  if (restHours >= 16) return 0;
  if (restHours >= 12) return 1;
  if (restHours >= 10) return 2;
  if (restHours >= 8) return 3;
  if (restHours >= 7) return 4;
  if (restHours >= 6) return 5;
  if (restHours >= 5) return 7;
  if (restHours >= 4) return 9;
  return 12;
}

/** Wall-clock rest hours between end of `prev` and start of `next`. */
export function getRestHoursBetween(
  prev: BurdenTimelineBlock,
  next: BurdenTimelineBlock,
): number {
  const gapMin = absoluteStart(next) - absoluteEnd(prev);
  if (gapMin < 0) return 0;
  return Math.round((gapMin / 60) * 100) / 100;
}

/** Blocks that anchor rest gaps — excludes Carmel standby (does not eat rest). */
export function isRestRelevantBlock(block: BurdenTimelineBlock): boolean {
  return block.eatsRest || isGuardKind(block.positionKind);
}

function legacyPointsForBlock(
  block: BurdenTimelineBlock,
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
): number {
  if (block.positionKind === "standby_carmel_a") {
    const h = slotDurationHours(block.startTime, block.endTime);
    return pointsForHours(h, "standby_a", rules);
  }
  if (block.positionKind === "standby_carmel_b") {
    const h = slotDurationHours(block.startTime, block.endTime);
    return pointsForHours(h, "standby_b", rules);
  }
  if (isStandbyKind(block.positionKind)) {
    const h = slotDurationHours(block.startTime, block.endTime);
    return pointsForHours(h, "standby", rules);
  }
  if (block.positionKind === "kitchen" || block.missionType === "kitchen") {
    const perShift = scheduling?.kitchen?.points_per_shift !== false;
    return pointsForHours(0, "kitchen", rules, { perShift });
  }
  if (block.positionKind === "duty" || block.positionKind === "officer_duty") {
    if (isGuardKind(block.positionKind)) return 0; // guard burden model handles officer
    const h = slotDurationHours(block.startTime, block.endTime);
    return pointsForHours(h, "duty", rules);
  }
  if (block.missionType === "base_work") {
    const h = slotDurationHours(block.startTime, block.endTime);
    return pointsForHours(h, "duty", rules);
  }
  return 0;
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
): { penalty: number; restHours: number | null } {
  if (!prev) return { penalty: 0, restHours: null };
  const restHours = getRestHoursBetween(prev, guard);
  return { penalty: getRestPenalty(restHours), restHours };
}

/** Full burden for one guard assignment (base + rest-before only — no double counting). */
export function calculateGuardAssignmentBurden(
  guard: BurdenTimelineBlock,
  prevRelevant: BurdenTimelineBlock | null,
): GuardAssignmentBurdenDetail {
  const baseBurden = getGuardBaseBurden(guard.startTime, guard.endTime, guard.seatCount);
  const { penalty, restHours } = restPenaltyBeforeGuard(guard, prevRelevant);
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
): number {
  const relevant = sortBlocksChronologically(existingBlocks.filter(isRestRelevantBlock));
  const prev = findPreviousRelevant(relevant, candidateGuard);
  const before = restPenaltyBeforeGuard(candidateGuard, prev).penalty;

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
    after = getRestPenalty(getRestHoursBetween(candidateGuard, next));
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
  let guardAssignmentCount = 0;
  const guardDetails: GuardAssignmentBurdenDetail[] = [];

  for (const block of sorted) {
    if (isGuardKind(block.positionKind)) {
      guardAssignmentCount += 1;
      const prev = findPreviousRelevant(relevant, block);
      const detail = calculateGuardAssignmentBurden(block, prev);
      guardBaseBurden += detail.baseBurden;
      restPenalties += detail.restPenaltyBefore;
      guardDetails.push(detail);
    } else {
      otherMissionPoints += legacyPointsForBlock(block, rules, scheduling);
    }
  }

  const totalBurden =
    Math.round((guardBaseBurden + restPenalties + otherMissionPoints) * 100) / 100;

  return {
    guardBaseBurden: Math.round(guardBaseBurden * 100) / 100,
    restPenalties: Math.round(restPenalties * 100) / 100,
    otherMissionPoints: Math.round(otherMissionPoints * 100) / 100,
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
  const newBlock = blockFromFlatSlot(slot, slot.missionType, seatCount);
  const combined = [...existingBlocks, newBlock];
  return calculatePersonBurden(combined, rules, scheduling).totalBurden;
}

/** Slot difficulty for guard auto-assign ordering (higher = fill first). */
export function guardSlotDifficultyRank(
  slot: FlatSlot,
  eligibleCount: number,
): number {
  const base = getGuardBaseBurdenForSlot(slot);
  const soloBonus = slot.seatCount <= 1 ? 20 : 0;
  const scarcity = eligibleCount <= 0 ? 1000 : 100 / (eligibleCount + 1);
  return base * 100 + soloBonus + scarcity + slot.seatCount * 5;
}
