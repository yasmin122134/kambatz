import { getFairnessRules, pointsForHours, slotDurationHours } from "@/lib/fairness";
import {
  type FlatSlot,
  eatsRest,
  flattenMissionSlots,
  isGuardKind,
  isStandbyKind,
  normalizeSchedulingRules,
  parseTimeMinutes,
  resolvePositionKind,
  slotDurationMinutes,
} from "@/lib/mission-utils";
import { apportionSeats, groupPeopleBySquad } from "@/lib/squad-utils";
import { missionsOverlapCompatible } from "@/lib/standby-compat";
import type {
  FairnessRules,
  Issue,
  MissionDay,
  MissionPositionKind,
  MissionSchedulingRules,
  MissionType,
  Person,
} from "@/lib/types";

type BusyBlock = {
  cyclicStart: number;
  durationMinutes: number;
  eatsRest: boolean;
  positionKind: MissionPositionKind;
  missionType: MissionType;
  slotId: string;
  missionId: string;
};

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

function blockedByIssue(
  personName: string,
  slot: FlatSlot,
  issues: Issue[],
): boolean {
  const a = parseTimeMinutes(slot.startTime);
  const b = parseTimeMinutes(slot.endTime);
  if (a === null || b === null) return false;

  for (const issue of issues) {
    if (issue.person_name !== personName || issue.status !== "approved") continue;
    const ia = parseTimeMinutes(issue.start_time);
    const ib = parseTimeMinutes(issue.end_time);
    if (ia === null || ib === null) continue;
    const idur = slotDurationMinutes(issue.start_time, issue.end_time);
    const pIssue = slot.cyclicStart; // approximate — issues use wall clock
    const pSlot = slot.cyclicStart;
    if (cyclicOverlap(pIssue, idur, pSlot, slot.durationMinutes)) return true;
    if (cyclicOverlap(ia, idur, a, slot.durationMinutes)) return true;
  }
  return false;
}

export function canGuardPerson(person: Person): boolean {
  return !person.no_guard && !person.no_weapon;
}

export function canAssignKind(person: Person, kind: MissionPositionKind): boolean {
  if (isGuardKind(kind)) return canGuardPerson(person);
  if (person.no_guard) return false;
  return true;
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
  if (!eatsRest(slot.positionKind)) return true;
  const restMin = restHours * 60;
  const worked = workedRestMinutes(tracker.busy[personName] || []);
  return 1440 - worked - slot.durationMinutes >= restMin;
}

function overlapsSlot(
  personName: string,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  ignoreSlotId?: string,
): boolean {
  for (const b of tracker.busy[personName] || []) {
    if (ignoreSlotId && b.slotId === ignoreSlotId) continue;
    if (
      missionsOverlapCompatible(
        slot.positionKind,
        slot.missionType,
        b.positionKind,
        b.missionType,
      )
    ) {
      continue;
    }
    if (
      cyclicOverlap(b.cyclicStart, b.durationMinutes, slot.cyclicStart, slot.durationMinutes)
    ) {
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
  if (slot.positionKind === "duty") return "duty";
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
): number {
  const priorAdj = ((person.prior_score || 0) - meanPrior) * rules.hist;
  return (tracker.periodPoints[person.name] || 0) + priorAdj;
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
  if (!canAssignKind(person, slot.positionKind)) return false;
  if (blockedByIssue(person.name, slot, issues)) return false;
  if (overlapsSlot(person.name, slot, tracker, ignoreSlotId)) return false;
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
    durationMinutes: slot.durationMinutes,
    eatsRest: eatsRest(slot.positionKind),
    positionKind: slot.positionKind,
    missionType: missionType ?? slot.missionType,
    slotId: slot.slotId,
    missionId,
  };
  tracker.busy[personName] = [...(tracker.busy[personName] || []), block];
  if (isGuardKind(slot.positionKind)) {
    tracker.guardShifts[personName] = [
      ...(tracker.guardShifts[personName] || []),
      { start: slot.cyclicStart, duration: slot.durationMinutes },
    ];
  }
  const pts = pointsForSlot(slot, seatCount, rules, { missionType, scheduling });
  tracker.periodPoints[personName] = (tracker.periodPoints[personName] || 0) + pts;
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

export function slotRank(slot: FlatSlot, rules: FairnessRules) {
  if (isStandbyKind(slot.positionKind)) return 1e9;
  if (slot.positionKind === "kitchen") return 500;
  return pointsForSlot(slot, slot.seatCount, rules) * 100;
}

export function pickBestCandidate(
  candidates: Person[],
  slot: FlatSlot,
  tracker: ScheduleTracker,
  rules: FairnessRules,
  meanPrior: number,
  options?: { preferHighLoad?: boolean },
): Person | null {
  if (!candidates.length) return null;
  const preferHigh =
    options?.preferHighLoad ??
    (isStandbyKind(slot.positionKind) && !slot.sameGender);
  const sorted = [...candidates].sort((a, b) => {
    const wa = workScore(a, tracker, rules, meanPrior);
    const wb = workScore(b, tracker, rules, meanPrior);
    let sc = preferHigh ? wb - wa : wa - wb;
    if (a.exam !== b.exam) {
      if (isGuardKind(slot.positionKind)) sc += a.exam ? 1000 : -1000;
      else sc += a.exam ? -1000 : 1000;
    }
    if (sc !== 0) return sc;
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
    const wa = workScore(a, tracker, rules, meanPrior);
    const wb = workScore(b, tracker, rules, meanPrior);
    if (wa !== wb) return wa - wb;
    if (a.exam !== b.exam) return a.exam ? -1 : 1;
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
}): { names: string[]; workSquad: number | null; usedFallback: boolean } {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const cfg = input.scheduling.base_work;
  const target = cfg?.seats_per_shift ?? 14;
  const restList = cfg?.squad_rest_by_shift ?? [1, 2, 3];
  const restSquad = restList[input.shiftIndex % restList.length] ?? (input.shiftIndex % 4) + 1;

  const sortedPeople = [...input.people].sort((a, b) =>
    a.name.localeCompare(b.name, "he"),
  );
  const squadOf = (p: Person) =>
    effectiveSquad(p, sortedPeople.findIndex((x) => x.id === p.id));
  const groups = groupPeopleBySquad(sortedPeople, squadOf);

  const fitsAll = (members: Person[]) =>
    members.every((p) =>
      fitsPerson(
        p,
        input.slot,
        input.tracker,
        input.issues,
        input.scheduling,
        input.taken,
        peopleByName,
      ),
    );

  const activeSquads = ([1, 2, 3, 4] as const).filter((s) => s !== restSquad);
  const candidates = activeSquads
    .map((s) => ({ squad: s, members: groups[s] }))
    .filter(({ members }) => members.length >= 13 && members.length <= 15)
    .sort(
      (a, b) =>
        Math.abs(a.members.length - target) - Math.abs(b.members.length - target),
    );

  for (const { squad, members } of candidates) {
    const pool = members.filter((m) => !input.taken.includes(m.name));
    if (pool.length < 13 || pool.length > 15) continue;
    if (!fitsAll(pool)) continue;
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
    return { names, workSquad: squad, usedFallback: false };
  }

  // גיבוי: חלוקה יחסית עד יעד 13–15
  const need = Math.max(13, Math.min(15, target));
  const activePools = activeSquads.map((s) => groups[s]);
  const sizes = activePools.map((pool) =>
    pool.filter((p) =>
      fitsPerson(
        p,
        input.slot,
        input.tracker,
        input.issues,
        input.scheduling,
        input.taken,
        peopleByName,
      ),
    ).length,
  );
  const targets = apportionSeats(need, sizes);
  const assigned: string[] = [];

  for (let i = 0; i < activeSquads.length; i++) {
    const squad = activeSquads[i];
    const pool = activePools[i]
      .filter((p) =>
        fitsPerson(
          p,
          input.slot,
          input.tracker,
          input.issues,
          input.scheduling,
          [...input.taken, ...assigned],
          peopleByName,
        ),
      )
      .sort((a, b) => {
        const wa = workScore(a, input.tracker, input.rules, input.meanPrior);
        const wb = workScore(b, input.tracker, input.rules, input.meanPrior);
        return wa - wb || a.name.localeCompare(b.name, "he");
      });
    let squadAdded = 0;
    for (const p of pool) {
      if (assigned.length >= need || squadAdded >= targets[i]) break;
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

  return {
    names: assigned,
    workSquad: assigned.length ? squadOf(peopleByName[assigned[0]]) : null,
    usedFallback: true,
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

export { getFairnessRules };
