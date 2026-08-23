import { slotDurationHours } from "@/lib/fairness-math";
import { spreadWithOverrides } from "@/lib/fairness-spread";
import {
  calculatePersonBurden,
  calculateProjectedCandidateBurden,
  guardSlotDifficultyRank,
  type BurdenTimelineBlock,
  type PersonBurdenBreakdown,
} from "@/lib/guard-burden";
import {
  type FlatSlot,
  eatsRest,
  slotEatsRest,
  flattenMissionSlots,
  isGuardKind,
  isObservationPost,
  isStandbyKind,
  normalizeSchedulingRules,
  parseTimeMinutes,
  resolvePositionKind,
  slotDurationMinutes,
} from "@/lib/mission-utils";
import { isDutyOfficerName, personIsDutyOfficer } from "@/lib/officers";
import { apportionSeats, groupPeopleBySquad } from "@/lib/squad-utils";
import {
  intervalsConflictWithGap,
  intervalsOverlap,
  type TimeInterval,
} from "@/lib/time-interval";
import { issueAbsoluteInterval } from "@/lib/issue-interval";
import {
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
};

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
  tracker.periodPoints[personName] = calculatePersonBurden(blocks, rules, scheduling).totalBurden;
}

export type ScheduleTracker = {
  busy: Record<string, BusyBlock[]>;
  guardShifts: Record<string, { start: number; duration: number }[]>;
  periodPoints: Record<string, number>;
};

export type ReplacementOption = {
  type: "direct" | "swap";
  personName: string;
  cost: number;
  label: string;
  swapSlotId?: string;
  swapSeatIndex?: number;
  swapLabel?: string;
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
): boolean {
  // Reserve force (guards + duty) does not require spacing from guard shifts — only עב״ס does.
  const aBase = typeA === "base_work";
  const bBase = typeB === "base_work";
  const aGuard = typeA === "guards" && isGuardKind(kindA);
  const bGuard = typeB === "guards" && isGuardKind(kindB);
  return (aBase && bGuard) || (aGuard && bBase);
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
};

export function canAssignKind(
  person: Person,
  kind: MissionPositionKind,
  ctx?: AssignKindContext,
): boolean {
  if (kind === "officer_duty") {
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
  return { positionName: slot.positionName, missionType: slot.missionType };
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

/** קצין תורן שכבר משובץ במשמרת האחות (חצי יום שני) */
export function siblingDutyOfficerAssignee(
  mission: MissionDay,
  slot: FlatSlot,
  assignments: Record<string, string[]>,
): string | null {
  if (slot.positionKind !== "officer_duty") return null;
  for (const s of flattenMissionSlots(mission)) {
    if (s.positionId !== slot.positionId || s.slotId === slot.slotId) continue;
    for (const name of assignments[s.slotId] || []) {
      if (name && isDutyOfficerName(name)) return name;
    }
  }
  return null;
}

function workedRestMinutes(blocks: BusyBlock[]): number {
  return blocks
    .filter((b) => b.eatsRest)
    .reduce((sum, b) => sum + b.durationMinutes, 0);
}

function guardOk(
  personName: string,
  slot: FlatSlot,
  guardShifts: Record<string, { start: number; duration: number }[]>,
  ratio: number,
): boolean {
  if (!ratio || !isGuardKind(slot.positionKind)) return true;
  for (const g of guardShifts[personName] || []) {
    if (cyclicGap(g.start, g.duration, slot.cyclicStart) < g.duration * ratio) {
      return false;
    }
    if (
      cyclicGap(slot.cyclicStart, slot.durationMinutes, g.start) <
      slot.durationMinutes * ratio
    ) {
      return false;
    }
  }
  return true;
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
  const gapMin =
    scheduling.duty_guard_gap_minutes ??
    DEFAULT_MISSION_SCHEDULING_RULES.duty_guard_gap_minutes ??
    90;
  const slotIv = slotInterval(slot);

  for (const b of tracker.busy[personName] || []) {
    if (ignoreSlotId && b.slotId === ignoreSlotId) continue;
    if (b.slotId === slot.slotId) continue;

    const blockIv = blockInterval(b);
    const extraGap = needsDutyGuardGap(
      slot.positionKind,
      slot.missionType,
      b.positionKind,
      b.missionType,
    )
      ? gapMin
      : 0;

    if (extraGap > 0) {
      if (intervalsConflictWithGap(slotIv, blockIv, extraGap)) return true;
    } else if (assignmentIntervalsOverlap(slotIv, blockIv)) {
      return true;
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
  const bucket = bucketForSlot(slot, seatCount, rules);
  const weight = rules[bucket as keyof FairnessRules] as number;
  const kitchenPerShift =
    slot.positionKind === "kitchen" &&
    (options?.scheduling?.kitchen?.points_per_shift !== false ||
      options?.missionType === "kitchen");
  if (kitchenPerShift) {
    return Math.round(weight * 100) / 100;
  }
  const hours = slotDurationHours(slot.startTime, slot.endTime);
  return Math.round(hours * weight * 100) / 100;
}

export function workScore(
  person: Person,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  scheduling?: MissionSchedulingRules,
): number {
  const priorAdj = ((person.prior_score || 0) - meanPrior) * rules.hist;
  const burden = periodBurdenOnly(person, tracker, rules, scheduling);
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
  _meanPrior: number,
  scheduling?: MissionSchedulingRules,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const person of activeRosterMembers(roster)) {
    map.set(person.name, periodBurdenOnly(person, tracker, rules, scheduling));
  }
  return map;
}

export function rosterBurdenSpread(
  roster: Person[],
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  scheduling?: MissionSchedulingRules,
  overrides?: Map<string, number>,
): number {
  const base = rosterBurdenByName(roster, tracker, rules, meanPrior, scheduling);
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
  if (isGuardKind(slot.positionKind)) {
    return calculateProjectedCandidateBurden(
      person.name,
      slot,
      busyToBurdenBlocks(tracker.busy[person.name] || []),
      rules,
      scheduling,
      seatCount,
    );
  }
  const base = periodBurdenOnly(person, tracker, rules, scheduling);
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
  const base = rosterBurdenByName(roster, tracker, rules, meanPrior, scheduling);
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
  const base = rosterBurdenByName(roster, tracker, rules, meanPrior, scheduling);
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
  if (!canAssignKind(person, slot.positionKind, assignKindContext(slot))) return "canAssignKind";
  if (blockedByIssue(person.name, slot, issues)) return "blockedByIssue";
  if (overlapsSlot(person.name, slot, tracker, scheduling, ignoreSlotId)) return "overlapsSlot";
  if (!guardOk(person.name, slot, tracker.guardShifts, scheduling.guard_ratio)) return "guardOk";
  if (!restOk(person.name, slot, tracker, scheduling.rest_hours)) return "restOk";
  if (slot.sameRoom && !sameRoomOk(person, mates, peopleByName)) return "sameRoom";
  if (slot.sameGender && !sameGenderOk(person, mates, peopleByName)) return "sameGender";
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
  if (!canAssignKind(person, slot.positionKind, assignKindContext(slot))) return false;
  if (blockedByIssue(person.name, slot, issues)) return false;
  if (overlapsSlot(person.name, slot, tracker, scheduling, ignoreSlotId)) return false;
  if (!guardOk(person.name, slot, tracker.guardShifts, scheduling.guard_ratio)) {
    return false;
  }
  if (!restOk(person.name, slot, tracker, scheduling.rest_hours)) return false;
  if (slot.sameRoom && !sameRoomOk(person, mates, peopleByName)) return false;
  if (slot.sameGender && !sameGenderOk(person, mates, peopleByName)) return false;
  return true;
}

export function placePerson(
  personName: string,
  slot: FlatSlot,
  missionId: string,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  scheduling: MissionSchedulingRules,
  seatCount: number,
  missionType?: MissionType,
) {
  const block: BusyBlock = {
    cyclicStart: slot.cyclicStart,
    wallStartMin: slot.wallStartMin,
    calendarDayOffset: slot.calendarDayOffset,
    durationMinutes: slot.durationMinutes,
    eatsRest: slotEatsRest(slot),
    positionKind: slot.positionKind,
    missionType: missionType ?? slot.missionType,
    seatCount,
    startTime: slot.startTime,
    endTime: slot.endTime,
    slotId: slot.slotId,
    missionId,
    startAtMs: slot.startAtMs,
    endAtMs: slot.endAtMs,
  };
  tracker.busy[personName] = [...(tracker.busy[personName] || []), block];
  if (isGuardKind(slot.positionKind)) {
    tracker.guardShifts[personName] = [
      ...(tracker.guardShifts[personName] || []),
      { start: slot.cyclicStart, duration: slot.durationMinutes },
    ];
  }
  syncPersonPeriodPoints(personName, tracker, rules, scheduling);
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
        const chosen = pickBestCandidate(
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
              { scheduling: input.scheduling, roster: input.people },
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
  if (!restOk(person.name, slot, tracker, scheduling.rest_hours)) {
    msgs.push(`${person.name}: לא נח מספיק זמן לפני ${slot.timeLabel}`);
  }
  if (
    isGuardKind(slot.positionKind) &&
    !guardOk(person.name, slot, tracker.guardShifts, scheduling.guard_ratio)
  ) {
    msgs.push(`${person.name}: יחס שמירות (${scheduling.guard_ratio}:1) לא מתקיים`);
  }
  const overlapMsg = overlapAssignmentWarning(
    person.name,
    slot,
    tracker,
    scheduling,
  );
  if (overlapMsg) msgs.push(overlapMsg);
  if (slot.sameRoom && !sameRoomOk(person, mates, peopleByName)) {
    msgs.push(`${person.name}: לא אותו חדר כמו שאר המשמרת`);
  }
  if (slot.sameGender && !sameGenderOk(person, mates, peopleByName)) {
    msgs.push(`${person.name}: לא אותו מגדר כמו שאר המשמרת`);
  }
  return msgs;
}

function overlapAssignmentWarning(
  personName: string,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  scheduling: MissionSchedulingRules,
): string | null {
  const gapMin =
    scheduling.duty_guard_gap_minutes ??
    DEFAULT_MISSION_SCHEDULING_RULES.duty_guard_gap_minutes ??
    90;
  const slotIv = slotInterval(slot);

  for (const b of tracker.busy[personName] || []) {
    if (b.slotId === slot.slotId) continue;

    const blockIv = blockInterval(b);
    const dutyGuardGap = needsDutyGuardGap(
      slot.positionKind,
      slot.missionType,
      b.positionKind,
      b.missionType,
    );
    const extraGap = dutyGuardGap ? gapMin : 0;

    const conflicts =
      extraGap > 0
        ? intervalsConflictWithGap(slotIv, blockIv, extraGap)
        : assignmentIntervalsOverlap(slotIv, blockIv);

    if (conflicts) {
      if (dutyGuardGap) {
        const guardFirst =
          (slot.missionType === "guards" && isGuardKind(slot.positionKind)) ||
          (b.missionType === "base_work");
        return guardFirst
          ? `${personName}: לא נח מספיק בין שמירה לעב״ס`
          : `${personName}: לא נח מספיק בין עב״ס לשמירה`;
      }
      return `${personName}: חפיפה עם ${describeAssignmentBlock(b)} (${slot.timeLabel})`;
    }
  }
  return null;
}

/** מועמדים כשאין מי שעומד בכל הכללים — עדיין אוסר חפיפות */
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

/** ממלא משבצות ריקות — ללא הפרת חפיפה */
export function forceFillEmptySeats(input: {
  mission: MissionDay;
  assignments: Record<string, string[]>;
  people: Person[];
  tracker: ScheduleTracker;
  issues: Issue[];
  scheduling: MissionSchedulingRules;
  rules: FairnessRules;
  meanPrior: number;
}): { assignments: Record<string, string[]>; filled: number; warnings: string[] } {
  const assignments = { ...input.assignments };
  for (const key of Object.keys(assignments)) {
    assignments[key] = [...assignments[key]];
  }
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const warnings: string[] = [];
  let filled = 0;

  for (const slot of flattenMissionSlots(input.mission)) {
    if (slot.seatCount <= 0) continue;
    const seats = assignments[slot.slotId] || [];
    const inSlot = new Set(seats.filter(Boolean));

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
      let chosen =
        pickBestCandidate(
          strict,
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
          inSlot,
          {
            roster: input.people,
            dutyOfficerAlreadyAssigned: siblingDutyOfficerAssignee(
              input.mission,
              slot,
              assignments,
            ) ?? undefined,
          },
        );
      if (!chosen) {
        warnings.push(
          `${slot.positionName} ${slot.timeLabel} — משבצת ${seatIndex + 1}: אין צוער זכאי`,
        );
        continue;
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

      seats[seatIndex] = chosen.name;
      inSlot.add(chosen.name);
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
    }

    assignments[slot.slotId] = seats;
  }

  return { assignments, filled, warnings };
}

export function buildTrackerFromMissions(
  missions: MissionDay[],
  rules: FairnessRules,
  excludeMissionIds: Set<string> = new Set(),
): ScheduleTracker {
  const tracker: ScheduleTracker = {
    busy: {},
    guardShifts: {},
    periodPoints: {},
  };

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
    /** משמרת קצין תורן אחרת באותו יום — העדפת הקצין השני */
    dutyOfficerAlreadyAssigned?: string;
    /** Full active roster — enables spread-aware fairness when provided */
    roster?: Person[];
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
        pool.reduce((s, p) => s + workScore(p, tracker, rules, meanPrior), 0) /
        pool.length
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

  const canPick = (p: Person) => {
    if (assigned.includes(p.name)) return false;
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

  const pickFromPool = (pool: Person[], limit: number) => {
    let added = 0;
    const sorted = [...pool]
      .filter(canPick)
      .sort((a, b) => {
        const wa = workScore(a, input.tracker, input.rules, input.meanPrior);
        const wb = workScore(b, input.tracker, input.rules, input.meanPrior);
        if (wa !== wb) return wa - wb;
        return a.name.localeCompare(b.name, "he");
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
  const activeSquads = ([1, 2, 3, 4] as const).filter((s) => s !== restSquad);
  const activeSizes = activeSquads.map((s) => groups[s].filter(canPick).length);
  const targets = apportionSeats(Math.max(0, input.need - input.taken.length), activeSizes);

  for (let i = 0; i < activeSquads.length; i++) {
    pickFromPool(groups[activeSquads[i]], targets[i]);
  }

  let usedRestSquad = false;
  if (assigned.length < targetTotal) {
    const restLeft = targetTotal - assigned.length;
    const restPool = groups[restSquad].filter(canPick);
    if (restPool.length) usedRestSquad = true;
    pickFromPool(restPool, restLeft);
  }

  if (assigned.length < targetTotal) {
    pickFromPool(
      sortedPeople.filter((p) => squadOf(p) !== restSquad),
      targetTotal - assigned.length,
    );
  }

  if (assigned.length < targetTotal) {
    pickFromPool(sortedPeople, targetTotal - assigned.length);
  }

  const names = assigned.slice(input.taken.length);
  return { names, usedRestSquad, squadCounts };
}

/** שיבוץ חלון עב״ס — צוות שלם (13–15), צוות אחד במנוחה */
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
  if (!canAssignKind(person, slot.positionKind, assignKindContext(slot))) return "rejectedIneligible";
  if (blockedByIssue(person.name, slot, issues)) return "rejectedIssue";
  if (overlapsSlot(person.name, slot, tracker, scheduling)) return "rejectedOverlap";
  if (!guardOk(person.name, slot, tracker.guardShifts, scheduling.guard_ratio)) {
    return "rejectedGuardRatio";
  }
  if (!restOk(person.name, slot, tracker, scheduling.rest_hours)) return "rejectedRest";
  if (slot.sameRoom && !sameRoomOk(person, mates, peopleByName)) return "rejectedOther";
  if (slot.sameGender && !sameGenderOk(person, mates, peopleByName)) return "rejectedOther";
  return null;
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
  workSquad: number | null;
  usedFallback: boolean;
  diagnostics: BaseWorkShiftDiagnostics;
} {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const cfg = input.scheduling.base_work;
  const configuredTarget = cfg?.seats_per_shift ?? 14;
  const target = Math.max(
    13,
    Math.min(15, input.slot.seatCount || configuredTarget),
  );
  const restList = cfg?.squad_rest_by_shift ?? [1, 2, 3];
  const restSquad = restList[input.shiftIndex % restList.length] ?? (input.shiftIndex % 4) + 1;
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
  const squadOf = (p: Person) =>
    effectiveSquad(p, sortedPeople.findIndex((x) => x.id === p.id));
  const groups = groupPeopleBySquad(sortedPeople, squadOf);

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

  const activeSquads = ([1, 2, 3, 4] as const).filter((s) => s !== restSquad);
  const squadCandidates = activeSquads
    .map((s) => ({ squad: s, members: groups[s] }))
    .filter(({ members }) => members.length >= 13 && members.length <= 15)
    .sort(
      (a, b) =>
        Math.abs(a.members.length - target) - Math.abs(b.members.length - target),
    );

  for (const { squad, members } of squadCandidates) {
    const pool = members.filter((m) => !input.taken.includes(m.name));
    if (pool.length < 13 || pool.length > 15) continue;
    if (!pool.every((p) => fitsCandidate(p, input.taken))) {
      for (const p of pool) countRejection(p, input.taken);
      continue;
    }
    const names = pool.map((p) => p.name);
    for (const name of names) {
      placePerson(
        name,
        input.slot,
        input.missionId,
        input.tracker,
        input.rules,
        input.scheduling,
        input.slot.seatCount,
        input.missionType,
      );
    }
    diagnostics.assigned = names.length;
    return { names, workSquad: squad, usedFallback: false, diagnostics };
  }

  const need = Math.max(0, target - input.taken.length);
  const assigned: string[] = [];
  const activePools = activeSquads.map((s) => groups[s]);
  const eligibleCounts = activePools.map(
    (pool) => pool.filter((p) => fitsCandidate(p, [...input.taken, ...assigned])).length,
  );
  const targets = apportionSeats(need, eligibleCounts);

  for (let i = 0; i < activeSquads.length; i++) {
    const pool = activePools[i]
      .filter((p) => !input.taken.includes(p.name) && !assigned.includes(p.name))
      .sort((a, b) => {
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

    let squadAdded = 0;
    for (const p of pool) {
      if (assigned.length >= need || squadAdded >= targets[i]) break;
      const mates = [...input.taken, ...assigned];
      if (!fitsCandidate(p, mates)) {
        countRejection(p, mates);
        continue;
      }
      assigned.push(p.name);
      squadAdded += 1;
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
    }
  }

  if (assigned.length < need) {
    const remaining = sortedPeople.filter(
      (p) => !input.taken.includes(p.name) && !assigned.includes(p.name),
    );
    for (const p of remaining) {
      if (assigned.length >= need) break;
      const mates = [...input.taken, ...assigned];
      if (!fitsCandidate(p, mates)) {
        countRejection(p, mates);
        continue;
      }
      assigned.push(p.name);
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
    }
  }

  diagnostics.assigned = input.taken.length + assigned.length;
  return {
    names: assigned,
    workSquad: assigned.length ? squadOf(peopleByName[assigned[0]]) : null,
    usedFallback: true,
    diagnostics,
  };
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
  const mission = input.missions.find((m) => m.id === input.missionId);
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
    (b) => !(b.missionId === input.missionId && b.slotId === input.slotId),
  );
  tracker.busy[input.removeName] = removeBlocks;
  if (isGuardKind(target.positionKind)) {
    tracker.guardShifts[input.removeName] = (
      tracker.guardShifts[input.removeName] || []
    ).slice(0, -1);
  }

  const mates = (mission.assignments[input.slotId] || []).filter(
    (n, i) => n && i !== input.seatIndex,
  );

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
      const cost = workScore(p, tracker, input.rules, meanPrior);
      options.push({
        type: "direct",
        personName: p.name,
        cost,
        label: `${p.name} — עומס נמוך (${cost.toFixed(1)} נק׳)`,
      });
    }
    options.sort((a, b) => a.cost - b.cost);
    return options.slice(0, 8);
  }

  for (const p of input.people) {
    if (p.name === input.removeName) continue;
    for (const otherMission of input.missions) {
      for (const otherSlot of flattenMissionSlots(otherMission)) {
        const arr = otherMission.assignments[otherSlot.slotId] || [];
        const oi = arr.indexOf(p.name);
        if (oi < 0) continue;
        if (arr.includes(input.removeName)) continue;

        const perRemove = buildTrackerFromMissions(input.missions, input.rules);
        const perPerson = peopleByName[p.name];
        const perRemovePerson = peopleByName[input.removeName];
        if (!perPerson || !perRemovePerson) continue;

        const matesOther = arr.filter((_, i) => i !== oi);
        if (
          !fitsPerson(
            perRemovePerson,
            otherSlot,
            perRemove,
            input.issues,
            normalizeSchedulingRules(otherMission.scheduling_rules),
            matesOther,
            peopleByName,
            otherSlot.slotId,
          )
        ) {
          continue;
        }
        if (
          !fitsPerson(
            perPerson,
            target,
            perRemove,
            input.issues,
            scheduling,
            mates,
            peopleByName,
            input.slotId,
          )
        ) {
          continue;
        }

        const durDiff =
          Math.abs(otherSlot.durationMinutes - target.durationMinutes) / 60;
        const kindPenalty =
          otherSlot.positionKind === target.positionKind ? 0 : 2;
        const cost =
          durDiff +
          kindPenalty +
          workScore(perPerson, perRemove, input.rules, meanPrior) / 100;

        options.push({
          type: "swap",
          personName: p.name,
          cost,
          label: `${p.name} ↔ ${input.removeName}: ${otherSlot.positionName} ${otherSlot.timeLabel}`,
          swapSlotId: otherSlot.slotId,
          swapSeatIndex: oi,
          swapLabel: `${otherSlot.positionName} ${otherSlot.timeLabel}`,
        });
      }
    }
  }

  options.sort((a, b) => a.cost - b.cost);
  return options.slice(0, 8);
}

function blockLabel(block: BusyBlock): string {
  return block.positionKind === "standby_carmel_a"
    ? "כרמל א׳"
    : block.positionKind === "standby_carmel_b"
      ? "כרמל ב׳"
      : block.positionKind;
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
};

/** Admin board warnings — rest, approved blocks, overlaps, coverage, eligibility. */
export function collectRosterWarnings(input: CollectRosterWarningsInput): string[] {
  const peopleByName = input.peopleByName;
  if (!Object.keys(peopleByName).length) return [];

  const issues = (input.issues ?? []).filter((row) => row.status === "approved");
  const messages: string[] = [...validateNoPersonOverlaps(input.missions)];

  for (const mission of input.missions) {
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

  const tracker: ScheduleTracker = { busy: {}, guardShifts: {}, periodPoints: {} };
  const rules = VALIDATION_FAIRNESS_RULES;

  for (const { mission, slot, names } of entries) {
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    for (let seatIndex = 0; seatIndex < names.length; seatIndex++) {
      const name = names[seatIndex];
      const person = input.peopleByName[name];
      if (!person) {
        messages.push(`${name}: לא נמצא במחזור`);
        continue;
      }
      const mates = names.filter((n, idx) => n && idx !== seatIndex);
      messages.push(
        ...describeAssignmentWarnings(
          person,
          slot,
          tracker,
          issues,
          scheduling,
          mates,
          input.peopleByName,
        ),
      );
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

  return [...new Set(messages)];
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

  const tracker: ScheduleTracker = { busy: {}, guardShifts: {}, periodPoints: {} };
  const rules = VALIDATION_FAIRNESS_RULES;

  for (const slot of slots) {
    const seats = mission.assignments[slot.slotId] || [];
    for (const name of seats) {
      if (!name) continue;

      if (peopleByName) {
        const person = peopleByName[name];
        if (!person) {
          messages.push(`${name}: לא נמצא במחזור`);
        } else if (!canAssignKind(person, slot.positionKind, assignKindContext(slot))) {
          messages.push(ineligibilityMessage(person, slot));
        }
      }

      if (blockedByIssue(name, slot, issues)) {
        messages.push(issueBlockMessage(name, slot));
      }

      if (overlapsSlot(name, slot, tracker, scheduling)) {
        const blocker = (tracker.busy[name] || []).find(
          (b) => b.slotId !== slot.slotId && assignmentIntervalsOverlap(blockInterval(b), slotInterval(slot)),
        );
        messages.push(
          `${name}: חפיפה — ${slot.positionName} ${slot.timeLabel}` +
            (blocker ? ` ↔ ${describeAssignmentBlock(blocker)}` : ""),
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

  return [...new Set(messages)];
}

type TrackedAssignment = {
  label: string;
  startMs: number;
  endMs: number;
  slotId: string;
  missionId: string;
};

/** Global validator — every person must have zero overlapping assignment pairs. */
export function validateNoPersonOverlaps(missions: MissionDay[]): string[] {
  const byPerson = new Map<string, TrackedAssignment[]>();

  for (const mission of missions) {
    for (const slot of flattenMissionSlots(mission)) {
      const seats = mission.assignments[slot.slotId] || [];
      for (const name of seats) {
        if (!name) continue;
        const list = byPerson.get(name) || [];
        list.push({
          label: `${slot.positionName} ${slot.timeLabel}`,
          startMs: slot.startAtMs,
          endMs: slot.endAtMs,
          slotId: slot.slotId,
          missionId: mission.id,
        });
        byPerson.set(name, list);
      }
    }
  }

  const messages: string[] = [];
  for (const [person, blocks] of byPerson) {
    const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (a.slotId === b.slotId && a.missionId === b.missionId) continue;
        if (
          assignmentIntervalsOverlap(
            { startMs: a.startMs, endMs: a.endMs },
            { startMs: b.startMs, endMs: b.endMs },
          )
        ) {
          messages.push(
            [
              "Overlap detected:",
              `Person: ${person}`,
              `Assignment A: ${a.label}`,
              `Assignment B: ${b.label}`,
            ].join("\n"),
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
  const overlapMessages = validateNoPersonOverlaps(input.missions);
  if (overlapMessages.length) return overlapMessages;

  const messages: string[] = [];
  const issues = input.issues ?? [];
  const peopleByName = input.peopleByName ?? {};
  const rules = VALIDATION_FAIRNESS_RULES;
  const tracker: ScheduleTracker = { busy: {}, guardShifts: {}, periodPoints: {} };

  for (const mission of input.missions) {
    const scheduling = normalizeSchedulingRules(mission.scheduling_rules);
    const missionStartMs = Date.parse(mission.starts_at);
    const missionEndMs = Date.parse(mission.ends_at);

    for (const slot of flattenMissionSlots(mission)) {
      if (slot.startAtMs >= slot.endAtMs) {
        messages.push(`${slot.positionName} ${slot.timeLabel}: start >= end`);
      }
      if (slot.startAtMs < missionStartMs || slot.endAtMs > missionEndMs) {
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
          isGuardKind(slot.positionKind) &&
          !guardOk(name, slot, tracker.guardShifts, scheduling.guard_ratio)
        ) {
          messages.push(`${name}: guard ratio violated at ${slot.timeLabel}`);
        }
        placePerson(name, slot, mission.id, tracker, rules, scheduling, slot.seatCount, mission.mission_type);
      }
    }
  }

  return [...new Set(messages)];
}

export { guardSlotDifficultyRank, type PersonBurdenBreakdown } from "@/lib/guard-burden";
