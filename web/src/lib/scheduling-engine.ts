import { slotDurationHours } from "@/lib/fairness-math";
import { resolveHourlyRates } from "@/lib/fairness-hourly-rates";
import { spreadWithOverrides } from "@/lib/fairness-spread";
import { mulberry32 } from "@/lib/seeded-random";
import { pickStochasticGuardCandidate } from "@/lib/stochastic-guard-pick";
import {
  blockFromFlatSlot,
  calculatePersonBurden,
  calculateProjectedCandidateBurden,
  calculateProjectedKitchenBurden,
  getGuardBaseBurdenForSlot,
  guardSlotDifficultyRank,
  toranutPointsForMissionBlock,
  type BurdenTimelineBlock,
  type PersonBurdenBreakdown,
} from "@/lib/guard-burden";
import {
  type FlatSlot,
  coverageFillRank,
  coverageFillTier,
  slotEatsRest,
  flattenMissionSlots,
  isBaseWorkAssignment,
  isGuardKind,
  isHamagshiyotAssignment,
  isKitchenMissionSlot,
  isRestConstrainedGuardKind,
  isObservationPost,
  isReserveForceBlock,
  isReserveForcePositionName,
  isStandbyKind,
  normalizeSchedulingRules,
  resolveMissionForSlot,
  slotUsesWallClockSchedule,
} from "@/lib/mission-utils";
import { isHamagshiyotPositionName } from "@/lib/hamagshiyot-template";
import {
  hasExplicitKitchenOutLists,
  resolveKitchenOutNames,
} from "@/lib/kitchen-out-lists";
import { patrolAssigneeRole } from "@/lib/patrol-day-template";
import { isDutyOfficerName, personIsDutyOfficer } from "@/lib/officers";
import { isSeatLocked } from "@/lib/assignment-lock";
import { apportionSeats, groupPeopleBySquad } from "@/lib/squad-utils";
import {
  intervalsOverlap,
  parseTimeMinutes,
  slotDurationMinutes,
  type TimeInterval,
} from "@/lib/time-interval";
import {
  guardAbasRestOk,
  toMissionTimelineInterval,
} from "@/lib/mission-timeline";
import { issueAbsoluteInterval } from "@/lib/issue-interval";
import {
  clampBaseWorkSeatsPerShift,
  DEFAULT_BASE_WORK_SCHEDULING_RULES,
  DEFAULT_FAIRNESS_RULES,
  DEFAULT_MISSION_SCHEDULING_RULES,
  type FairnessRules,
  type Issue,
  type MissionDay,
  type MissionPositionKind,
  type MissionSchedulingRules,
  type MissionType,
  type Person,
} from "@/lib/types";

/** Neutral weights for overlap/rest validation — not used for ranking. */
const VALIDATION_FAIRNESS_RULES: FairnessRules = {
  ...DEFAULT_FAIRNESS_RULES,
  solo: 1,
  pair: 1,
  standby: 1,
  standby_a: 1,
  standby_b: 1,
  duty: 1,
  kitchen: 1,
  hist: 0,
};

type BusyBlock = BurdenTimelineBlock & {
  cyclicStart: number;
  slotId: string;
  missionId: string;
  startAtMs: number;
  endAtMs: number;
  positionName?: string;
};

type AssignmentOverlapMeta = {
  positionName?: string;
  startTime?: string;
  endTime?: string;
};

export { isBaseWorkAssignment } from "@/lib/mission-utils";

function busyToBurdenBlocks(blocks: BusyBlock[]): BurdenTimelineBlock[] {
  return blocks;
}

function syncPersonPeriodPoints(
  personName: string,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
) {
  const blocks = tracker.busy[personName] || [];
  const breakdown = calculatePersonBurden(blocks, rules, scheduling);
  tracker.periodPoints[personName] = breakdown.totalBurden;
  tracker.kitchenPoints[personName] = breakdown.kitchenPoints;
  tracker.dutyPoints[personName] = breakdown.dutyPoints;
}

export type FairnessBurdenBucket = "kitchen" | "duty";

export function fairnessBurdenBucketForSlot(slot: FlatSlot): FairnessBurdenBucket {
  if (slot.positionKind === "patrol") return "duty";
  if (
    slot.positionKind === "kitchen" &&
    slot.missionType === "guards" &&
    isHamagshiyotPositionName(slot.positionName)
  ) {
    return "kitchen";
  }
  if (slot.positionKind === "kitchen" || slot.missionType === "kitchen") return "kitchen";
  return "duty";
}

/** How hard rest / ABAS-gap rules are while searching for a roster. */
export type AssignConstraintPolicy = "standard" | "strict_rest" | "relaxed_rest" | "coverage";

export type ScheduleTracker = {
  busy: Record<string, BusyBlock[]>;
  guardShifts: Record<string, { start: number; duration: number }[]>;
  /** Total day points (duty + kitchen) — kept for compatibility */
  periodPoints: Record<string, number>;
  kitchenPoints: Record<string, number>;
  dutyPoints: Record<string, number>;
  /**
   * standard — current smart assign (4–8 ratio, daily rest, ABAS gap).
   * strict_rest — rest_hours idle between guards and between ABAS↔guard.
   * relaxed_rest — last-resort: skip rest_hours idle / daily rest, keep ABAS minute-gap.
   * coverage — unused in strict assign; skip rest_hours, ABAS gap, daily rest, room/gender.
   */
  constraintPolicy?: AssignConstraintPolicy;
};

export function createEmptyScheduleTracker(
  constraintPolicy: AssignConstraintPolicy = "standard",
): ScheduleTracker {
  return {
    busy: {},
    guardShifts: {},
    periodPoints: {},
    kitchenPoints: {},
    dutyPoints: {},
    constraintPolicy,
  };
}

export function trackerConstraintPolicy(
  tracker?: Pick<ScheduleTracker, "constraintPolicy"> | null,
): AssignConstraintPolicy {
  return tracker?.constraintPolicy ?? "standard";
}

export type ReplacementOption = {
  type: "direct" | "swap";
  personName: string;
  cost: number;
  label: string;
  swapMissionId?: string;
  swapSlotId?: string;
  swapSeatIndex?: number;
  swapLabel?: string;
  /** כשההחלפה לא עומדת בכללים — מוצגת ברשימה עם אישור לפני ביצוע */
  ruleViolation?: string;
};

function cyclicOverlap(p1: number, d1: number, p2: number, d2: number): boolean {
  const x = ((p2 - p1) % 1440 + 1440) % 1440;
  return x < d1 || 1440 - x < d2;
}

function cyclicGap(p1: number, d1: number, p2: number): number {
  return ((p2 - (p1 + d1)) % 1440 + 1440) % 1440;
}

function wallSegments(start: number, dur: number): [number, number][] {
  if (dur >= 1440) return [[0, 1440]];
  const end = start + dur;
  if (end <= 1440) return [[start, end]];
  return [
    [start, 1440],
    [0, end - 1440],
  ];
}

function segmentsConflictWithGap(
  segsA: [number, number][],
  segsB: [number, number][],
  gapMin: number,
): boolean {
  for (const [a0, a1] of segsA) {
    for (const [b0, b1] of segsB) {
      const aStart = a0 - gapMin;
      const aEnd = a1 + gapMin;
      if (aStart < b1 && b0 < aEnd) return true;
    }
  }
  return false;
}

function needsDutyGuardGap(
  kindA: MissionPositionKind,
  typeA: MissionType,
  kindB: MissionPositionKind,
  typeB: MissionType,
  metaA?: AssignmentOverlapMeta,
  metaB?: AssignmentOverlapMeta,
): boolean {
  // Reserve force (guards + duty) does not require spacing from guard shifts — only עב״ס does.
  const aBase = isBaseWorkAssignment(kindA, typeA, metaA);
  const bBase = isBaseWorkAssignment(kindB, typeB, metaB);
  const aGuard = isRestConstrainedGuardKind(kindA) && !aBase;
  const bGuard = isRestConstrainedGuardKind(kindB) && !bBase;
  return (aBase && bGuard) || (aGuard && bBase);
}

function assignmentMeta(
  slot: Pick<AssignmentOverlapMeta, "positionName" | "startTime" | "endTime">,
): AssignmentOverlapMeta {
  return {
    positionName: slot.positionName,
    startTime: slot.startTime,
    endTime: slot.endTime,
  };
}

function isCarmelA(kind: MissionPositionKind): boolean {
  return kind === "standby_carmel_a";
}

/** כרמל א׳ blocks ABAS for the whole mission day. כרמל ב׳ may run in parallel with ABAS. */
export function carmelBlocksAbas(
  kindA: MissionPositionKind,
  typeA: MissionType,
  kindB: MissionPositionKind,
  typeB: MissionType,
  metaA?: AssignmentOverlapMeta,
  metaB?: AssignmentOverlapMeta,
): boolean {
  const aCarmelA = isCarmelA(kindA);
  const bCarmelA = isCarmelA(kindB);
  const aBaseWork = isBaseWorkAssignment(kindA, typeA, metaA);
  const bBaseWork = isBaseWorkAssignment(kindB, typeB, metaB);
  return (aCarmelA && bBaseWork) || (bCarmelA && aBaseWork);
}

/** כרמל ב׳↔עב״ס; חמגשיות↔כרמל ב׳/עתודה; קצין תורן↔פטרול שלו. כל שאר החפיפות אסורות בכל סוגי השיבוץ. */
export function allowsParallelAssignmentOverlap(
  kindA: MissionPositionKind,
  typeA: MissionType,
  kindB: MissionPositionKind,
  typeB: MissionType,
  metaA?: AssignmentOverlapMeta,
  metaB?: AssignmentOverlapMeta,
): boolean {
  if (carmelBlocksAbas(kindA, typeA, kindB, typeB, metaA, metaB)) return false;
  const aCarmelB = kindA === "standby_carmel_b";
  const bCarmelB = kindB === "standby_carmel_b";
  const aBaseWork = isBaseWorkAssignment(kindA, typeA, metaA);
  const bBaseWork = isBaseWorkAssignment(kindB, typeB, metaB);
  // עב״ס: חפיפת זמן מותרת רק מול כרמל ב׳ — לא עתודה, שמירה, חמגשיות, פטרול או קצין.
  if (aBaseWork || bBaseWork) {
    return (aBaseWork && bCarmelB && !bBaseWork) || (bBaseWork && aCarmelB && !aBaseWork);
  }
  const aHam = isHamagshiyotAssignment(kindA, typeA, metaA);
  const bHam = isHamagshiyotAssignment(kindB, typeB, metaB);
  const aReserve = isReserveForcePositionName(metaA?.positionName);
  const bReserve = isReserveForcePositionName(metaB?.positionName);
  // חמגשיות: מותר במקביל לכרמל ב׳ ולכוח עתודה בלבד.
  if (aHam || bHam) {
    if (aHam && bHam) return false;
    return (aHam && (bCarmelB || bReserve)) || (bHam && (aCarmelB || aReserve));
  }
  const aPatrol = kindA === "patrol";
  const bPatrol = kindB === "patrol";
  const aOfficer = kindA === "officer_duty";
  const bOfficer = kindB === "officer_duty";
  return (aPatrol && bOfficer) || (bPatrol && aOfficer);
}

function parallelOverlapAllowed(
  slot: FlatSlot,
  block: BusyBlock,
  _tracker?: ScheduleTracker,
): boolean {
  return allowsParallelAssignmentOverlap(
    slot.positionKind,
    slot.missionType,
    block.positionKind,
    block.missionType,
    {
      positionName: slot.positionName,
      startTime: slot.startTime,
      endTime: slot.endTime,
    },
    {
      positionName: block.positionName,
      startTime: block.startTime,
      endTime: block.endTime,
    },
  );
}

export function blockedByIssue(
  personName: string,
  slot: FlatSlot,
  issues: Issue[],
): boolean {
  const slotIv: TimeInterval = { startMs: slot.startAtMs, endMs: slot.endAtMs };
  if (slotIv.endMs <= slotIv.startMs) return false;

  for (const issue of issues) {
    if (issue.person_name !== personName || issue.status !== "approved") continue;
    const block = issueAbsoluteInterval(issue);
    if (!block) continue;
    if (intervalsOverlap(block, slotIv)) return true;
  }
  return false;
}

export function issueBlockMessage(
  personName: string,
  slot: Pick<FlatSlot, "positionName" | "timeLabel">,
  issue?: Pick<Issue, "constraint_date" | "start_time" | "end_time">,
): string {
  const when = issue
    ? `${issue.constraint_date} ${issue.start_time}–${issue.end_time}`
    : slot.timeLabel;
  return `${personName}: התנגשות עם חסימה מאושרת (${when})`;
}

export function canGuardPerson(person: Person): boolean {
  return !person.no_guard;
}

export type AssignKindContext = {
  positionName?: string;
  missionType?: MissionType;
  startTime?: string;
  endTime?: string;
};

export function canAssignKind(
  person: Person,
  kind: MissionPositionKind,
  ctx?: AssignKindContext,
): boolean {
  if (kind === "officer_duty") {
    return personIsDutyOfficer(person);
  }
  if (kind === "patrol") {
    return personIsDutyOfficer(person);
  }
  if (kind === "kitchen") {
    return !person.no_kitchen;
  }
  if (kind === "standby_carmel_a" || kind === "standby_carmel_b") {
    return !person.no_standby;
  }
  if (kind === "duty") {
    if (ctx?.missionType === "base_work") return !person.no_base_work;
    return !person.no_guard;
  }
  if (isGuardKind(kind)) {
    if (kind === "guard" && personIsDutyOfficer(person)) return false;
    if (person.no_guard) return false;
    if (
      person.no_standing &&
      ctx?.positionName &&
      !isObservationPost(ctx.positionName)
    ) {
      return false;
    }
    return true;
  }
  return true;
}

function assignKindContext(slot: FlatSlot): AssignKindContext {
  return {
    positionName: slot.positionName,
    missionType: slot.missionType,
    startTime: slot.startTime,
    endTime: slot.endTime,
  };
}

function ineligibilityMessage(
  person: Person,
  slot: FlatSlot,
): string {
  const ctx = assignKindContext(slot);
  const kind = slot.positionKind;
  if (kind === "officer_duty") {
    return `${person.name}: רק קצין תורן יכול לשמש ב«${slot.positionName}»`;
  }
  if (kind === "patrol") {
    if (!personIsDutyOfficer(person)) {
      return `${person.name}: רק קצין תורן (רני / יסמין) יכול לבצע פטרול`;
    }
  }
  if (kind === "kitchen" && person.no_kitchen) {
    return `${person.name}: ` + "פטור מטבח";
  }
  if (
    (kind === "standby_carmel_a" || kind === "standby_carmel_b") &&
    person.no_standby
  ) {
    return `${person.name}: פטור מכוננות (כרמל)`;
  }
  if (kind === "duty" && ctx.missionType === "base_work" && person.no_base_work) {
    return `${person.name}: פטור מעב״ס`;
  }
  if (isGuardKind(kind)) {
    if (kind === "guard" && personIsDutyOfficer(person)) {
      return `${person.name}: קצין תורן לא משובץ לשמירה נוספת`;
    }
    if (person.no_guard) return `${person.name}: פטור משמירה`;
    if (
      person.no_standing &&
      ctx.positionName &&
      !isObservationPost(ctx.positionName)
    ) {
      return `${person.name}: פטור עמידה — רק תצפיתן`;
    }
  }
  if (kind === "duty" && person.no_guard) {
    return `${person.name}: פטור משמירה`;
  }
  return `${person.name}: לא זכאי ל«${slot.positionName}»`;
}

function dutyOfficerAlreadyOnGuardDuty(
  personName: string,
  slot: FlatSlot,
  tracker: ScheduleTracker,
): boolean {
  const blocks = tracker.busy[personName] || [];
  if (slot.positionKind === "guard") {
    return blocks.some((b) => b.positionKind === "officer_duty");
  }
  if (slot.positionKind === "officer_duty") {
    return blocks.some((b) => b.positionKind === "guard");
  }
  return false;
}

/** קצין תורן שכבר משובץ באותה עמדה (מושב שותף לאורך היום) */
export function siblingDutyOfficerAssignee(
  mission: MissionDay,
  slot: FlatSlot,
  assignments: Record<string, string[]>,
): string | null {
  if (slot.positionKind !== "officer_duty") return null;
  for (const s of flattenMissionSlots(mission)) {
    if (s.positionId !== slot.positionId) continue;
    for (const name of assignments[s.slotId] || []) {
      if (name && isDutyOfficerName(name)) return name;
    }
  }
  return null;
}

/** קצין תורן המשובץ בזמן משמרת הפטרול */
export function dutyOfficerAtPatrolTime(
  mission: MissionDay,
  patrolSlot: FlatSlot,
  assignments: Record<string, string[]>,
): string | null {
  for (const s of flattenMissionSlots(mission)) {
    if (s.positionKind !== "officer_duty") continue;
    if (s.startAtMs <= patrolSlot.startAtMs && s.endAtMs > patrolSlot.startAtMs) {
      for (const name of assignments[s.slotId] || []) {
        if (name && isDutyOfficerName(name)) return name;
      }
    }
  }
  return null;
}

/** שם המבצע לסיור — שיבוץ בפועל, או קצין תורן מהמשמרת החופפת. */
export function resolvePatrolAssigneeName(
  mission: MissionDay,
  slot: FlatSlot,
): string | null {
  const assigned = slot.assignees.find((name) => name?.trim());
  if (assigned) return assigned.trim();
  const role = patrolAssigneeRole(slot.startTime, slot.endTime);
  if (role === "duty_officer") {
    return dutyOfficerAtPatrolTime(mission, slot, mission.assignments || {});
  }
  return null;
}

function workedRestMinutes(blocks: BusyBlock[]): number {
  return blocks
    .filter((b) => b.eatsRest)
    .reduce((sum, b) => sum + b.durationMinutes, 0);
}

function effectiveGuardRatio(scheduling: MissionSchedulingRules): number {
  const ratio =
    scheduling.guard_ratio ?? DEFAULT_MISSION_SCHEDULING_RULES.guard_ratio ?? 2;
  return ratio > 0 ? ratio : 2;
}

/** כוח עתודה בין/צמוד לשמירות — לא מפר יחס 2:1 (מותר לשמור ↔ עתודה ↔ לשמור). */
function reserveForceBetweenGuards(
  personName: string,
  earlierGuardEndMs: number,
  laterGuardStartMs: number,
  tracker: ScheduleTracker,
): boolean {
  if (laterGuardStartMs <= earlierGuardEndMs) return false;
  for (const block of tracker.busy[personName] || []) {
    if (!isReserveForceBlock(block)) continue;
    if (block.startAtMs < laterGuardStartMs && block.endAtMs > earlierGuardEndMs) {
      return true;
    }
  }
  return false;
}

/** מרווח שמירות לפי זמן אמת (ms) — לא ציר מחזורי שיכול לזוז עם תחילת לוח עב״ס. */
function guardOk(
  personName: string,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  ratio: number,
  ignoreSlotId?: string,
): boolean {
  if (!ratio || !isRestConstrainedGuardKind(slot.positionKind)) return true;

  for (const block of tracker.busy[personName] || []) {
    if (ignoreSlotId && block.slotId === ignoreSlotId) continue;
    if (!isRestConstrainedGuardKind(block.positionKind)) continue;
    if (block.slotId === slot.slotId) continue;

    if (slot.startAtMs >= block.endAtMs) {
      const gapMin = (slot.startAtMs - block.endAtMs) / 60_000;
      if (gapMin < block.durationMinutes * ratio) {
        if (
          reserveForceBetweenGuards(personName, block.endAtMs, slot.startAtMs, tracker)
        ) {
          continue;
        }
        return false;
      }
    } else if (block.startAtMs >= slot.endAtMs) {
      const gapMin = (block.startAtMs - slot.endAtMs) / 60_000;
      if (gapMin < slot.durationMinutes * ratio) {
        if (
          reserveForceBetweenGuards(personName, slot.endAtMs, block.startAtMs, tracker)
        ) {
          continue;
        }
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

/** מסיר שיבוצי שמירה שמפרים יחס 2:1 — לניקוי אחרי מילוי כפוי. */
export function stripGuardSpacingViolations(input: {
  mission: MissionDay;
  assignments: Record<string, string[]>;
  scheduling: MissionSchedulingRules;
  rules: FairnessRules;
}): { assignments: Record<string, string[]>; removed: number } {
  const ratio = effectiveGuardRatio(input.scheduling);
  const assignments = { ...input.assignments };
  for (const key of Object.keys(assignments)) {
    assignments[key] = [...assignments[key]];
  }

  const slots = flattenMissionSlots(input.mission)
    .filter((s) => isGuardKind(s.positionKind) && s.seatCount > 0)
    .sort((a, b) => a.sortKey - b.sortKey || a.slotId.localeCompare(b.slotId));

  const tracker = createEmptyScheduleTracker();
  let removed = 0;

  for (const slot of slots) {
    const seats = assignments[slot.slotId] || [];
    for (let seatIndex = 0; seatIndex < slot.seatCount; seatIndex++) {
      const name = seats[seatIndex];
      if (!name) continue;
      if (isSeatLocked(input.mission, slot.slotId, seatIndex)) {
        placePerson(
          name,
          slot,
          input.mission.id,
          tracker,
          input.rules,
          input.scheduling,
          slot.seatCount,
        );
        continue;
      }
      if (!guardOk(name, slot, tracker, ratio)) {
        seats[seatIndex] = "";
        removed += 1;
        continue;
      }
      placePerson(
        name,
        slot,
        input.mission.id,
        tracker,
        input.rules,
        input.scheduling,
        slot.seatCount,
      );
    }
    assignments[slot.slotId] = seats;
  }

  return { assignments, removed };
}

/** מסיר שיבוצי עב״ס שחופפים שמירה/מפרים מרווח — ביטחון אחרי חלוקה קשיחה. */
export function stripAbasTimeViolations(input: {
  mission: MissionDay;
  assignments: Record<string, string[]>;
  scheduling: MissionSchedulingRules;
  rules: FairnessRules;
  constraintPolicy?: AssignConstraintPolicy;
}): { assignments: Record<string, string[]>; removed: number } {
  const assignments = { ...input.assignments };
  for (const key of Object.keys(assignments)) {
    assignments[key] = [...assignments[key]];
  }

  const slots = flattenMissionSlots(input.mission);
  const isAbas = (s: FlatSlot) =>
    isBaseWorkAssignment(s.positionKind, s.missionType, assignmentMeta(s));
  const others = slots.filter((s) => !isAbas(s));
  const abasSlots = slots
    .filter((s) => isAbas(s) && s.seatCount > 0)
    .sort((a, b) => a.sortKey - b.sortKey || a.slotId.localeCompare(b.slotId));

  const tracker = createEmptyScheduleTracker();
  tracker.constraintPolicy = input.constraintPolicy ?? "standard";
  let removed = 0;

  for (const slot of others) {
    const seats = assignments[slot.slotId] || [];
    for (let seatIndex = 0; seatIndex < slot.seatCount; seatIndex++) {
      const name = seats[seatIndex];
      if (!name) continue;
      placePerson(
        name,
        slot,
        input.mission.id,
        tracker,
        input.rules,
        input.scheduling,
        slot.seatCount,
        input.mission.mission_type,
      );
    }
  }

  for (const slot of abasSlots) {
    const seats = assignments[slot.slotId] || [];
    for (let seatIndex = 0; seatIndex < slot.seatCount; seatIndex++) {
      const name = seats[seatIndex];
      if (!name) continue;
      if (isSeatLocked(input.mission, slot.slotId, seatIndex)) {
        if (overlapsSlot(name, slot, tracker, input.scheduling)) {
          seats[seatIndex] = "";
          removed += 1;
          continue;
        }
        placePerson(
          name,
          slot,
          input.mission.id,
          tracker,
          input.rules,
          input.scheduling,
          slot.seatCount,
          input.mission.mission_type,
        );
        continue;
      }
      const restMode =
        input.constraintPolicy === "relaxed_rest" ? "abas_guard" : "all";
      const restBroken =
        (input.constraintPolicy === "strict_rest" ||
          input.constraintPolicy === "relaxed_rest") &&
        !strictRestGapOk(
          name,
          slot,
          tracker,
          input.scheduling.rest_hours,
          restMode,
        );
      if (overlapsSlot(name, slot, tracker, input.scheduling) || restBroken) {
        seats[seatIndex] = "";
        removed += 1;
        continue;
      }
      placePerson(
        name,
        slot,
        input.mission.id,
        tracker,
        input.rules,
        input.scheduling,
        slot.seatCount,
        input.mission.mission_type,
      );
    }
    assignments[slot.slotId] = seats;
  }

  const sanitized = clearOverlappingAbasAssignments({
    mission: input.mission,
    assignments,
  });
  return { assignments: sanitized.assignments, removed: removed + sanitized.removed };
}

/**
 * מסיר עב״ס שחופף בזמן כל שיבוץ אחר של אותו אדם, מלבד כרמל ב׳.
 * שער אחרון אחרי חלוקה קשיחה — לא תלוי במדיניות מנוחה.
 */
export function clearOverlappingAbasAssignments(input: {
  mission: MissionDay;
  assignments: Record<string, string[]>;
}): { assignments: Record<string, string[]>; removed: number } {
  const assignments = { ...input.assignments };
  for (const key of Object.keys(assignments)) {
    assignments[key] = [...assignments[key]];
  }
  let removed = 0;
  const draft: MissionDay = { ...input.mission, assignments };
  const slots = flattenMissionSlots(draft);

  const byPerson = new Map<string, FlatSlot[]>();
  for (const slot of slots) {
    const seats = assignments[slot.slotId] || [];
    for (const name of seats) {
      if (!name) continue;
      const list = byPerson.get(name) || [];
      list.push(slot);
      byPerson.set(name, list);
    }
  }

  for (const [person, list] of byPerson) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.slotId === b.slotId) continue;
        if (
          allowsParallelAssignmentOverlap(
            a.positionKind,
            a.missionType,
            b.positionKind,
            b.missionType,
            assignmentMeta(a),
            assignmentMeta(b),
          )
        ) {
          continue;
        }
        if (
          !assignmentIntervalsOverlap(
            { startMs: a.startAtMs, endMs: a.endAtMs },
            { startMs: b.startAtMs, endMs: b.endAtMs },
          )
        ) {
          continue;
        }
        const aAbas = isBaseWorkAssignment(a.positionKind, a.missionType, assignmentMeta(a));
        const bAbas = isBaseWorkAssignment(b.positionKind, b.missionType, assignmentMeta(b));
        const drop = aAbas ? a : bAbas ? b : null;
        if (!drop) continue;
        const seats = assignments[drop.slotId] || [];
        for (let si = 0; si < seats.length; si++) {
          if (seats[si] !== person) continue;
          seats[si] = "";
          removed += 1;
        }
        assignments[drop.slotId] = seats;
      }
    }
  }

  return { assignments, removed };
}

function restOk(
  personName: string,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  restHours: number,
): boolean {
  if (!slotEatsRest(slot)) return true;
  const restMin = restHours * 60;
  const worked = workedRestMinutes(tracker.busy[personName] || []);
  return 1440 - worked - slot.durationMinutes >= restMin;
}

/** Idle minutes between two rest-consuming posts (guard↔guard or ABAS↔guard) ≥ rest_hours. */
function strictRestGapOk(
  personName: string,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  restHours: number,
  mode: "all" | "abas_guard" = "all",
): boolean {
  const restMin = Math.max(0, restHours) * 60;
  if (restMin <= 0) return true;
  const slotIsGuard = isRestConstrainedGuardKind(slot.positionKind);
  const slotIsAbas = isBaseWorkAssignment(
    slot.positionKind,
    slot.missionType,
    assignmentMeta(slot),
  );
  if (!slotIsGuard && !slotIsAbas) return true;

  const slotIv = slotInterval(slot);
  for (const b of tracker.busy[personName] || []) {
    if (b.slotId === slot.slotId) continue;
    const blockIsGuard = isRestConstrainedGuardKind(b.positionKind);
    const blockIsAbas = isBaseWorkAssignment(
      b.positionKind,
      b.missionType,
      assignmentMeta(b),
    );
    const abasGuardPair =
      (slotIsGuard && blockIsAbas) || (slotIsAbas && blockIsGuard);
    const pairNeedsRest =
      mode === "abas_guard"
        ? abasGuardPair
        : (slotIsGuard && blockIsGuard) || abasGuardPair;
    if (!pairNeedsRest) continue;
    const blockIv = blockInterval(b);
    if (assignmentIntervalsOverlap(slotIv, blockIv)) continue;
    const idle = idleGapMinutes(slotIv, blockIv);
    if (idle == null) continue;
    if (idle < restMin) return false;
  }
  return true;
}

function idleGapMinutes(a: TimeInterval, b: TimeInterval): number | null {
  if (intervalsOverlap(a, b)) return null;
  if (a.endMs <= b.startMs) return (b.startMs - a.endMs) / 60_000;
  return (a.startMs - b.endMs) / 60_000;
}

function formatHoursFromMinutes(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

function dutyGuardGapMinutes(scheduling: MissionSchedulingRules): number {
  return (
    scheduling.duty_guard_gap_minutes ??
    DEFAULT_MISSION_SCHEDULING_RULES.duty_guard_gap_minutes ??
    60
  );
}

function slotInterval(slot: FlatSlot): TimeInterval {
  return { startMs: slot.startAtMs, endMs: slot.endAtMs };
}

function blockInterval(block: BusyBlock): TimeInterval {
  return { startMs: block.startAtMs, endMs: block.endAtMs };
}

/** Canonical overlap check for assignment intervals — half-open [start, end). */
export function assignmentIntervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return intervalsOverlap(a, b);
}

export function describeAssignmentBlock(block: BusyBlock): string {
  return `${blockLabel(block)} ${block.startTime}–${block.endTime}`;
}

function overlapsSlot(
  personName: string,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  scheduling: MissionSchedulingRules,
  ignoreSlotId?: string,
): boolean {
  const person = personName.trim();
  const gapMin =
    scheduling.duty_guard_gap_minutes ??
    DEFAULT_MISSION_SCHEDULING_RULES.duty_guard_gap_minutes ??
    90;
  const skipDutyGuardGap = trackerConstraintPolicy(tracker) === "coverage";
  const slotIv = slotInterval(slot);

  for (const b of tracker.busy[person] || []) {
    if (ignoreSlotId && b.slotId === ignoreSlotId) continue;
    if (
      b.slotId === slot.slotId &&
      b.startTime === slot.startTime &&
      b.endTime === slot.endTime &&
      (b.positionName ?? "") === slot.positionName
    ) {
      continue;
    }
    if (isKitchenMissionSlot(slot) && isKitchenMissionSlot(b)) continue;
    if (
      carmelBlocksAbas(
        slot.positionKind,
        slot.missionType,
        b.positionKind,
        b.missionType,
        assignmentMeta(slot),
        assignmentMeta(b),
      )
    ) {
      return true;
    }
    if (parallelOverlapAllowed(slot, b, tracker)) continue;

    const blockIv = blockInterval(b);
    if (
      visibleTimeOverlap(labeledInterval({
        startMs: slot.startAtMs,
        endMs: slot.endAtMs,
        startTime: slot.startTime,
        endTime: slot.endTime,
      }), labeledInterval({
        startMs: b.startAtMs,
        endMs: b.endAtMs,
        startTime: b.startTime,
        endTime: b.endTime,
      }))
    ) {
      return true;
    }

    const dutyGuard = needsDutyGuardGap(
      slot.positionKind,
      slot.missionType,
      b.positionKind,
      b.missionType,
      assignmentMeta(slot),
      assignmentMeta(b),
    );
    if (dutyGuard && !skipDutyGuardGap) {
      const slotTl = toMissionTimelineInterval(0, slotIv.startMs, slotIv.endMs);
      const blockTl = toMissionTimelineInterval(0, blockIv.startMs, blockIv.endMs);
      if (!guardAbasRestOk(slotTl, blockTl, gapMin)) return true;
    }
  }
  return false;
}

function sameRoomOk(
  person: Person,
  mates: string[],
  peopleByName: Record<string, Person>,
): boolean {
  if (!person.room) return true;
  for (const m of mates) {
    if (!m || m === person.name) continue;
    const mp = peopleByName[m];
    if (!mp?.room) continue;
    if (mp.room !== person.room) return false;
    if (person.gender && mp.gender && person.gender !== mp.gender) return false;
  }
  return true;
}

function sameGenderOk(
  person: Person,
  mates: string[],
  peopleByName: Record<string, Person>,
): boolean {
  if (!person.gender) return true;
  for (const m of mates) {
    if (!m || m === person.name) continue;
    const mp = peopleByName[m];
    if (!mp?.gender) continue;
    if (mp.gender !== person.gender) return false;
  }
  return true;
}

/** צוות 1–4; אם חסר במאגר — חלוקה יציבה לפי שם */
export function effectiveSquad(person: Person, fallbackIndex: number): number {
  if (person.squad != null && person.squad >= 1 && person.squad <= 4) {
    return person.squad;
  }
  return (fallbackIndex % 4) + 1;
}

export function bucketForSlot(
  slot: FlatSlot,
  seatCount: number,
  rules: FairnessRules,
): keyof FairnessRules {
  if (slot.positionKind === "patrol") return "duty";
  if (
    slot.positionKind === "kitchen" &&
    slot.missionType === "guards" &&
    isHamagshiyotPositionName(slot.positionName)
  ) {
    return "kitchen";
  }
  if (slot.positionKind === "standby_carmel_a") return "standby_a";
  if (slot.positionKind === "standby_carmel_b") return "standby_b";
  if (isStandbyKind(slot.positionKind)) return "standby";
  if (slot.positionKind === "kitchen") return "kitchen";
  if (slot.positionKind === "duty" || slot.positionKind === "officer_duty") return "duty";
  return seatCount <= 1 ? "solo" : "pair";
}

export function pointsForSlot(
  slot: FlatSlot,
  seatCount: number,
  rules: FairnessRules,
  options?: { missionType?: MissionType; scheduling?: MissionSchedulingRules },
): number {
  const missionType = options?.missionType ?? slot.missionType;
  if (isGuardKind(slot.positionKind) || slot.positionKind === "patrol") {
    return getGuardBaseBurdenForSlot(slot, seatCount, rules);
  }
  return toranutPointsForMissionBlock(
    blockFromFlatSlot(slot, missionType, seatCount),
    rules,
    options?.scheduling,
  );
}

export function workScore(
  person: Person,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  scheduling?: MissionSchedulingRules,
  bucket?: FairnessBurdenBucket,
): number {
  const priorAdj = ((person.prior_score || 0) - meanPrior) * rules.hist;
  const burden = periodBurdenForBucket(
    person,
    tracker,
    rules,
    scheduling,
    bucket ?? "duty",
  );
  return burden + priorAdj;
}

export function periodBurdenOnly(
  person: Person,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
): number {
  return (
    tracker.periodPoints[person.name] ??
    calculatePersonBurden(tracker.busy[person.name] || [], rules, scheduling).totalBurden
  );
}

export function periodBurdenForBucket(
  person: Person,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling: MissionSchedulingRules | undefined,
  bucket: FairnessBurdenBucket,
): number {
  if (bucket === "kitchen") {
    if (tracker.kitchenPoints[person.name] != null) {
      return tracker.kitchenPoints[person.name];
    }
    return calculatePersonBurden(tracker.busy[person.name] || [], rules, scheduling)
      .kitchenPoints;
  }
  if (tracker.dutyPoints[person.name] != null) {
    return tracker.dutyPoints[person.name];
  }
  return calculatePersonBurden(tracker.busy[person.name] || [], rules, scheduling).dutyPoints;
}

export function personBurdenBreakdown(
  personName: string,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
): PersonBurdenBreakdown {
  return calculatePersonBurden(tracker.busy[personName] || [], rules, scheduling);
}

export function projectedGuardCandidateScore(
  person: Person,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  scheduling?: MissionSchedulingRules,
  seatCount?: number,
): number {
  const projected = calculateProjectedCandidateBurden(
    person.name,
    slot,
    busyToBurdenBlocks(tracker.busy[person.name] || []),
    rules,
    scheduling,
    seatCount,
  );
  const priorAdj = ((person.prior_score || 0) - meanPrior) * rules.hist;
  return projected + priorAdj;
}

export function activeRosterMembers(people: Person[]): Person[] {
  return people.filter((p) => p.active);
}

export function rosterBurdenByName(
  roster: Person[],
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling: MissionSchedulingRules | undefined,
  bucket: FairnessBurdenBucket,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const person of activeRosterMembers(roster)) {
    map.set(
      person.name,
      periodBurdenForBucket(person, tracker, rules, scheduling, bucket),
    );
  }
  return map;
}

export function rosterBurdenSpread(
  roster: Person[],
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling: MissionSchedulingRules | undefined,
  bucket: FairnessBurdenBucket,
  overrides?: Map<string, number>,
): number {
  const base = rosterBurdenByName(roster, tracker, rules, scheduling, bucket);
  const names = activeRosterMembers(roster).map((p) => p.name);
  return spreadWithOverrides(base, names, overrides ?? new Map());
}

export function projectedPeriodBurdenForSlot(
  person: Person,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
  seatCount?: number,
): number {
  const bucket = fairnessBurdenBucketForSlot(slot);
  const blocks = busyToBurdenBlocks(tracker.busy[person.name] || []);
  if (bucket === "kitchen") {
    return calculateProjectedKitchenBurden(
      person.name,
      slot,
      blocks,
      rules,
      scheduling,
      seatCount,
    );
  }
  if (isGuardKind(slot.positionKind)) {
    return calculateProjectedCandidateBurden(
      person.name,
      slot,
      blocks,
      rules,
      scheduling,
      seatCount,
    );
  }
  const base = periodBurdenForBucket(person, tracker, rules, scheduling, "duty");
  const increment = pointsForSlot(slot, seatCount ?? slot.seatCount, rules, {
    missionType: slot.missionType,
    scheduling,
  });
  return Math.round((base + increment) * 100) / 100;
}

export function projectedBurdenForSlot(
  person: Person,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  scheduling?: MissionSchedulingRules,
  seatCount?: number,
): number {
  if (isGuardKind(slot.positionKind)) {
    return projectedGuardCandidateScore(
      person,
      slot,
      tracker,
      rules,
      meanPrior,
      scheduling,
      seatCount,
    );
  }
  const period = projectedPeriodBurdenForSlot(
    person,
    slot,
    tracker,
    rules,
    scheduling,
    seatCount,
  );
  const priorAdj = ((person.prior_score || 0) - meanPrior) * rules.hist;
  return Math.round((period + priorAdj) * 100) / 100;
}

export function compareByFairnessThenBurden(
  a: Person,
  b: Person,
  slot: FlatSlot,
  roster: Person[],
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  scheduling?: MissionSchedulingRules,
  seatCount?: number,
  preferHigh = false,
): number {
  const bucket = fairnessBurdenBucketForSlot(slot);
  const base = rosterBurdenByName(roster, tracker, rules, scheduling, bucket);
  const names = activeRosterMembers(roster).map((p) => p.name);
  const burdenA = projectedPeriodBurdenForSlot(
    a,
    slot,
    tracker,
    rules,
    scheduling,
    seatCount,
  );
  const burdenB = projectedPeriodBurdenForSlot(
    b,
    slot,
    tracker,
    rules,
    scheduling,
    seatCount,
  );
  const spreadA = spreadWithOverrides(base, names, new Map([[a.name, burdenA]]));
  const spreadB = spreadWithOverrides(base, names, new Map([[b.name, burdenB]]));
  if (spreadA !== spreadB) return spreadA - spreadB;
  const scoreA = projectedBurdenForSlot(
    a,
    slot,
    tracker,
    rules,
    meanPrior,
    scheduling,
    seatCount,
  );
  const scoreB = projectedBurdenForSlot(
    b,
    slot,
    tracker,
    rules,
    meanPrior,
    scheduling,
    seatCount,
  );
  return preferHigh ? scoreB - scoreA : scoreA - scoreB;
}

export function spreadAfterGroupAssign(
  group: Person[],
  slot: FlatSlot,
  roster: Person[],
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  scheduling?: MissionSchedulingRules,
): number {
  const base = rosterBurdenByName(roster, tracker, rules, scheduling, "duty");
  const names = activeRosterMembers(roster).map((p) => p.name);
  const overrides = new Map<string, number>();
  for (const person of group) {
    overrides.set(
      person.name,
      projectedPeriodBurdenForSlot(
        person,
        slot,
        tracker,
        rules,
        scheduling,
        slot.seatCount,
      ),
    );
  }
  return spreadWithOverrides(base, names, overrides);
}

/** Whether two assignment kinds require minimum spacing (not overlap — e.g. guard↔base work). */
export function assignmentNeedsSpacingGap(
  kindA: MissionPositionKind,
  typeA: MissionType,
  kindB: MissionPositionKind,
  typeB: MissionType,
): boolean {
  return needsDutyGuardGap(kindA, typeA, kindB, typeB);
}

export function explainFitsPersonFailure(
  person: Person,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  mates: string[],
  peopleByName: Record<string, Person>,
  ignoreSlotId?: string,
): string | null {
  const policy = trackerConstraintPolicy(tracker);
  if (!canAssignKind(person, slot.positionKind, assignKindContext(slot))) return "canAssignKind";
  if (dutyOfficerAlreadyOnGuardDuty(person.name, slot, tracker)) return "dutyOfficerGuard";
  if (blockedByIssue(person.name, slot, issues)) return "blockedByIssue";
  if (overlapsSlot(person.name, slot, tracker, scheduling, ignoreSlotId)) return "overlapsSlot";
  if (!guardOk(person.name, slot, tracker, effectiveGuardRatio(scheduling), ignoreSlotId)) return "guardOk";
  if (policy !== "coverage") {
    const skipGuardGuardRest = policy === "relaxed_rest";
    const slotIsAbas = isBaseWorkAssignment(
      slot.positionKind,
      slot.missionType,
      assignmentMeta(slot),
    );
    if (!skipGuardGuardRest && !slotIsAbas) {
      if (!restOk(person.name, slot, tracker, scheduling.rest_hours)) return "restOk";
    }
    if (policy === "strict_rest" || policy === "relaxed_rest") {
      if (
        !strictRestGapOk(
          person.name,
          slot,
          tracker,
          scheduling.rest_hours,
          skipGuardGuardRest ? "abas_guard" : "all",
        )
      ) {
        return "guardRestGap";
      }
    }
    if (slot.sameRoom && !sameRoomOk(person, mates, peopleByName)) return "sameRoom";
    if (slot.sameGender && !sameGenderOk(person, mates, peopleByName)) return "sameGender";
  }
  return null;
}

export function fitsPerson(
  person: Person,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  mates: string[],
  peopleByName: Record<string, Person>,
  ignoreSlotId?: string,
): boolean {
  return (
    explainFitsPersonFailure(
      person,
      slot,
      tracker,
      issues,
      scheduling,
      mates,
      peopleByName,
      ignoreSlotId,
    ) === null
  );
}

export function placePerson(
  personName: string,
  slot: FlatSlot,
  missionId: string,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling: MissionSchedulingRules,
  seatCount: number,
  _missionType?: MissionType,
) {
  const name = personName.trim();
  if (!name) return;
  const block: BusyBlock = {
    cyclicStart: slot.cyclicStart,
    wallStartMin: slot.wallStartMin,
    calendarDayOffset: slot.calendarDayOffset,
    durationMinutes: slot.durationMinutes,
    eatsRest: slotEatsRest(slot),
    positionKind: slot.positionKind,
    missionType: slot.missionType,
    seatCount,
    startTime: slot.startTime,
    endTime: slot.endTime,
    slotId: slot.slotId,
    missionId,
    startAtMs: slot.startAtMs,
    endAtMs: slot.endAtMs,
    positionName: slot.positionName,
  };
  tracker.busy[name] = [...(tracker.busy[name] || []), block];
  if (isGuardKind(slot.positionKind)) {
    tracker.guardShifts[name] = [
      ...(tracker.guardShifts[name] || []),
      { start: slot.cyclicStart, duration: slot.durationMinutes },
    ];
  }
  syncPersonPeriodPoints(name, tracker, rules, scheduling);
}

function rebuildGuardShiftsForPerson(personName: string, tracker: ScheduleTracker) {
  tracker.guardShifts[personName] = (tracker.busy[personName] || [])
    .filter((b) => isGuardKind(b.positionKind))
    .map((b) => ({ start: b.cyclicStart, duration: b.durationMinutes }));
}

export function unplacePerson(
  personName: string,
  slot: FlatSlot,
  missionId: string,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling?: MissionSchedulingRules,
) {
  tracker.busy[personName] = (tracker.busy[personName] || []).filter(
    (b) => !(b.slotId === slot.slotId && b.missionId === missionId),
  );
  rebuildGuardShiftsForPerson(personName, tracker);
  syncPersonPeriodPoints(personName, tracker, rules, scheduling);
}

/** מנסה למלא משבצות ריקות ע"י החלפות — עדיפות למילוי מלא על פני צדק */
export function repairGuardAssignmentGaps(input: {
  mission: MissionDay;
  assignments: Record<string, string[]>;
  people: Person[];
  tracker: ScheduleTracker;
  issues: Issue[];
  scheduling: MissionSchedulingRules;
  rules: FairnessRules;
  meanPrior: number;
  randomSeed?: number;
}): { assignments: Record<string, string[]>; filled: number } {
  const assignments = { ...input.assignments };
  for (const key of Object.keys(assignments)) {
    assignments[key] = [...assignments[key]];
  }
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  let filled = 0;
  const slots = flattenMissionSlots(input.mission).filter(
    (s) => isGuardKind(s.positionKind) && s.seatCount > 0,
  );

  let progress = true;
  let guard = 0;
  while (progress && guard < 80) {
    progress = false;
    guard += 1;

    for (const slot of slots) {
      const seats = assignments[slot.slotId] || [];
      for (let seatIndex = 0; seatIndex < slot.seatCount; seatIndex++) {
        if (seats[seatIndex]) continue;

        const mates = seats.filter((n, idx) => n && idx !== seatIndex);
        const direct = input.people.filter((p) =>
          fitsPerson(
            p,
            slot,
            input.tracker,
            input.issues,
            input.scheduling,
            mates,
            peopleByName,
          ),
        );
        const chosen =
          pickBestCandidate(
            direct,
            slot,
            input.tracker,
            input.rules,
            input.meanPrior,
            {
              scheduling: input.scheduling,
              roster: input.people,
              dutyOfficerAlreadyAssigned: siblingDutyOfficerAssignee(
                input.mission,
                slot,
                assignments,
              ) ?? undefined,
              randomSeed: input.randomSeed,
            },
          ) ??
          pickRelaxedCandidate(
            input.people,
            slot,
            input.tracker,
            input.issues,
            input.scheduling,
            mates,
            peopleByName,
            input.rules,
            input.meanPrior,
            new Set(mates),
            {
              roster: input.people,
              dutyOfficerAlreadyAssigned: siblingDutyOfficerAssignee(
                input.mission,
                slot,
                assignments,
              ) ?? undefined,
            },
          );
        if (chosen) {
          seats[seatIndex] = chosen.name;
          placePerson(
            chosen.name,
            slot,
            input.mission.id,
            input.tracker,
            input.rules,
            input.scheduling,
            slot.seatCount,
            input.mission.mission_type,
          );
          filled += 1;
          progress = true;
          continue;
        }

        for (const donorSlot of slots) {
          if (donorSlot.slotId === slot.slotId) continue;
          const donorSeats = assignments[donorSlot.slotId] || [];
          for (let donorIdx = 0; donorIdx < donorSlot.seatCount; donorIdx++) {
            const donorName = donorSeats[donorIdx];
            if (!donorName) continue;
            if (isSeatLocked(input.mission, donorSlot.slotId, donorIdx)) continue;
            const donorPerson = peopleByName[donorName];
            if (!donorPerson) continue;

            unplacePerson(
              donorName,
              donorSlot,
              input.mission.id,
              input.tracker,
              input.rules,
              input.scheduling,
            );

            const donorFitsTarget = fitsPerson(
              donorPerson,
              slot,
              input.tracker,
              input.issues,
              input.scheduling,
              mates,
              peopleByName,
            );
            if (!donorFitsTarget) {
              placePerson(
                donorName,
                donorSlot,
                input.mission.id,
                input.tracker,
                input.rules,
                input.scheduling,
                donorSlot.seatCount,
                input.mission.mission_type,
              );
              continue;
            }

            const donorMates = donorSeats.filter((n, idx) => n && idx !== donorIdx);
            const replacement = pickBestCandidate(
              input.people.filter(
                (p) =>
                  p.name !== donorName &&
                  !donorMates.includes(p.name) &&
                  fitsPerson(
                    p,
                    donorSlot,
                    input.tracker,
                    input.issues,
                    input.scheduling,
                    donorMates,
                    peopleByName,
                  ),
              ),
              donorSlot,
              input.tracker,
              input.rules,
              input.meanPrior,
              { scheduling: input.scheduling, roster: input.people, randomSeed: input.randomSeed },
            );

            if (!replacement) {
              placePerson(
                donorName,
                donorSlot,
                input.mission.id,
                input.tracker,
                input.rules,
                input.scheduling,
                donorSlot.seatCount,
                input.mission.mission_type,
              );
              continue;
            }

            donorSeats[donorIdx] = replacement.name;
            seats[seatIndex] = donorName;
            placePerson(
              replacement.name,
              donorSlot,
              input.mission.id,
              input.tracker,
              input.rules,
              input.scheduling,
              donorSlot.seatCount,
              input.mission.mission_type,
            );
            placePerson(
              donorName,
              slot,
              input.mission.id,
              input.tracker,
              input.rules,
              input.scheduling,
              slot.seatCount,
              input.mission.mission_type,
            );
            filled += 1;
            progress = true;
            break;
          }
          if (progress) break;
        }
      }
      assignments[slot.slotId] = seats;
    }
  }

  return { assignments, filled };
}

/** אזהרות על הפרות כללים — לשיבוץ כפוי עם הודעות */
export function describeAssignmentWarnings(
  person: Person,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  mates: string[],
  peopleByName: Record<string, Person>,
): string[] {
  const msgs: string[] = [];
  if (!canAssignKind(person, slot.positionKind, assignKindContext(slot))) {
    msgs.push(ineligibilityMessage(person, slot));
  }
  if (blockedByIssue(person.name, slot, issues)) {
    const issue = issues.find(
      (row) =>
        row.person_name === person.name &&
        row.status === "approved" &&
        issueAbsoluteInterval(row) &&
        intervalsOverlap(issueAbsoluteInterval(row)!, {
          startMs: slot.startAtMs,
          endMs: slot.endAtMs,
        }),
    );
    msgs.push(issueBlockMessage(person.name, slot, issue));
  }
  if (dutyOfficerAlreadyOnGuardDuty(person.name, slot, tracker)) {
    msgs.push(
      slot.positionKind === "officer_duty"
        ? `${person.name}: כבר משובצ/ת בשמירה — לא יכול/ה להיות קצין תורן`
        : `${person.name}: קצין תורן לא יכול/ה להיות גם בשמירה`,
    );
  }
  msgs.push(...collectSpacingAndRestWarnings(person.name, slot, tracker, scheduling));
  if (slot.sameRoom && !sameRoomOk(person, mates, peopleByName)) {
    msgs.push(`${person.name}: לא אותו חדר כמו שאר המשמרת`);
  }
  if (slot.sameGender && !sameGenderOk(person, mates, peopleByName)) {
    msgs.push(`${person.name}: לא אותו מגדר כמו שאר המשמרת`);
  }
  return msgs;
}

function collectSpacingAndRestWarnings(
  personName: string,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  scheduling: MissionSchedulingRules,
): string[] {
  const msgs: string[] = [];
  const gapMin = dutyGuardGapMinutes(scheduling);
  const restMin = Math.max(0, scheduling.rest_hours) * 60;
  const ratio = effectiveGuardRatio(scheduling);
  const slotIv = slotInterval(slot);

  for (const b of tracker.busy[personName] || []) {
    if (b.slotId === slot.slotId) continue;
    if (isKitchenMissionSlot(slot) && isKitchenMissionSlot(b)) continue;
    if (
      carmelBlocksAbas(
        slot.positionKind,
        slot.missionType,
        b.positionKind,
        b.missionType,
        assignmentMeta(slot),
        assignmentMeta(b),
      )
    ) {
      msgs.push(
        `${personName}: כרמל חוסם עב״ס לכל יום המשימה (${describeAssignmentBlock(b)} / ${slot.positionName} ${slot.timeLabel})`,
      );
      continue;
    }
    if (parallelOverlapAllowed(slot, b, tracker)) continue;

    const blockIv = blockInterval(b);
    const dutyGuard = needsDutyGuardGap(
      slot.positionKind,
      slot.missionType,
      b.positionKind,
      b.missionType,
      assignmentMeta(slot),
      assignmentMeta(b),
    );

    if (assignmentIntervalsOverlap(slotIv, blockIv)) {
      msgs.push(
        `${personName}: חפיפה עם ${describeAssignmentBlock(b)} (${slot.positionName} ${slot.timeLabel})`,
      );
      continue;
    }

    const idle = idleGapMinutes(slotIv, blockIv);
    if (idle == null) continue;

    if (dutyGuard && idle < gapMin) {
      const slotIsGuard = isGuardKind(slot.positionKind);
      msgs.push(
        slotIsGuard
          ? `${personName}: מרווח ${Math.round(idle)} דק׳ בין עב״ס ${b.startTime}–${b.endTime} לשמירה ${slot.timeLabel} (נדרש ${gapMin})`
          : `${personName}: מרווח ${Math.round(idle)} דק׳ בין שמירה ${b.startTime}–${b.endTime} לעב״ס ${slot.timeLabel} (נדרש ${gapMin})`,
      );
    }

    const slotIsGuardPost = isRestConstrainedGuardKind(slot.positionKind);
    const blockIsGuardPost = isRestConstrainedGuardKind(b.positionKind);
    if (slotIsGuardPost && blockIsGuardPost && restMin > 0 && idle < restMin) {
      msgs.push(
        `${personName}: מנוחה ${formatHoursFromMinutes(idle)} שעות בין שמירות ${b.startTime}–${b.endTime} ו-${slot.timeLabel} (נדרש ${scheduling.rest_hours})`,
      );
    }

    const slotIsAbas = isBaseWorkAssignment(
      slot.positionKind,
      slot.missionType,
      assignmentMeta(slot),
    );
    const blockIsAbas = isBaseWorkAssignment(
      b.positionKind,
      b.missionType,
      assignmentMeta(b),
    );
    if (
      restMin > 0 &&
      idle < restMin &&
      ((slotIsAbas && blockIsGuardPost) || (blockIsAbas && slotIsGuardPost))
    ) {
      msgs.push(
        slotIsGuardPost
          ? `${personName}: מנוחה ${formatHoursFromMinutes(idle)} שעות בין עב״ס ${b.startTime}–${b.endTime} לשמירה ${slot.timeLabel} (נדרש ${scheduling.rest_hours})`
          : `${personName}: מנוחה ${formatHoursFromMinutes(idle)} שעות בין שמירה ${b.startTime}–${b.endTime} לעב״ס ${slot.timeLabel} (נדרש ${scheduling.rest_hours})`,
      );
    }

    if (
      isRestConstrainedGuardKind(slot.positionKind) &&
      isRestConstrainedGuardKind(b.positionKind) &&
      ratio > 0
    ) {
      const earlierIsBlock = blockIv.endMs <= slotIv.startMs;
      const earlierDur = earlierIsBlock ? b.durationMinutes : slot.durationMinutes;
      const required = earlierDur * ratio;
      if (
        idle < required &&
        !reserveForceBetweenGuards(
          personName,
          Math.min(blockIv.endMs, slotIv.endMs),
          Math.max(blockIv.startMs, slotIv.startMs),
          tracker,
        )
      ) {
        msgs.push(
          `${personName}: יחס שמירות ${ratio}:1 — מרווח ${formatHoursFromMinutes(idle)} שעות אחרי משמרת ${formatHoursFromMinutes(earlierDur)} (נדרש ${formatHoursFromMinutes(required)}) ב-${slot.timeLabel}`,
        );
      }
    }
  }

  if (!restOk(personName, slot, tracker, scheduling.rest_hours)) {
    const worked = workedRestMinutes(tracker.busy[personName] || []);
    const remainingMin = 1440 - worked - slot.durationMinutes;
    msgs.push(
      `${personName}: מנוחה יומית ${formatHoursFromMinutes(remainingMin)} שעות לפני ${slot.timeLabel} (נדרש ${scheduling.rest_hours})`,
    );
  }

  return msgs;
}

/** מועמדים כשאין מי שעומד בכל הכללים — עדיין אוסר חפיפות ויחס שמירות */
export function pickRelaxedCandidate(
  people: Person[],
  slot: FlatSlot,
  tracker: ScheduleTracker,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  mates: string[],
  peopleByName: Record<string, Person>,
  rules: FairnessRules,
  meanPrior: number,
  exclude: Set<string>,
  pickOptions?: { dutyOfficerAlreadyAssigned?: string; roster?: Person[] },
): Person | null {
  const candidates = people.filter((p) => {
    if (exclude.has(p.name) || mates.includes(p.name)) return false;
    if (!canAssignKind(p, slot.positionKind, assignKindContext(slot))) return false;
    if (blockedByIssue(p.name, slot, issues)) return false;
    if (overlapsSlot(p.name, slot, tracker, scheduling)) return false;
    if (
      isGuardKind(slot.positionKind) &&
      !guardOk(p.name, slot, tracker, effectiveGuardRatio(scheduling))
    ) {
      return false;
    }
    if (!restOk(p.name, slot, tracker, scheduling.rest_hours)) return false;
    if (slot.sameRoom && !sameRoomOk(p, mates, peopleByName)) return false;
    if (slot.sameGender && !sameGenderOk(p, mates, peopleByName)) return false;
    return true;
  });
  return pickBestCandidate(candidates, slot, tracker, rules, meanPrior, {
    scheduling,
    roster: pickOptions?.roster ?? people,
    dutyOfficerAlreadyAssigned: pickOptions?.dutyOfficerAlreadyAssigned,
  });
}

/** מילוי אחרון — מדלג על מנוחה יומית ועל אותו חדר/מגדר, שומר חפיפות ויחס שמירות */
export function pickRestRelaxedCandidate(
  people: Person[],
  slot: FlatSlot,
  tracker: ScheduleTracker,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  mates: string[],
  peopleByName: Record<string, Person>,
  rules: FairnessRules,
  meanPrior: number,
  exclude: Set<string>,
  pickOptions?: { dutyOfficerAlreadyAssigned?: string; roster?: Person[] },
): Person | null {
  const candidates = people.filter((p) => {
    if (exclude.has(p.name) || mates.includes(p.name)) return false;
    if (!canAssignKind(p, slot.positionKind, assignKindContext(slot))) return false;
    if (blockedByIssue(p.name, slot, issues)) return false;
    if (overlapsSlot(p.name, slot, tracker, scheduling)) return false;
    const slotIv = slotInterval(slot);
    for (const b of tracker.busy[p.name] || []) {
      if (b.slotId === slot.slotId) continue;
      if (parallelOverlapAllowed(slot, b, tracker)) continue;
      if (assignmentIntervalsOverlap(slotIv, blockInterval(b))) return false;
    }
    if (
      isGuardKind(slot.positionKind) &&
      !guardOk(p.name, slot, tracker, effectiveGuardRatio(scheduling))
    ) {
      return false;
    }
    return true;
  });
  return pickBestCandidate(candidates, slot, tracker, rules, meanPrior, {
    scheduling,
    roster: pickOptions?.roster ?? people,
    dutyOfficerAlreadyAssigned: pickOptions?.dutyOfficerAlreadyAssigned,
  });
}

/** ממלא משבצות ריקות — חובה קודם, עתודה, חמגשיות אחרונות. בלי הפרת חפיפה. */
export function forceFillEmptySeats(input: {
  mission: MissionDay;
  assignments: Record<string, string[]>;
  people: Person[];
  tracker: ScheduleTracker;
  issues: Issue[];
  scheduling: MissionSchedulingRules;
  rules: FairnessRules;
  meanPrior: number;
  randomSeed?: number;
  /** אחרי מילוי הוגן: שובר מנוחה רק בעמדות חובה שנשארו ריקות. */
  allowCoverageFill?: boolean;
}): { assignments: Record<string, string[]>; filled: number; warnings: string[] } {
  const assignments = { ...input.assignments };
  for (const key of Object.keys(assignments)) {
    assignments[key] = [...assignments[key]];
  }
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const warnings: string[] = [];
  let filled = 0;
  const policy = trackerConstraintPolicy(input.tracker);
  const pickOpts = (slot: FlatSlot) => ({
    scheduling: input.scheduling,
    roster: input.people,
    dutyOfficerAlreadyAssigned:
      siblingDutyOfficerAssignee(input.mission, slot, assignments) ?? undefined,
    randomSeed: input.randomSeed,
  });
  const orderedSlots = [...flattenMissionSlots(input.mission)].sort(
    (a, b) =>
      coverageFillRank(a) - coverageFillRank(b) ||
      a.sortKey - b.sortKey ||
      a.slotId.localeCompare(b.slotId),
  );

  const placeChosen = (slot: FlatSlot, seatIndex: number, chosen: Person) => {
    const seats = assignments[slot.slotId];
    seats[seatIndex] = chosen.name;
    placePerson(
      chosen.name,
      slot,
      input.mission.id,
      input.tracker,
      input.rules,
      input.scheduling,
      slot.seatCount,
      input.mission.mission_type,
    );
    filled += 1;
  };

  for (const slot of orderedSlots) {
    if (slot.seatCount <= 0) continue;
    if (!assignments[slot.slotId]) {
      assignments[slot.slotId] = Array.from({ length: slot.seatCount }, () => "");
    }
    const seats = assignments[slot.slotId];
    const inSlot = new Set(seats.filter(Boolean));
    const mandatory = coverageFillTier(slot) === "mandatory";

    for (let seatIndex = 0; seatIndex < slot.seatCount; seatIndex++) {
      if (seats[seatIndex]) continue;

      const mates = seats.filter((n, idx) => n && idx !== seatIndex);
      const strict = input.people.filter(
        (p) =>
          !inSlot.has(p.name) &&
          fitsPerson(
            p,
            slot,
            input.tracker,
            input.issues,
            input.scheduling,
            mates,
            peopleByName,
          ),
      );
      let chosen = pickBestCandidate(
        strict,
        slot,
        input.tracker,
        input.rules,
        input.meanPrior,
        pickOpts(slot),
      );
      let lastResort = false;

      if (!chosen && mandatory && policy === "standard") {
        chosen = pickRelaxedCandidate(
          input.people,
          slot,
          input.tracker,
          input.issues,
          input.scheduling,
          mates,
          peopleByName,
          input.rules,
          input.meanPrior,
          inSlot,
          {
            roster: input.people,
            dutyOfficerAlreadyAssigned:
              siblingDutyOfficerAssignee(input.mission, slot, assignments) ??
              undefined,
          },
        );
      }

      if (!chosen && mandatory && input.allowCoverageFill) {
        const prevPolicy = input.tracker.constraintPolicy;
        input.tracker.constraintPolicy = "relaxed_rest";
        try {
          const relaxed = input.people.filter(
            (p) =>
              !inSlot.has(p.name) &&
              fitsPerson(
                p,
                slot,
                input.tracker,
                input.issues,
                input.scheduling,
                mates,
                peopleByName,
              ),
          );
          chosen = pickBestCandidate(
            relaxed,
            slot,
            input.tracker,
            input.rules,
            input.meanPrior,
            pickOpts(slot),
          );
          lastResort = Boolean(chosen);
        } finally {
          input.tracker.constraintPolicy = prevPolicy;
        }
        if (!chosen && !slot.sameRoom) {
          chosen = pickRestRelaxedCandidate(
            input.people,
            slot,
            input.tracker,
            input.issues,
            input.scheduling,
            mates,
            peopleByName,
            input.rules,
            input.meanPrior,
            inSlot,
            {
              roster: input.people,
              dutyOfficerAlreadyAssigned:
                siblingDutyOfficerAssignee(input.mission, slot, assignments) ??
                undefined,
            },
          );
          lastResort = Boolean(chosen);
        }
      }

      if (!chosen) {
        const tier = coverageFillTier(slot);
        if (tier === "hamagshiyot") {
          warnings.push(
            `${slot.positionName} ${slot.timeLabel} — משבצת ${seatIndex + 1} נשארה פנויה (עדיפות נמוכה)`,
          );
        } else if (tier === "reserve") {
          warnings.push(
            `${slot.positionName} ${slot.timeLabel} — משבצת ${seatIndex + 1} נשארה פנויה (עדיפות נמוכה אחרי חמגשיות)`,
          );
        } else if (input.allowCoverageFill) {
          warnings.push(
            `${slot.positionName} ${slot.timeLabel} — משבצת ${seatIndex + 1}: אין צוער זכאי`,
          );
        }
        continue;
      }

      if (lastResort) {
        const msg = `${chosen.name}: שובץ ב-${slot.positionName} ${slot.timeLabel} תוך שבירת מנוחה של ${input.scheduling.rest_hours} שעות — לא נמצא צוער עם מנוחה מלאה. חפיפה ומרווח עב״ס נשמרו`;
        if (!warnings.includes(msg)) warnings.push(msg);
      }

      if (
        !fitsPerson(
          chosen,
          slot,
          input.tracker,
          input.issues,
          input.scheduling,
          mates,
          peopleByName,
        )
      ) {
        for (const msg of describeAssignmentWarnings(
          chosen,
          slot,
          input.tracker,
          input.issues,
          input.scheduling,
          mates,
          peopleByName,
        )) {
          if (!warnings.includes(msg)) warnings.push(msg);
        }
      }

      inSlot.add(chosen.name);
      placeChosen(slot, seatIndex, chosen);
    }
  }

  return { assignments, filled, warnings };
}

export function buildTrackerFromMissions(
  missions: MissionDay[],
  rules: FairnessRules,
  excludeMissionIds: Set<string> = new Set(),
  constraintPolicy: AssignConstraintPolicy = "standard",
): ScheduleTracker {
  const tracker = createEmptyScheduleTracker(constraintPolicy);

  for (const mission of missions) {
    if (excludeMissionIds.has(mission.id)) continue;
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    for (const slot of flattenMissionSlots(mission)) {
      for (const name of slot.assignees) {
        if (!name) continue;
        placePerson(
          name,
          slot,
          mission.id,
          tracker,
          rules,
          scheduling,
          slot.seatCount,
          mission.mission_type,
        );
      }
    }
  }
  return tracker;
}

export function slotRank(
  slot: FlatSlot,
  rules: FairnessRules,
  eligibleCount?: number,
) {
  if (isStandbyKind(slot.positionKind)) return 1e9;
  if (slot.positionKind === "kitchen") return 500;
  if (isGuardKind(slot.positionKind)) {
    return guardSlotDifficultyRank(slot, eligibleCount ?? 10, rules);
  }
  return pointsForSlot(slot, slot.seatCount, rules) * 100;
}

export function pickBestCandidate(
  candidates: Person[],
  slot: FlatSlot,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  options?: {
    preferHighLoad?: boolean;
    scheduling?: MissionSchedulingRules;
    /** קצין תורן שכבר משובץ באותה עמדה — העדפת הקצין השני */
    dutyOfficerAlreadyAssigned?: string;
    /** Full active roster — enables spread-aware fairness when provided */
    roster?: Person[];
    /** When set, guard seats pick randomly among fairly-ranked candidates */
    randomSeed?: number;
  },
): Person | null {
  if (!candidates.length) return null;
  const preferHigh =
    options?.preferHighLoad ??
    (isStandbyKind(slot.positionKind) && !slot.sameGender);
  const useGuardBurden = isGuardKind(slot.positionKind);
  const scheduling = options?.scheduling;
  const siblingOfficer = options?.dutyOfficerAlreadyAssigned;
  const roster = options?.roster;

  const sorted = [...candidates].sort((a, b) => {
    if (slot.positionKind === "officer_duty" && siblingOfficer) {
      if (a.name === siblingOfficer && b.name !== siblingOfficer) return 1;
      if (b.name === siblingOfficer && a.name !== siblingOfficer) return -1;
    }
    if (roster?.length) {
      const spreadCmp = compareByFairnessThenBurden(
        a,
        b,
        slot,
        roster,
        tracker,
        rules,
        meanPrior,
        scheduling,
        slot.seatCount,
        preferHigh,
      );
      if (spreadCmp !== 0) return spreadCmp;
    } else {
      const wa = useGuardBurden
        ? projectedGuardCandidateScore(a, slot, tracker, rules, meanPrior, scheduling)
        : workScore(a, tracker, rules, meanPrior, scheduling);
      const wb = useGuardBurden
        ? projectedGuardCandidateScore(b, slot, tracker, rules, meanPrior, scheduling)
        : workScore(b, tracker, rules, meanPrior, scheduling);
      const sc = preferHigh ? wb - wa : wa - wb;
      if (sc !== 0) return sc;
    }
    if (useGuardBurden) {
      const ga = personBurdenBreakdown(a.name, tracker, rules, scheduling).guardAssignmentCount;
      const gb = personBurdenBreakdown(b.name, tracker, rules, scheduling).guardAssignmentCount;
      if (ga !== gb) return ga - gb;
    }
    return a.name.localeCompare(b.name, "he");
  });
  if (useGuardBurden && options?.randomSeed != null && roster?.length) {
    return pickStochasticGuardCandidate(sorted, {
      slot,
      roster,
      tracker,
      rules,
      meanPrior,
      scheduling,
      seatCount: slot.seatCount,
      rng: mulberry32((options.randomSeed + slot.slotId.length * 31) >>> 0),
    });
  }
  return sorted[0];
}

export function assignStandbyRoom(
  people: Person[],
  slot: FlatSlot,
  need: number,
  taken: string[],
  tracker: ScheduleTracker,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  rules: FairnessRules,
  meanPrior: number,
  missionId: string,
  missionType: MissionType = slot.missionType,
  options?: { onlyRoom?: string },
): string[] {
  const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
  const fixed = taken.filter(Boolean);
  const byRoom: Record<string, Person[]> = {};
  for (const p of people) {
    if (!p.room) continue;
    if (!byRoom[p.room]) byRoom[p.room] = [];
    byRoom[p.room].push(p);
  }

  const okInRoom = (room: string) =>
    (byRoom[room] || []).filter(
      (p) =>
        !taken.includes(p.name) &&
        fitsPerson(p, slot, tracker, issues, scheduling, fixed, peopleByName),
    );

  let rooms = Object.keys(byRoom).filter((rn) => {
    if (options?.onlyRoom && rn !== options.onlyRoom) return false;
    if (fixed.some((n) => peopleByName[n]?.room && peopleByName[n]?.room !== rn)) {
      return false;
    }
    return okInRoom(rn).length >= need;
  });

  if (!rooms.length) return [];

  rooms.sort((a, b) => {
    const avg = (rn: string) => {
      const pool = byRoom[rn];
      return (
        pool.reduce(
          (s, p) =>
            s +
            workScore(p, tracker, rules, meanPrior, scheduling, "duty"),
          0,
        ) / pool.length
      );
    };
    return avg(a) - avg(b);
  });

  const pool = okInRoom(rooms[0]).sort((a, b) => {
    const cmp = compareByFairnessThenBurden(
      a,
      b,
      slot,
      people,
      tracker,
      rules,
      meanPrior,
      scheduling,
      slot.seatCount,
    );
    if (cmp !== 0) return cmp;
    return a.name.localeCompare(b.name, "he");
  });

  const out: string[] = [];
  for (const p of pool) {
    if (out.length >= need) break;
    if (taken.includes(p.name)) continue;
    if (slot.sameGender && out.length) {
      const ref = peopleByName[out[0]];
      if (ref?.gender && p.gender && ref.gender !== p.gender) continue;
    }
    out.push(p.name);
    placePerson(
      p.name,
      slot,
      missionId,
      tracker,
      rules,
      scheduling,
      slot.seatCount,
      missionType,
    );
  }
  return out;
}

/** שיבוץ משמרת מטבח — תמיד 35, חלוקה יחסית בין צוותים פעילים */
export const PREFERRED_KITCHEN_SHIFTS_PER_DAY = 3;
/** @deprecated use PREFERRED_KITCHEN_SHIFTS_PER_DAY — אין חסימה קשה */
export const MAX_KITCHEN_SHIFTS_PER_DAY = PREFERRED_KITCHEN_SHIFTS_PER_DAY;

export function kitchenShiftsOnMission(
  personName: string,
  tracker: ScheduleTracker,
  missionId: string,
): number {
  return (tracker.busy[personName] || []).filter(
    (b) =>
      b.missionId === missionId &&
      (b.missionType === "kitchen" || b.positionKind === "kitchen"),
  ).length;
}

export function assignKitchenShift(input: {
  people: Person[];
  slot: FlatSlot;
  shiftIndex: number;
  need: number;
  taken: string[];
  tracker: ScheduleTracker;
  issues: Issue[];
  scheduling: MissionSchedulingRules;
  rules: FairnessRules;
  meanPrior: number;
  missionId: string;
  missionType: MissionType;
}): { names: string[]; usedRestSquad: boolean; squadCounts: Record<number, number> } {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const kitchen = input.scheduling.kitchen;
  const restList = kitchen?.squad_rest_by_shift || [1, 2, 3, 4];
  const restSquad = restList[input.shiftIndex % restList.length] ?? (input.shiftIndex % 4) + 1;
  const outNames = resolveKitchenOutNames(kitchen, input.shiftIndex, input.people);
  const explicitOutLists = hasExplicitKitchenOutLists(kitchen);

  const sortedPeople = [...input.people].sort((a, b) =>
    a.name.localeCompare(b.name, "he"),
  );
  const squadOf = (p: Person) =>
    effectiveSquad(p, sortedPeople.findIndex((x) => x.id === p.id));

  const assigned: string[] = [...input.taken];
  const targetTotal = input.taken.length + input.need;
  const squadCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const name of input.taken) {
    const p = peopleByName[name];
    if (p) squadCounts[squadOf(p)] += 1;
  }

  const canPick = (
    p: Person,
    opts?: { ignoreOut?: boolean },
  ) => {
    if (assigned.includes(p.name)) return false;
    if (!opts?.ignoreOut && outNames.has(p.name)) return false;
    return fitsPerson(
      p,
      input.slot,
      input.tracker,
      input.issues,
      input.scheduling,
      assigned,
      peopleByName,
    );
  };

  const pickFromPool = (
    pool: Person[],
    limit: number,
    opts?: { ignoreOut?: boolean },
  ) => {
    let added = 0;
    const sorted = [...pool]
      .filter((p) => canPick(p, opts))
      .sort((a, b) => {
        const ka = kitchenShiftsOnMission(a.name, input.tracker, input.missionId);
        const kb = kitchenShiftsOnMission(b.name, input.tracker, input.missionId);
        const overPreferred = (n: number) =>
          n > PREFERRED_KITCHEN_SHIFTS_PER_DAY ? 1 : 0;
        const pa = overPreferred(ka);
        const pb = overPreferred(kb);
        if (pa !== pb) return pa - pb;
        if (ka !== kb) return ka - kb;
        const cmp = compareByFairnessThenBurden(
          a,
          b,
          input.slot,
          input.people,
          input.tracker,
          input.rules,
          input.meanPrior,
          input.scheduling,
          input.slot.seatCount,
        );
        return cmp || a.name.localeCompare(b.name, "he");
      });
    for (const p of sorted) {
      if (assigned.length >= targetTotal || added >= limit) break;
      assigned.push(p.name);
      squadCounts[squadOf(p)] += 1;
      placePerson(
        p.name,
        input.slot,
        input.missionId,
        input.tracker,
        input.rules,
        input.scheduling,
        input.slot.seatCount,
        input.missionType,
      );
      added += 1;
    }
  };

  const groups = groupPeopleBySquad(sortedPeople, squadOf);

  if (explicitOutLists) {
    pickFromPool(sortedPeople, targetTotal - assigned.length);
  } else {
    const activeSquads = ([1, 2, 3, 4] as const).filter((s) => s !== restSquad);
    const activeSizes = activeSquads.map((s) => groups[s].filter((p) => canPick(p)).length);
    const targets = apportionSeats(Math.max(0, input.need - input.taken.length), activeSizes);

    for (let i = 0; i < activeSquads.length; i++) {
      pickFromPool(groups[activeSquads[i]], targets[i]);
    }

    if (assigned.length < targetTotal) {
      pickFromPool(
        sortedPeople.filter((p) => squadOf(p) !== restSquad),
        targetTotal - assigned.length,
      );
    }

    if (assigned.length < targetTotal) {
      pickFromPool(sortedPeople.filter((p) => !outNames.has(p.name)), targetTotal - assigned.length);
    }
  }

  // מילוי אחרון: אם חסרים מקומות — מאפשרים גם מי שברשימת «בחוץ» (רק חסימות/פטור מטבח)
  if (assigned.length < targetTotal) {
    pickFromPool(sortedPeople, targetTotal - assigned.length, { ignoreOut: true });
  }

  const usedRestSquad = false;

  const names = assigned.slice(input.taken.length);
  return { names, usedRestSquad, squadCounts };
}

/** שיבוץ חלון עב״ס — לפי צדק וזמינות, ללא חלוקה לצוותים */
export type BaseWorkShiftDiagnostics = {
  required: number;
  assigned: number;
  rejectedOverlap: number;
  rejectedIssue: number;
  rejectedIneligible: number;
  rejectedRest: number;
  rejectedGuardRatio: number;
  rejectedOther: number;
};

function classifyCandidateRejection(
  person: Person,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  mates: string[],
  peopleByName: Record<string, Person>,
): keyof Omit<BaseWorkShiftDiagnostics, "required" | "assigned"> | null {
  const code = explainFitsPersonFailure(
    person,
    slot,
    tracker,
    issues,
    scheduling,
    mates,
    peopleByName,
  );
  if (!code) return null;
  if (code === "canAssignKind") return "rejectedIneligible";
  if (code === "blockedByIssue") return "rejectedIssue";
  if (code === "overlapsSlot") return "rejectedOverlap";
  if (code === "guardOk") return "rejectedGuardRatio";
  if (code === "restOk" || code === "guardRestGap") return "rejectedRest";
  return "rejectedOther";
}

export function formatBaseWorkDiagnostics(
  slotLabel: string,
  diagnostics: BaseWorkShiftDiagnostics,
): string {
  const lines = [
    `${slotLabel}:`,
    `required: ${diagnostics.required}`,
    `assigned: ${diagnostics.assigned}`,
  ];
  if (diagnostics.rejectedOverlap) lines.push(`- ${diagnostics.rejectedOverlap} overlapping assignment`);
  if (diagnostics.rejectedIssue) lines.push(`- ${diagnostics.rejectedIssue} approved issue`);
  if (diagnostics.rejectedIneligible) lines.push(`- ${diagnostics.rejectedIneligible} unavailable`);
  if (diagnostics.rejectedRest) lines.push(`- ${diagnostics.rejectedRest} rest constraint`);
  if (diagnostics.rejectedGuardRatio) {
    lines.push(`- ${diagnostics.rejectedGuardRatio} guard-ratio constraint`);
  }
  if (diagnostics.rejectedOther) lines.push(`- ${diagnostics.rejectedOther} other constraint`);
  return lines.join("\n");
}

export function assignBaseWorkShift(input: {
  people: Person[];
  slot: FlatSlot;
  shiftIndex: number;
  tracker: ScheduleTracker;
  issues: Issue[];
  scheduling: MissionSchedulingRules;
  rules: FairnessRules;
  meanPrior: number;
  missionId: string;
  missionType: MissionType;
  taken: string[];
}): {
  names: string[];
  diagnostics: BaseWorkShiftDiagnostics;
} {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const cfg = input.scheduling.base_work;
  const configuredTarget =
    cfg?.seats_per_shift ?? DEFAULT_BASE_WORK_SCHEDULING_RULES.seats_per_shift;
  const target = clampBaseWorkSeatsPerShift(
    input.slot.seatCount || configuredTarget,
  );
  const diagnostics: BaseWorkShiftDiagnostics = {
    required: target,
    assigned: input.taken.length,
    rejectedOverlap: 0,
    rejectedIssue: 0,
    rejectedIneligible: 0,
    rejectedRest: 0,
    rejectedGuardRatio: 0,
    rejectedOther: 0,
  };

  const sortedPeople = [...input.people].sort((a, b) =>
    a.name.localeCompare(b.name, "he"),
  );

  const countRejection = (person: Person, mates: string[]) => {
    const reason = classifyCandidateRejection(
      person,
      input.slot,
      input.tracker,
      input.issues,
      input.scheduling,
      mates,
      peopleByName,
    );
    if (reason) diagnostics[reason] += 1;
  };

  const fitsCandidate = (person: Person, mates: string[]) =>
    classifyCandidateRejection(
      person,
      input.slot,
      input.tracker,
      input.issues,
      input.scheduling,
      mates,
      peopleByName,
    ) === null;

  const need = Math.max(0, target - input.taken.length);

  const sortByFairness = (pool: Person[]) =>
    [...pool].sort((a, b) => {
      const cmp = compareByFairnessThenBurden(
        a,
        b,
        input.slot,
        input.people,
        input.tracker,
        input.rules,
        input.meanPrior,
        input.scheduling,
        input.slot.seatCount,
      );
      return cmp || a.name.localeCompare(b.name, "he");
    });

  const assigned: string[] = [];
  const tryAdd = (person: Person) => {
    const mates = [...input.taken, ...assigned];
    if (!fitsCandidate(person, mates)) {
      countRejection(person, mates);
      return false;
    }
    assigned.push(person.name);
    placePerson(
      person.name,
      input.slot,
      input.missionId,
      input.tracker,
      input.rules,
      input.scheduling,
      input.slot.seatCount,
      input.missionType,
    );
    return true;
  };

  for (const p of sortByFairness(
    sortedPeople.filter(
      (person) => !input.taken.includes(person.name) && !assigned.includes(person.name),
    ),
  )) {
    if (assigned.length >= need) break;
    tryAdd(p);
  }

  diagnostics.assigned = input.taken.length + assigned.length;
  return { names: assigned, diagnostics };
}

export type SlotAssignmentCheck =
  | { ok: true }
  | { ok: false; reason: string };

function assignmentFailureMessage(
  personName: string,
  slot: FlatSlot,
  code: string | null,
): string | null {
  if (!code) return null;
  if (code === "canAssignKind") return `${personName}: לא זכאי ל«${slot.positionName}»`;
  if (code === "blockedByIssue") return `${personName}: חסימה מאושרת`;
  if (code === "overlapsSlot") return `${personName}: חפיפה עם משמרת אחרת`;
  if (code === "guardOk") return `${personName}: מרווח שמירות לא מתקיים`;
  if (code === "sameRoom") return `${personName}: לא אותו חדר`;
  if (code === "sameGender") return `${personName}: לא אותו מגדר`;
  if (code === "restOk") return `${personName}: מנוחה לא מספקת`;
  return `${personName}: לא עומד בכללים`;
}

/** Full hard-rule check for assigning `person` to a seat (optionally replacing someone). */
export function canAssignPersonToSlot(input: {
  missions: MissionDay[];
  rules: FairnessRules;
  missionId: string;
  slot: FlatSlot;
  seatIndex: number;
  person: Person;
  issues: Issue[];
  peopleByName: Record<string, Person>;
  replaceName?: string | null;
}): SlotAssignmentCheck {
  const mission = input.missions.find((m) => m.id === input.missionId);
  if (!mission) return { ok: false, reason: "משימה לא נמצאה" };

  const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
  const tracker = buildTrackerFromMissions(input.missions, input.rules);
  const currentHolder =
    input.replaceName !== undefined
      ? input.replaceName
      : mission.assignments[input.slot.slotId]?.[input.seatIndex] || null;

  if (currentHolder) {
    unplacePerson(
      currentHolder,
      input.slot,
      input.missionId,
      tracker,
      input.rules,
      scheduling,
    );
  }

  const mates = (mission.assignments[input.slot.slotId] || []).filter(
    (n, i) =>
      Boolean(n) &&
      i !== input.seatIndex &&
      n !== input.person.name &&
      n !== currentHolder,
  );

  if (
    (mission.assignments[input.slot.slotId] || []).some(
      (n, i) => n === input.person.name && i !== input.seatIndex,
    )
  ) {
    return { ok: false, reason: `${input.person.name}: כבר משובצ/ת במשמרת זו` };
  }

  if (
    !fitsPerson(
      input.person,
      input.slot,
      tracker,
      input.issues,
      scheduling,
      mates,
      input.peopleByName,
    )
  ) {
    const why = explainFitsPersonFailure(
      input.person,
      input.slot,
      tracker,
      input.issues,
      scheduling,
      mates,
      input.peopleByName,
    );
    return {
      ok: false,
      reason:
        assignmentFailureMessage(input.person.name, input.slot, why) ??
        `${input.person.name}: לא עומד בכללי השיבוץ`,
    };
  }
  return { ok: true };
}

/** Validate a two-person swap before applying. */
export function canSwapReplacementAssignments(input: {
  missions: MissionDay[];
  rules: FairnessRules;
  missionId: string;
  slot: FlatSlot;
  seatIndex: number;
  removeName: string;
  swapMissionId: string;
  swapSlot: FlatSlot;
  swapSeatIndex: number;
  swapPerson: Person;
  issues: Issue[];
  peopleByName: Record<string, Person>;
}): SlotAssignmentCheck {
  const mission = input.missions.find((m) => m.id === input.missionId);
  const swapMission = input.missions.find((m) => m.id === input.swapMissionId);
  if (!mission || !swapMission) return { ok: false, reason: "משימה לא נמצאה" };

  const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
  const swapScheduling = normalizeSchedulingRules(swapMission.scheduling_rules);
  const tracker = buildTrackerFromMissions(input.missions, input.rules);

  unplacePerson(
    input.removeName,
    input.slot,
    input.missionId,
    tracker,
    input.rules,
    scheduling,
  );
  unplacePerson(
    input.swapPerson.name,
    input.swapSlot,
    input.swapMissionId,
    tracker,
    input.rules,
    swapScheduling,
  );

  const removePerson = input.peopleByName[input.removeName];
  if (!removePerson) {
    return { ok: false, reason: `${input.removeName}: לא נמצא במחזור` };
  }

  const targetMates = (mission.assignments[input.slot.slotId] || []).filter(
    (n, i) =>
      Boolean(n) &&
      i !== input.seatIndex &&
      n !== input.swapPerson.name &&
      n !== input.removeName,
  );
  const swapMates = (swapMission.assignments[input.swapSlot.slotId] || []).filter(
    (n, i) =>
      Boolean(n) &&
      i !== input.swapSeatIndex &&
      n !== input.swapPerson.name &&
      n !== input.removeName,
  );

  if (
    !fitsPerson(
      input.swapPerson,
      input.slot,
      tracker,
      input.issues,
      scheduling,
      targetMates,
      input.peopleByName,
    )
  ) {
    const why = explainFitsPersonFailure(
      input.swapPerson,
      input.slot,
      tracker,
      input.issues,
      scheduling,
      targetMates,
      input.peopleByName,
    );
    return {
      ok: false,
      reason:
        assignmentFailureMessage(input.swapPerson.name, input.slot, why) ??
        `${input.swapPerson.name}: לא יכול לקחת את המשמרת`,
    };
  }

  if (
    !fitsPerson(
      removePerson,
      input.swapSlot,
      tracker,
      input.issues,
      swapScheduling,
      swapMates,
      input.peopleByName,
    )
  ) {
    const why = explainFitsPersonFailure(
      removePerson,
      input.swapSlot,
      tracker,
      input.issues,
      swapScheduling,
      swapMates,
      input.peopleByName,
    );
    return {
      ok: false,
      reason:
        assignmentFailureMessage(removePerson.name, input.swapSlot, why) ??
        `${input.removeName}: לא יכול לקחת את משמרת ההחלפה`,
    };
  }

  return { ok: true };
}

export function replacementBurdenLabel(bucket: FairnessBurdenBucket): string {
  return bucket === "kitchen" ? "עומס תורנות" : "עומס שמירה";
}

const REPLACEMENT_DIRECT_LIMIT = 12;
const REPLACEMENT_SWAP_LIMIT = 200;

/** lower = better swap suggestion (adjacent / same post preferred) */
function swapReplacementCost(
  target: FlatSlot,
  other: FlatSlot,
  swapPerson: Person,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  scheduling: MissionSchedulingRules,
  burdenBucket: FairnessBurdenBucket,
): number {
  const gapMs = Math.min(
    Math.abs(other.startAtMs - target.endAtMs),
    Math.abs(target.startAtMs - other.endAtMs),
  );
  let cost = 0;
  if (target.positionId === other.positionId) cost -= 30;
  else if (target.positionName === other.positionName) cost -= 20;
  else if (target.positionKind === other.positionKind) cost -= 8;
  if (gapMs === 0) cost -= 40;
  else if (gapMs <= 90 * 60 * 1000) cost -= 15;
  cost += Math.abs(other.durationMinutes - target.durationMinutes) / 60;
  if (target.positionKind !== other.positionKind) cost += 2;
  cost +=
    workScore(swapPerson, tracker, rules, meanPrior, scheduling, burdenBucket) / 100;
  return cost;
}

export function findReplacements(input: {
  missions: MissionDay[];
  people: Person[];
  issues: Issue[];
  rules: FairnessRules;
  missionId: string;
  slotId: string;
  seatIndex: number;
  removeName: string;
  mode: "replace" | "swap";
}): ReplacementOption[] {
  const mission =
    resolveMissionForSlot(input.missions, input.missionId, input.slotId) ??
    input.missions.find((m) => m.id === input.missionId);
  if (!mission) return [];

  const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
  const slots = flattenMissionSlots(mission);
  const target = slots.find((s) => s.slotId === input.slotId);
  if (!target) return [];

  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const meanPrior =
    input.people.reduce((s, p) => s + (p.prior_score || 0), 0) /
    (input.people.length || 1);

  const tracker = buildTrackerFromMissions(input.missions, input.rules);
  const removeBlocks = (tracker.busy[input.removeName] || []).filter(
    (b) => !(b.missionId === mission.id && b.slotId === input.slotId),
  );
  tracker.busy[input.removeName] = removeBlocks;
  rebuildGuardShiftsForPerson(input.removeName, tracker);

  const mates = (mission.assignments[input.slotId] || []).filter(
    (n, i) => n && i !== input.seatIndex,
  );

  const burdenBucket = fairnessBurdenBucketForSlot(target);
  const burdenLabel = replacementBurdenLabel(burdenBucket);

  const options: ReplacementOption[] = [];

  if (input.mode === "replace") {
    for (const p of input.people) {
      if (p.name === input.removeName) continue;
      if ((mission.assignments[input.slotId] || []).includes(p.name)) continue;
      if (
        !fitsPerson(p, target, tracker, input.issues, scheduling, mates, peopleByName)
      ) {
        continue;
      }
      const cost = workScore(
        p,
        tracker,
        input.rules,
        meanPrior,
        scheduling,
        burdenBucket,
      );
      options.push({
        type: "direct",
        personName: p.name,
        cost,
        label: `${p.name} — ${burdenLabel} (${cost.toFixed(1)} נק׳)`,
      });
    }
    options.sort((a, b) => a.cost - b.cost);
    return options.slice(0, REPLACEMENT_DIRECT_LIMIT);
  }

  const seen = new Set<string>();

  for (const otherMission of input.missions) {
    for (const otherSlot of flattenMissionSlots(otherMission)) {
      const arr = otherMission.assignments[otherSlot.slotId] || [];
      for (let oi = 0; oi < arr.length; oi++) {
        const swapName = arr[oi]?.trim();
        if (!swapName || swapName === input.removeName) continue;
        if (otherMission.id === mission.id && otherSlot.slotId === input.slotId && oi === input.seatIndex) {
          continue;
        }

        const swapPerson = peopleByName[swapName];
        if (!swapPerson) continue;

        const dedupeKey = `${otherMission.id}:${otherSlot.slotId}:${oi}`;
        if (seen.has(dedupeKey)) continue;

        const check = canSwapReplacementAssignments({
          missions: input.missions,
          rules: input.rules,
          missionId: mission.id,
          slot: target,
          seatIndex: input.seatIndex,
          removeName: input.removeName,
          swapMissionId: otherMission.id,
          swapSlot: otherSlot,
          swapSeatIndex: oi,
          swapPerson,
          issues: input.issues,
          peopleByName,
        });
        seen.add(dedupeKey);

        if (!check.ok) {
          options.push({
            type: "swap",
            personName: swapPerson.name,
            cost: 1e9,
            label: `${swapPerson.name} ↔ ${input.removeName}: ${otherSlot.positionName} ${otherSlot.timeLabel} ⚠`,
            ruleViolation: check.reason,
            swapMissionId: otherMission.id,
            swapSlotId: otherSlot.slotId,
            swapSeatIndex: oi,
            swapLabel: `${otherSlot.positionName} ${otherSlot.timeLabel}`,
          });
          continue;
        }

        const perRemove = buildTrackerFromMissions(input.missions, input.rules);
        unplacePerson(
          input.removeName,
          target,
          mission.id,
          perRemove,
          input.rules,
          scheduling,
        );
        unplacePerson(
          swapPerson.name,
          otherSlot,
          otherMission.id,
          perRemove,
          input.rules,
          normalizeSchedulingRules(otherMission.scheduling_rules),
        );

        const cost = swapReplacementCost(
          target,
          otherSlot,
          swapPerson,
          perRemove,
          input.rules,
          meanPrior,
          scheduling,
          burdenBucket,
        );

        options.push({
          type: "swap",
          personName: swapPerson.name,
          cost,
          label: `${swapPerson.name} ↔ ${input.removeName}: ${otherSlot.positionName} ${otherSlot.timeLabel}`,
          swapMissionId: otherMission.id,
          swapSlotId: otherSlot.slotId,
          swapSeatIndex: oi,
          swapLabel: `${otherSlot.positionName} ${otherSlot.timeLabel}`,
        });
      }
    }
  }

  options.sort((a, b) => a.cost - b.cost);
  return options.slice(0, REPLACEMENT_SWAP_LIMIT);
}

function blockLabel(block: BusyBlock): string {
  if (block.positionKind === "standby_carmel_a") return "כרמל א׳";
  if (block.positionKind === "standby_carmel_b") return "כרמל ב׳";
  if (
    isBaseWorkAssignment(block.positionKind, block.missionType, {
      positionName: block.positionName,
      startTime: block.startTime,
      endTime: block.endTime,
    })
  ) {
    return block.positionName?.includes("עב") ? block.positionName : "עב״ס";
  }
  return block.positionKind;
}

/** Structural roster issues that are not tied to a single assignee. */
function collectStructuralRosterWarnings(mission: MissionDay): string[] {
  const slots = flattenMissionSlots(mission);
  const messages: string[] = [];

  const namesBySlotId = new Map<string, string[]>();
  for (const slot of slots) {
    const names = namesBySlotId.get(slot.slotId) || [];
    names.push(slot.positionName);
    namesBySlotId.set(slot.slotId, names);
  }
  for (const [, names] of namesBySlotId) {
    if (names.length > 1) {
      messages.push(`מזהה משמרת משותף בין עמדות: ${names.join(" · ")}`);
    }
  }

  const carmelA = slots.find((s) => s.positionKind === "standby_carmel_a");
  const carmelB = slots.find((s) => s.positionKind === "standby_carmel_b");
  if (carmelA && carmelB) {
    const setA = new Set((mission.assignments[carmelA.slotId] || []).filter(Boolean));
    const shared = (mission.assignments[carmelB.slotId] || []).filter(
      (n) => n && setA.has(n),
    );
    if (shared.length) {
      messages.push(`כרמל א׳ וב׳ — אותם צוערים: ${shared.join(", ")}`);
    }
  }

  for (const slot of slots) {
    const seats = mission.assignments[slot.slotId] || [];
    const filled = seats.filter(Boolean);
    if (slot.seatCount > 0 && filled.length !== slot.seatCount) {
      messages.push(
        `${slot.positionName} ${slot.timeLabel}: כיסוי ${filled.length}/${slot.seatCount}`,
      );
    }
  }

  return messages;
}

export type CollectRosterWarningsInput = {
  missions: MissionDay[];
  peopleByName: Record<string, Person>;
  issues?: Issue[];
  /** When set, emit per-person warnings only for these missions (others are rest/gap context). */
  focusMissionIds?: string[];
};

/** Admin board warnings — rest, approved blocks, overlaps, coverage, eligibility. */
export function collectRosterWarnings(input: CollectRosterWarningsInput): string[] {
  const peopleByName = input.peopleByName;
  const focusIds = input.focusMissionIds?.length
    ? new Set(input.focusMissionIds)
    : null;
  const issues = (input.issues ?? []).filter((row) => row.status === "approved");
  const messages: string[] = [
    ...validateNoPersonOverlaps(input.missions, focusIds ?? undefined),
    ...validateShortRestGaps(input.missions, focusIds ?? undefined),
  ];

  for (const mission of input.missions) {
    if (focusIds && !focusIds.has(mission.id)) continue;
    messages.push(...collectStructuralRosterWarnings(mission));
  }

  const entries: Array<{
    mission: MissionDay;
    slot: FlatSlot;
    names: string[];
  }> = [];

  for (const mission of input.missions) {
    for (const slot of flattenMissionSlots(mission)) {
      const names = (mission.assignments[slot.slotId] || []).filter(Boolean);
      if (!names.length) continue;
      entries.push({ mission, slot, names });
    }
  }

  entries.sort(
    (a, b) =>
      a.slot.sortKey - b.slot.sortKey ||
      a.mission.id.localeCompare(b.mission.id),
  );

  const tracker: ScheduleTracker = createEmptyScheduleTracker();
  const rules = VALIDATION_FAIRNESS_RULES;
  const hasPeople = Object.keys(peopleByName).length > 0;

  for (const { mission, slot, names } of entries) {
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    const emitWarnings = !focusIds || focusIds.has(mission.id);
    for (let seatIndex = 0; seatIndex < names.length; seatIndex++) {
      const name = names[seatIndex];
      const person = peopleByName[name];
      if (emitWarnings) {
        if (!person) {
          if (hasPeople) messages.push(`${name}: לא נמצא במחזור`);
          messages.push(
            ...collectSpacingAndRestWarnings(name, slot, tracker, scheduling),
          );
        } else {
          const mates = names.filter((n, idx) => n && idx !== seatIndex);
          messages.push(
            ...describeAssignmentWarnings(
              person,
              slot,
              tracker,
              issues,
              scheduling,
              mates,
              peopleByName,
            ),
          );
        }
      }
      placePerson(
        name,
        slot,
        mission.id,
        tracker,
        rules,
        scheduling,
        slot.seatCount,
        mission.mission_type,
      );
    }
  }

  return prioritizeGapWarnings(messages);
}

/** בדיקה אחרי כל חלוקה — כל חפיפה וכל מנוחה קצרה מהרגיל, בלי לפספס פער קטן. */
export function auditAssignedRoster(input: CollectRosterWarningsInput): string[] {
  return collectRosterWarnings(input);
}

function prioritizeGapWarnings(messages: string[]): string[] {
  const unique = [...new Set(messages)];
  const overlap = unique.filter((m) => m.includes("חפיפה"));
  const rest = unique.filter(
    (m) => !m.includes("חפיפה") && (m.includes("מנוחה") || m.includes("מרווח")),
  );
  const other = unique.filter((m) => !overlap.includes(m) && !rest.includes(m));
  return [...overlap, ...rest, ...other];
}

/** מוצא שיבוצים סותרים (חפיפות, מזהה משמרת כפול, כרמל א׳/ב׳ זהים, זכאות לתפקיד, אילוצים) */
export function findAssignmentConflicts(
  mission: MissionDay,
  peopleByName?: Record<string, Person>,
  issues: Issue[] = [],
): string[] {
  const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
  const slots = flattenMissionSlots(mission);
  const messages: string[] = [];

  const namesBySlotId = new Map<string, string[]>();
  for (const slot of slots) {
    const names = namesBySlotId.get(slot.slotId) || [];
    names.push(slot.positionName);
    namesBySlotId.set(slot.slotId, names);
  }
  for (const [, names] of namesBySlotId) {
    if (names.length > 1) {
      messages.push(`מזהה משמרת משותף בין עמדות: ${names.join(" · ")}`);
    }
  }

  const carmelA = slots.find((s) => s.positionKind === "standby_carmel_a");
  const carmelB = slots.find((s) => s.positionKind === "standby_carmel_b");
  if (carmelA && carmelB) {
    const setA = new Set((mission.assignments[carmelA.slotId] || []).filter(Boolean));
    const shared = (mission.assignments[carmelB.slotId] || []).filter(
      (n) => n && setA.has(n),
    );
    if (shared.length) {
      messages.push(`כרמל א׳ וב׳ — אותם צוערים: ${shared.join(", ")}`);
    }
  }

  const tracker: ScheduleTracker = createEmptyScheduleTracker();
  const rules = VALIDATION_FAIRNESS_RULES;
  const orderedSlots = [...slots].sort(
    (a, b) => a.sortKey - b.sortKey || a.slotId.localeCompare(b.slotId),
  );

  messages.push(...validateNoPersonOverlaps([mission]));
  messages.push(...validateShortRestGaps([mission]));

  for (const slot of orderedSlots) {
    const seats = mission.assignments[slot.slotId] || [];
    for (let seatIndex = 0; seatIndex < seats.length; seatIndex++) {
      const name = seats[seatIndex];
      if (!name) continue;
      const mates = seats.filter((n, i) => n && i !== seatIndex);
      const person = peopleByName?.[name];
      if (!person) {
        if (peopleByName) messages.push(`${name}: לא נמצא במחזור`);
        messages.push(
          ...collectSpacingAndRestWarnings(name, slot, tracker, scheduling),
        );
      } else {
        messages.push(
          ...describeAssignmentWarnings(
            person,
            slot,
            tracker,
            issues,
            scheduling,
            mates,
            peopleByName,
          ),
        );
      }
      placePerson(
        name,
        slot,
        mission.id,
        tracker,
        rules,
        scheduling,
        slot.seatCount,
        mission.mission_type,
      );
    }
  }

  return prioritizeGapWarnings(messages);
}

type LabeledInterval = {
  startMs: number;
  endMs: number;
  startTime: string;
  endTime: string;
};

type TrackedAssignment = LabeledInterval & {
  label: string;
  slotId: string;
  missionId: string;
  positionKind: MissionPositionKind;
  missionType: MissionType;
  positionName: string;
  restHours: number;
  dutyGuardGapMin: number;
};

function labeledInterval(block: {
  startMs: number;
  endMs: number;
  startTime: string;
  endTime: string;
}): LabeledInterval {
  return {
    startMs: block.startMs,
    endMs: block.endMs,
    startTime: block.startTime,
    endTime: block.endTime,
  };
}

function assignmentMetaOf(a: TrackedAssignment): AssignmentOverlapMeta {
  return {
    positionName: a.positionName,
    startTime: a.startTime,
    endTime: a.endTime,
  };
}

function trackedIsAbas(a: TrackedAssignment): boolean {
  return isBaseWorkAssignment(a.positionKind, a.missionType, assignmentMetaOf(a));
}

function collectTrackedAssignments(
  missions: MissionDay[],
): Map<string, TrackedAssignment[]> {
  const byPerson = new Map<string, TrackedAssignment[]>();
  for (const mission of missions) {
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    for (const slot of flattenMissionSlots(mission)) {
      const seats = mission.assignments[slot.slotId] || [];
      for (const raw of seats) {
        const name = String(raw || "").trim();
        if (!name) continue;
        const list = byPerson.get(name) || [];
        list.push({
          label: `${slot.positionName} ${slot.timeLabel}`,
          startMs: slot.startAtMs,
          endMs: slot.endAtMs,
          slotId: slot.slotId,
          missionId: mission.id,
          positionKind: slot.positionKind,
          missionType: slot.missionType,
          positionName: slot.positionName,
          startTime: slot.startTime,
          endTime: slot.endTime,
          restHours: scheduling.rest_hours,
          dutyGuardGapMin: dutyGuardGapMinutes(scheduling),
        });
        byPerson.set(name, list);
      }
    }
  }
  return byPerson;
}

function pairInFocus(
  a: TrackedAssignment,
  b: TrackedAssignment,
  focusMissionIds?: Set<string>,
): boolean {
  if (!focusMissionIds) return true;
  // חפיפת עב״ס תמיד מדווחת — גם אם המשימה המקושרת הוסתרה מהלוח.
  if (trackedIsAbas(a) || trackedIsAbas(b)) return true;
  return focusMissionIds.has(a.missionId) || focusMissionIds.has(b.missionId);
}

function wallMinuteRanges(startTime: string, endTime: string): Array<[number, number]> {
  const start = parseTimeMinutes(startTime);
  const dur = slotDurationMinutes(startTime, endTime);
  if (start === null || dur <= 0) return [];
  return [
    [start - 1440, start + dur - 1440],
    [start, start + dur],
    [start + 1440, start + dur + 1440],
  ];
}

function labeledMinutesOverlap(a: LabeledInterval, b: LabeledInterval): boolean {
  for (const [a0, a1] of wallMinuteRanges(a.startTime, a.endTime)) {
    for (const [b0, b1] of wallMinuteRanges(b.startTime, b.endTime)) {
      if (a0 < b1 && b0 < a1) return true;
    }
  }
  return false;
}

function visibleTimeOverlap(a: LabeledInterval, b: LabeledInterval): boolean {
  if (
    assignmentIntervalsOverlap(
      { startMs: a.startMs, endMs: a.endMs },
      { startMs: b.startMs, endMs: b.endMs },
    )
  ) {
    return true;
  }
  if (!labeledMinutesOverlap(a, b)) return false;
  const startGapMs = Math.abs(a.startMs - b.startMs);
  // אותו בוקר / ערב — תוויות שעון חופפות גם אם ISO ישן פיצל אותן.
  if (startGapMs < 16 * 60 * 60 * 1000) return true;
  // ~יום אחד הפרש עם שעות התחלה שונות: כנראה ISO ישן הזיז משמרת ליום הבא.
  if (startGapMs > 32 * 60 * 60 * 1000) return false;
  return a.startTime !== b.startTime;
}

function labeledIdleMinutes(a: LabeledInterval, b: LabeledInterval): number | null {
  if (labeledMinutesOverlap(a, b)) return null;
  const a0 = parseTimeMinutes(a.startTime);
  const b0 = parseTimeMinutes(b.startTime);
  const aDur = slotDurationMinutes(a.startTime, a.endTime);
  const bDur = slotDurationMinutes(b.startTime, b.endTime);
  if (a0 === null || b0 === null || aDur <= 0 || bDur <= 0) return null;
  const a1 = a0 + aDur;
  const b1 = b0 + bDur;
  if (a0 < b1 && b0 < a1) return null;
  if (a1 <= b0) return b0 - a1;
  return a0 - b1;
}

function visibleIdleMinutes(a: LabeledInterval, b: LabeledInterval): number | null {
  if (visibleTimeOverlap(a, b)) return null;
  const abs = idleGapMinutes(
    { startMs: a.startMs, endMs: a.endMs },
    { startMs: b.startMs, endMs: b.endMs },
  );
  const startGapMs = Math.abs(a.startMs - b.startMs);
  if (startGapMs >= 16 * 60 * 60 * 1000) return abs;
  const wall = labeledIdleMinutes(a, b);
  if (wall == null) return abs;
  if (abs == null) return wall;
  return Math.min(abs, wall);
}

function sameAssignmentRow(a: TrackedAssignment, b: TrackedAssignment): boolean {
  return (
    a.slotId === b.slotId &&
    a.missionId === b.missionId &&
    a.positionName === b.positionName &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime
  );
}

function overlapWarningText(person: string, a: TrackedAssignment, b: TrackedAssignment): string {
  const aAbas = isBaseWorkAssignment(a.positionKind, a.missionType, {
    positionName: a.positionName,
    startTime: a.startTime,
    endTime: a.endTime,
  });
  const bAbas = isBaseWorkAssignment(b.positionKind, b.missionType, {
    positionName: b.positionName,
    startTime: b.startTime,
    endTime: b.endTime,
  });
  const kind = aAbas || bAbas ? "חפיפה עב״ס" : "חפיפה";
  return `${kind}: ${person} — ${a.label} ∩ ${b.label}`;
}

/** Global validator — every person must have zero overlapping assignment pairs. */
export function validateNoPersonOverlaps(
  missions: MissionDay[],
  focusMissionIds?: Set<string>,
): string[] {
  const byPerson = collectTrackedAssignments(missions);
  const messages: string[] = [];
  for (const [person, blocks] of byPerson) {
    const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (sameAssignmentRow(a, b)) continue;
        if (!pairInFocus(a, b, focusMissionIds)) continue;
        if (
          carmelBlocksAbas(
            a.positionKind,
            a.missionType,
            b.positionKind,
            b.missionType,
            assignmentMetaOf(a),
            assignmentMetaOf(b),
          )
        ) {
          messages.push(
            `חפיפה עב״ס: ${person} — ${a.label} ∩ ${b.label} (כרמל א׳ חוסם עב״ס לכל היום)`,
          );
          continue;
        }
        if (
          allowsParallelAssignmentOverlap(
            a.positionKind,
            a.missionType,
            b.positionKind,
            b.missionType,
            assignmentMetaOf(a),
            assignmentMetaOf(b),
          )
        ) {
          continue;
        }
        if (visibleTimeOverlap(a, b)) {
          messages.push(overlapWarningText(person, a, b));
        }
      }
    }
  }
  return messages;
}

/** Pairwise rest/gap audit — לא תלוי בסדר שיבוץ. גם דקה אחת מתחת לנדרש. */
export function validateShortRestGaps(
  missions: MissionDay[],
  focusMissionIds?: Set<string>,
): string[] {
  const byPerson = collectTrackedAssignments(missions);
  const messages: string[] = [];
  for (const [person, blocks] of byPerson) {
    const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (sameAssignmentRow(a, b)) continue;
        if (!pairInFocus(a, b, focusMissionIds)) continue;
        if (
          allowsParallelAssignmentOverlap(
            a.positionKind,
            a.missionType,
            b.positionKind,
            b.missionType,
            assignmentMetaOf(a),
            assignmentMetaOf(b),
          )
        ) {
          continue;
        }
        if (visibleTimeOverlap(a, b)) continue;
        const idle = visibleIdleMinutes(a, b);
        if (idle == null) continue;
        const restHours = Math.max(a.restHours, b.restHours);
        const restMin = Math.max(0, restHours) * 60;
        const gapMin = Math.max(a.dutyGuardGapMin, b.dutyGuardGapMin);
        const aGuard = isRestConstrainedGuardKind(a.positionKind);
        const bGuard = isRestConstrainedGuardKind(b.positionKind);
        const aAbas = trackedIsAbas(a);
        const bAbas = trackedIsAbas(b);
        const abasGuard = (aAbas && bGuard) || (bAbas && aGuard);

        if (aGuard && bGuard && restMin > 0 && idle < restMin) {
          messages.push(
            `${person}: מנוחה ${formatHoursFromMinutes(idle)} שעות בין שמירות ${a.startTime}–${a.endTime} ו-${b.startTime}–${b.endTime} (נדרש ${restHours})`,
          );
        }
        if (abasGuard && restMin > 0 && idle < restMin) {
          const abas = aAbas ? a : b;
          const guard = aGuard ? a : b;
          messages.push(
            `${person}: מנוחה ${formatHoursFromMinutes(idle)} שעות בין עב״ס ${abas.startTime}–${abas.endTime} לשמירה ${guard.startTime}–${guard.endTime} (נדרש ${restHours})`,
          );
        }
        if (abasGuard && idle < gapMin) {
          const abas = aAbas ? a : b;
          const guard = aGuard ? a : b;
          messages.push(
            `${person}: מרווח ${Math.round(idle)} דק׳ בין עב״ס ${abas.startTime}–${abas.endTime} לשמירה ${guard.startTime}–${guard.endTime} (נדרש ${gapMin})`,
          );
        }
      }
    }
  }
  return messages;
}

export type ValidateGeneratedRosterInput = {
  missions: MissionDay[];
  issues?: Issue[];
  peopleByName?: Record<string, Person>;
};

/** Final validation before accepting an auto-generated roster. */
export function validateGeneratedRoster(input: ValidateGeneratedRosterInput): string[] {
  const messages: string[] = [
    ...validateNoPersonOverlaps(input.missions),
    ...validateShortRestGaps(input.missions),
  ];

  const issues = input.issues ?? [];
  const peopleByName = input.peopleByName ?? {};
  const rules = VALIDATION_FAIRNESS_RULES;
  const tracker: ScheduleTracker = createEmptyScheduleTracker();

  for (const mission of input.missions) {
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    const missionStartMs = Date.parse(mission.starts_at);
    const missionEndMs = Date.parse(mission.ends_at);

    for (const slot of flattenMissionSlots(mission)) {
      if (slot.startAtMs >= slot.endAtMs) {
        messages.push(`${slot.positionName} ${slot.timeLabel}: start >= end`);
      }
      if (
        !slotUsesWallClockSchedule(slot) &&
        (slot.startAtMs < missionStartMs || slot.endAtMs > missionEndMs)
      ) {
        messages.push(`${slot.positionName} ${slot.timeLabel}: outside mission interval`);
      }

      const seats = mission.assignments[slot.slotId] || [];
      const filled = seats.filter(Boolean);
      if (slot.seatCount > 0 && filled.length !== slot.seatCount) {
        messages.push(
          `${slot.positionName} ${slot.timeLabel}: coverage ${filled.length}/${slot.seatCount}`,
        );
      }

      const unique = new Set(filled);
      if (unique.size !== filled.length) {
        messages.push(`${slot.positionName} ${slot.timeLabel}: duplicate assignee in slot`);
      }

      for (const name of filled) {
        if (!name) continue;
        const person = peopleByName[name];
        if (person && !canAssignKind(person, slot.positionKind, assignKindContext(slot))) {
          messages.push(ineligibilityMessage(person, slot));
        }
        if (blockedByIssue(name, slot, issues)) {
          messages.push(issueBlockMessage(name, slot));
        }
        if (overlapsSlot(name, slot, tracker, scheduling)) {
          messages.push(`${name}: illegal overlap at ${slot.positionName} ${slot.timeLabel}`);
        }
        if (
          isRestConstrainedGuardKind(slot.positionKind) &&
          !guardOk(name, slot, tracker, effectiveGuardRatio(scheduling))
        ) {
          messages.push(`${name}: guard ratio violated at ${slot.timeLabel}`);
        }
        placePerson(name, slot, mission.id, tracker, rules, scheduling, slot.seatCount, mission.mission_type);
      }
    }
  }

  return prioritizeGapWarnings(messages);
}

export { guardSlotDifficultyRank, type PersonBurdenBreakdown } from "@/lib/guard-burden";
