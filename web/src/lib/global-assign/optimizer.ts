import { calculatePersonBurden } from "@/lib/guard-burden";
import {
  compareByFairnessThenBurden,
  rosterBurdenSpread,
  rosterGuardCountSpread,
  spreadAfterGroupAssign,
  spreadAfterGuardGroupAssign,
} from "@/lib/scheduling-engine";
import {
  assignBaseWorkShift,
  buildTrackerFromMissions,
  fitsPerson,
  placePerson,
  siblingDutyOfficerAssignee,
  unplacePerson,
  type ScheduleTracker,
} from "@/lib/scheduling-engine";
import {
  flattenMissionSlots,
  isGuardKind,
  isStandbyKind,
  normalizeSchedulingRules,
  syncAssignmentSeats,
  type FlatSlot,
} from "@/lib/mission-utils";
import type { FairnessRules, Issue, MissionDay, MissionSchedulingRules, Person } from "@/lib/types";
import { DUTY_OFFICER_NAMES, personIsDutyOfficer } from "@/lib/officers";
import { enumerateCarmelGroups, hasCarmelGroupCandidates, summarizeCarmelRooms } from "./carmel-groups";
import {
  buildUnresolvedRequirements,
  countFilledSeats,
  countRequiredSeats,
  deriveStatus,
  formatUnresolvedSummary,
} from "./diagnostics";
import type {
  AssignmentUnit,
  CarmelFeasibilitySnapshot,
  CarmelGroupCandidate,
  GlobalAssignInput,
  GlobalAssignOutput,
} from "./types";

type SolverState = {
  tracker: ScheduleTracker;
  assignmentsByMission: Map<string, Record<string, string[]>>;
  assignedUnitIds: Set<string>;
};

type CandidateChoice =
  | { kind: "carmel"; group: CarmelGroupCandidate }
  | { kind: "seat"; person: Person }
  | { kind: "basework"; names: string[] }
  | { kind: "guard_pair"; people: Person[] };

/** Branching limits — keeps server-side assign under ~15s on full guard days. */
const DEFAULT_MAX_NODES = 12_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_DEADLINE_MS = 10_000;
const MAX_SEAT_BRANCH = 20;
/** Above this many open seats, greedy-only (backtracking is too slow). */
const BACKTRACK_UNIT_LIMIT = 55;

function cloneTracker(tracker: ScheduleTracker): ScheduleTracker {
  const busy: ScheduleTracker["busy"] = {};
  for (const [name, blocks] of Object.entries(tracker.busy)) {
    busy[name] = blocks.map((b) => ({ ...b }));
  }
  const guardShifts: ScheduleTracker["guardShifts"] = {};
  for (const [name, shifts] of Object.entries(tracker.guardShifts)) {
    guardShifts[name] = shifts.map((s) => ({ ...s }));
  }
  return {
    busy,
    guardShifts,
    periodPoints: { ...tracker.periodPoints },
    kitchenPoints: { ...tracker.kitchenPoints },
    dutyPoints: { ...tracker.dutyPoints },
  };
}

function cloneAssignments(map: Map<string, Record<string, string[]>>): Map<string, Record<string, string[]>> {
  const out = new Map<string, Record<string, string[]>>();
  for (const [id, seats] of map) {
    out.set(id, Object.fromEntries(Object.entries(seats).map(([k, v]) => [k, [...v]])));
  }
  return out;
}

function schedulingFor(mission: MissionDay): MissionSchedulingRules {
  return normalizeSchedulingRules(mission.scheduling_rules);
}

function buildUnits(missions: MissionDay[], keepExisting: boolean): AssignmentUnit[] {
  const units: AssignmentUnit[] = [];
  for (const mission of missions) {
    const assignments = syncAssignmentSeats(mission.positions, { ...mission.assignments });
    let baseShiftIndex = 0;
    for (const slot of flattenMissionSlots(mission)) {
      const seats = assignments[slot.slotId] || [];
      const emptyIndices = seats
        .map((name, i) => ({ name, i }))
        .filter(({ name }) => !name || (!keepExisting && name))
        .map(({ i }) => i);

      if (!emptyIndices.length) continue;

      const slotIsBaseWork = slot.missionType === "base_work";

      if (slotIsBaseWork) {
        const fixedNames = keepExisting ? seats.filter(Boolean) : [];
        units.push({
          kind: "basework",
          id: `${mission.id}:${slot.slotId}:basework`,
          mission,
          slot,
          shiftIndex: baseShiftIndex++,
          seatIndices: emptyIndices,
          fixedNames,
        });
        continue;
      }

      if (isStandbyKind(slot.positionKind) && slot.sameRoom) {
        const fixedNames = keepExisting ? seats.filter(Boolean) : [];
        units.push({
          kind: "carmel",
          id: `${mission.id}:${slot.slotId}:carmel`,
          mission,
          slot,
          need: emptyIndices.length,
          fixedNames,
          seatIndices: emptyIndices,
        });
        continue;
      }

      if (
        isGuardKind(slot.positionKind) &&
        slot.seatCount > 1 &&
        emptyIndices.length >= 2
      ) {
        units.push({
          kind: "guard_pair",
          id: `${mission.id}:${slot.slotId}:guard_pair`,
          mission,
          slot,
          seatIndices: emptyIndices,
        });
        continue;
      }

      for (const seatIndex of emptyIndices) {
        units.push({
          kind: "seat",
          id: `${mission.id}:${slot.slotId}:${seatIndex}`,
          mission,
          slot,
          seatIndex,
        });
      }
    }
  }
  return units;
}

function seedExistingAssignments(
  missions: MissionDay[],
  people: Person[],
  rules: FairnessRules,
  crossDayMissions: MissionDay[],
  keepExisting: boolean,
): ScheduleTracker {
  const excludeIds = new Set(missions.map((m) => m.id));
  const tracker = buildTrackerFromMissions(crossDayMissions, rules, excludeIds);

  for (const mission of missions) {
    const scheduling = schedulingFor(mission);
    const assignments = syncAssignmentSeats(mission.positions, { ...mission.assignments });
    for (const slot of flattenMissionSlots(mission)) {
      const seats = assignments[slot.slotId] || [];
      for (const name of seats) {
        if (!name) continue;
        if (!keepExisting) continue;
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

  for (const name of Object.keys(tracker.busy)) {
    const missionScheduling = schedulingFor(missions[0]);
    const breakdown = calculatePersonBurden(
      tracker.busy[name] || [],
      rules,
      missionScheduling,
    );
    tracker.periodPoints[name] = breakdown.totalBurden;
    tracker.kitchenPoints[name] = breakdown.kitchenPoints;
    tracker.dutyPoints[name] = breakdown.dutyPoints;
  }

  return tracker;
}

function initAssignments(
  missions: MissionDay[],
  keepExisting: boolean,
): Map<string, Record<string, string[]>> {
  const map = new Map<string, Record<string, string[]>>();
  for (const mission of missions) {
    const source = keepExisting ? mission.assignments : {};
    map.set(mission.id, syncAssignmentSeats(mission.positions, { ...source }));
  }
  return map;
}

function matesForSeat(
  seats: string[],
  seatIndex: number,
): string[] {
  return seats.filter((n, idx) => n && idx !== seatIndex);
}

function countSeatCandidates(
  unit: Extract<AssignmentUnit, { kind: "seat" }>,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  peopleByName: Record<string, Person>,
): number {
  const scheduling = schedulingFor(unit.mission);
  const seats = state.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
  const mates = matesForSeat(seats, unit.seatIndex);
  return people.filter(
    (p) =>
      !mates.includes(p.name) &&
      fitsPerson(p, unit.slot, state.tracker, issues, scheduling, mates, peopleByName),
  ).length;
}

function countCarmelCandidates(
  unit: Extract<AssignmentUnit, { kind: "carmel" }>,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  peopleByName: Record<string, Person>,
): number {
  const scheduling = schedulingFor(unit.mission);
  return hasCarmelGroupCandidates({
    slot: unit.slot,
    people,
    need: unit.need,
    fixedNames: unit.fixedNames,
    tracker: state.tracker,
    issues,
    scheduling,
    peopleByName,
  })
    ? 1
    : 0;
}

function countBaseworkCandidates(
  unit: Extract<AssignmentUnit, { kind: "basework" }>,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  rules: FairnessRules,
  meanPrior: number,
): number {
  const scheduling = schedulingFor(unit.mission);
  const seats = state.assignmentsByMission.get(unit.mission.id)!;
  const row = seats[unit.slot.slotId] || [];
  const taken = unit.seatIndices.map((i) => row[i]).filter(Boolean);
  const probe = cloneTracker(state.tracker);
  const result = assignBaseWorkShift({
    people,
    slot: unit.slot,
    shiftIndex: unit.shiftIndex,
    tracker: probe,
    issues,
    scheduling,
    rules,
    meanPrior,
    missionId: unit.mission.id,
    missionType: unit.mission.mission_type,
    taken,
  });
  const target = Math.max(13, Math.min(15, unit.slot.seatCount || 14));
  const need = Math.min(target, unit.seatIndices.length + taken.length);
  return result.diagnostics.assigned >= need ? 1 : 0;
}

function computeBaseworkNames(
  unit: Extract<AssignmentUnit, { kind: "basework" }>,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  rules: FairnessRules,
  meanPrior: number,
): string[] {
  const scheduling = schedulingFor(unit.mission);
  const seats = state.assignmentsByMission.get(unit.mission.id)!;
  const row = seats[unit.slot.slotId] || [];
  const taken = unit.seatIndices.map((i) => row[i]).filter(Boolean);
  const probe = cloneTracker(state.tracker);
  const result = assignBaseWorkShift({
    people,
    slot: unit.slot,
    shiftIndex: unit.shiftIndex,
    tracker: probe,
    issues,
    scheduling,
    rules,
    meanPrior,
    missionId: unit.mission.id,
    missionType: unit.mission.mission_type,
    taken,
  });
  const roster = [...taken];
  for (const name of result.names) {
    if (!roster.includes(name)) roster.push(name);
  }
  return roster.filter((n) => !taken.includes(n));
}

function countGuardPairCandidates(
  unit: Extract<AssignmentUnit, { kind: "guard_pair" }>,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  peopleByName: Record<string, Person>,
): number {
  const scheduling = schedulingFor(unit.mission);
  const need = unit.seatIndices.length;
  if (need <= 0) return 0;

  const pool = people.filter((p) =>
    fitsPerson(p, unit.slot, state.tracker, issues, scheduling, [], peopleByName),
  );
  if (need === 1) return pool.length;

  let count = 0;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (
        fitsPerson(a, unit.slot, state.tracker, issues, scheduling, [b.name], peopleByName) &&
        fitsPerson(b, unit.slot, state.tracker, issues, scheduling, [a.name], peopleByName)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function listGuardPairCandidates(
  unit: Extract<AssignmentUnit, { kind: "guard_pair" }>,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  peopleByName: Record<string, Person>,
  rules: FairnessRules,
  meanPrior: number,
  seed: number,
): Person[][] {
  const scheduling = schedulingFor(unit.mission);
  const need = unit.seatIndices.length;
  if (need <= 0) return [];

  const pool = people.filter((p) =>
    fitsPerson(p, unit.slot, state.tracker, issues, scheduling, [], peopleByName),
  );

  if (need === 1) {
    return pool.map((p) => [p]);
  }

  const pairs: Person[][] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (
        fitsPerson(a, unit.slot, state.tracker, issues, scheduling, [b.name], peopleByName) &&
        fitsPerson(b, unit.slot, state.tracker, issues, scheduling, [a.name], peopleByName)
      ) {
        pairs.push([a, b]);
      }
    }
  }

  return pairs.sort((groupA, groupB) => {
    const spreadA = spreadAfterGuardGroupAssign(groupA, people, state.tracker);
    const spreadB = spreadAfterGuardGroupAssign(groupB, people, state.tracker);
    if (spreadA !== spreadB) return spreadA - spreadB;
    const sumA = groupA.reduce(
      (s, p) => s + (state.tracker.guardShifts[p.name]?.length ?? 0),
      0,
    );
    const sumB = groupB.reduce(
      (s, p) => s + (state.tracker.guardShifts[p.name]?.length ?? 0),
      0,
    );
    if (sumA !== sumB) return sumA - sumB;
    const fairnessCmp = compareByFairnessThenBurden(
      groupA[0],
      groupB[0],
      unit.slot,
      people,
      state.tracker,
      rules,
      meanPrior,
      scheduling,
      unit.slot.seatCount,
    );
    if (fairnessCmp !== 0) return fairnessCmp;
    const tieA = (groupA[0].name.charCodeAt(0) + seed) % 7;
    const tieB = (groupB[0].name.charCodeAt(0) + seed) % 7;
    if (tieA !== tieB) return tieA - tieB;
    return groupA[0].name.localeCompare(groupB[0].name, "he");
  });
}

function unitDifficulty(
  unit: AssignmentUnit,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  peopleByName: Record<string, Person>,
  rules: FairnessRules,
  meanPrior: number,
): number {
  const candidates =
    unit.kind === "carmel"
      ? countCarmelCandidates(unit, state, people, issues, peopleByName)
      : unit.kind === "basework"
        ? countBaseworkCandidates(unit, state, people, issues, rules, meanPrior)
        : unit.kind === "guard_pair"
          ? countGuardPairCandidates(unit, state, people, issues, peopleByName)
          : countSeatCandidates(unit, state, people, issues, peopleByName);

  if (unit.kind === "carmel") {
    return 100_000 + 10_000 / Math.max(1, candidates);
  }
  if (unit.kind === "basework") {
    return 9_000 + 900 / Math.max(1, candidates);
  }
  if (unit.kind === "guard_pair") {
    return 85_000 + 8_500 / Math.max(1, candidates);
  }
  if (unit.slot.positionKind === "officer_duty") {
    return 50_000 + 5_000 / Math.max(1, candidates);
  }
  if (isGuardKind(unit.slot.positionKind)) {
    if (unit.kind === "seat" && unit.slot.seatCount > 1) {
      const seats =
        state.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
      const hasMate = seats.some((n, idx) => n && idx !== unit.seatIndex);
      if (hasMate) {
        return 80_000 + 8_000 / Math.max(1, candidates);
      }
    }
    return 10_000 + 1_000 / Math.max(1, candidates);
  }
  if (unit.mission.mission_type === "kitchen") {
    return 100 + 10 / Math.max(1, candidates);
  }
  return 5_000 + 500 / Math.max(1, candidates);
}

function pickNextUnit(
  units: AssignmentUnit[],
  state: SolverState,
  people: Person[],
  issues: Issue[],
  peopleByName: Record<string, Person>,
  rules: FairnessRules,
  meanPrior: number,
): AssignmentUnit | null {
  let best: AssignmentUnit | null = null;
  let bestScore = -Infinity;
  for (const unit of units) {
    if (state.assignedUnitIds.has(unit.id)) continue;
    const score = unitDifficulty(
      unit,
      state,
      people,
      issues,
      peopleByName,
      rules,
      meanPrior,
    );
    if (score > bestScore) {
      bestScore = score;
      best = unit;
    }
  }
  return best;
}

function carmelForwardOk(
  units: AssignmentUnit[],
  state: SolverState,
  people: Person[],
  issues: Issue[],
  peopleByName: Record<string, Person>,
): boolean {
  for (const unit of units) {
    if (unit.kind !== "carmel" || state.assignedUnitIds.has(unit.id)) continue;
    if (countCarmelCandidates(unit, state, people, issues, peopleByName) === 0) {
      return false;
    }
  }
  return true;
}

function countPersonScarcity(
  person: Person,
  units: AssignmentUnit[],
  issues: Issue[],
  state: SolverState,
  peopleByName: Record<string, Person>,
): number {
  let scarceSlots = 0;
  for (const unit of units) {
    if (state.assignedUnitIds.has(unit.id)) continue;
    if (unit.kind === "seat") {
      const scheduling = schedulingFor(unit.mission);
      const seats = state.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
      const mates = matesForSeat(seats, unit.seatIndex);
      if (mates.includes(person.name)) continue;
      if (fitsPerson(person, unit.slot, state.tracker, issues, scheduling, mates, peopleByName)) {
        scarceSlots += 1;
      }
    }
  }
  return scarceSlots;
}

function listSeatCandidates(
  unit: Extract<AssignmentUnit, { kind: "seat" }>,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  rules: FairnessRules,
  meanPrior: number,
  peopleByName: Record<string, Person>,
  seed: number,
  units: AssignmentUnit[],
): Person[] {
  const scheduling = schedulingFor(unit.mission);
  const missionAssignments = state.assignmentsByMission.get(unit.mission.id) || {};
  const seats = missionAssignments[unit.slot.slotId] || [];
  const mates = matesForSeat(seats, unit.seatIndex);
  const siblingOfficer =
    siblingDutyOfficerAssignee(unit.mission, unit.slot, missionAssignments) ?? undefined;
  const pool = people.filter(
    (p) =>
      !mates.includes(p.name) &&
      fitsPerson(p, unit.slot, state.tracker, issues, scheduling, mates, peopleByName),
  );

  let candidates = pool;
  if (unit.slot.positionKind === "officer_duty") {
    candidates = pool.filter((p) => personIsDutyOfficer(p));
    if (siblingOfficer) {
      const other = candidates.filter((p) => p.name !== siblingOfficer);
      if (other.length) candidates = other;
    }
  }

  const scarcity = new Map(
    candidates.map((p) => [p.name, countPersonScarcity(p, units, issues, state, peopleByName)]),
  );

  return candidates.sort((a, b) => {
    if (unit.slot.positionKind === "officer_duty" && siblingOfficer) {
      if (a.name === siblingOfficer && b.name !== siblingOfficer) return 1;
      if (b.name === siblingOfficer && a.name !== siblingOfficer) return -1;
    }
    const guardSlot = unit.slot.positionKind === "guard";
    const eligibleA = scarcity.get(a.name) ?? 0;
    const eligibleB = scarcity.get(b.name) ?? 0;
    const fairnessCmp = compareByFairnessThenBurden(
      a,
      b,
      unit.slot,
      people,
      state.tracker,
      rules,
      meanPrior,
      scheduling,
      unit.slot.seatCount,
    );
    if (guardSlot) {
      if (fairnessCmp !== 0) return fairnessCmp;
      if (eligibleA !== eligibleB) return eligibleA - eligibleB;
    } else {
      if (eligibleA !== eligibleB) return eligibleA - eligibleB;
      if (fairnessCmp !== 0) return fairnessCmp;
    }
    const tie = (a.name.charCodeAt(0) + seed) % 7;
    const tie2 = (b.name.charCodeAt(0) + seed) % 7;
    if (tie !== tie2) return tie - tie2;
    return a.name.localeCompare(b.name, "he");
  });
}

function listCarmelCandidates(
  unit: Extract<AssignmentUnit, { kind: "carmel" }>,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  rules: FairnessRules,
  meanPrior: number,
  peopleByName: Record<string, Person>,
  seed: number,
): CarmelGroupCandidate[] {
  const scheduling = schedulingFor(unit.mission);
  const groups = enumerateCarmelGroups({
    slot: unit.slot,
    people,
    need: unit.need,
    fixedNames: unit.fixedNames,
    tracker: state.tracker,
    issues,
    scheduling,
    peopleByName,
  });

  return groups.sort((a, b) => {
    const spreadA = spreadAfterGroupAssign(
      a.people,
      unit.slot,
      people,
      state.tracker,
      rules,
      meanPrior,
      scheduling,
    );
    const spreadB = spreadAfterGroupAssign(
      b.people,
      unit.slot,
      people,
      state.tracker,
      rules,
      meanPrior,
      scheduling,
    );
    if (spreadA !== spreadB) return spreadA - spreadB;
    const tie = (a.room.charCodeAt(0) + seed) % 5;
    const tie2 = (b.room.charCodeAt(0) + seed) % 5;
    if (tie !== tie2) return tie - tie2;
    return a.room.localeCompare(b.room, "he");
  });
}

function personAlreadyInSlot(
  personName: string,
  slotId: string,
  missionId: string,
  tracker: ScheduleTracker,
): boolean {
  return (tracker.busy[personName] || []).some(
    (b) => b.slotId === slotId && b.missionId === missionId,
  );
}

function applyChoice(
  unit: AssignmentUnit,
  choice: CandidateChoice,
  state: SolverState,
  rules: FairnessRules,
): void {
  const scheduling = schedulingFor(unit.mission);
  const seats = state.assignmentsByMission.get(unit.mission.id)!;
  const row = seats[unit.slot.slotId] || [];

  if (unit.kind === "basework" && choice.kind === "basework") {
    let ni = 0;
    for (const idx of unit.seatIndices) {
      if (row[idx]) continue;
      const name = choice.names[ni++];
      if (!name) continue;
      row[idx] = name;
      if (!personAlreadyInSlot(name, unit.slot.slotId, unit.mission.id, state.tracker)) {
        placePerson(
          name,
          unit.slot,
          unit.mission.id,
          state.tracker,
          rules,
          scheduling,
          unit.slot.seatCount,
          unit.mission.mission_type,
        );
      }
    }
    seats[unit.slot.slotId] = row;
    state.assignedUnitIds.add(unit.id);
    return;
  }

  if (unit.kind === "carmel" && choice.kind === "carmel") {
    let pi = 0;
    for (const idx of unit.seatIndices) {
      const name = choice.group.people[pi++]?.name;
      if (!name) continue;
      row[idx] = name;
      if (!personAlreadyInSlot(name, unit.slot.slotId, unit.mission.id, state.tracker)) {
        placePerson(
          name,
          unit.slot,
          unit.mission.id,
          state.tracker,
          rules,
          scheduling,
          unit.slot.seatCount,
          unit.mission.mission_type,
        );
      }
    }
    seats[unit.slot.slotId] = row;
    state.assignedUnitIds.add(unit.id);
    return;
  }

  if (unit.kind === "seat" && choice.kind === "seat") {
    row[unit.seatIndex] = choice.person.name;
    seats[unit.slot.slotId] = row;
    placePerson(
      choice.person.name,
      unit.slot,
      unit.mission.id,
      state.tracker,
      rules,
      scheduling,
      unit.slot.seatCount,
      unit.mission.mission_type,
    );
    state.assignedUnitIds.add(unit.id);
    return;
  }

  if (unit.kind === "guard_pair" && choice.kind === "guard_pair") {
    let pi = 0;
    for (const idx of unit.seatIndices) {
      if (row[idx]) continue;
      const person = choice.people[pi++];
      if (!person) continue;
      row[idx] = person.name;
      if (!personAlreadyInSlot(person.name, unit.slot.slotId, unit.mission.id, state.tracker)) {
        placePerson(
          person.name,
          unit.slot,
          unit.mission.id,
          state.tracker,
          rules,
          scheduling,
          unit.slot.seatCount,
          unit.mission.mission_type,
        );
      }
    }
    seats[unit.slot.slotId] = row;
    state.assignedUnitIds.add(unit.id);
  }
}

function revertChoice(
  unit: AssignmentUnit,
  choice: CandidateChoice,
  state: SolverState,
  rules: FairnessRules,
): void {
  const scheduling = schedulingFor(unit.mission);
  const seats = state.assignmentsByMission.get(unit.mission.id)!;
  const row = seats[unit.slot.slotId] || [];

  if (unit.kind === "basework" && choice.kind === "basework") {
    for (const name of choice.names) {
      for (const idx of unit.seatIndices) {
        if (row[idx] === name) row[idx] = "";
      }
      unplacePerson(name, unit.slot, unit.mission.id, state.tracker, rules, scheduling);
    }
    seats[unit.slot.slotId] = row;
    state.assignedUnitIds.delete(unit.id);
    return;
  }

  if (unit.kind === "carmel" && choice.kind === "carmel") {
    for (const idx of unit.seatIndices) {
      const name = row[idx];
      if (!name || unit.fixedNames.includes(name)) continue;
      row[idx] = "";
      unplacePerson(name, unit.slot, unit.mission.id, state.tracker, rules, scheduling);
    }
    seats[unit.slot.slotId] = row;
    state.assignedUnitIds.delete(unit.id);
    return;
  }

  if (unit.kind === "seat" && choice.kind === "seat") {
    row[unit.seatIndex] = "";
    seats[unit.slot.slotId] = row;
    unplacePerson(choice.person.name, unit.slot, unit.mission.id, state.tracker, rules, scheduling);
    state.assignedUnitIds.delete(unit.id);
    return;
  }

  if (unit.kind === "guard_pair" && choice.kind === "guard_pair") {
    for (const idx of unit.seatIndices) {
      const name = row[idx];
      if (!name) continue;
      row[idx] = "";
      unplacePerson(name, unit.slot, unit.mission.id, state.tracker, rules, scheduling);
    }
    seats[unit.slot.slotId] = row;
    state.assignedUnitIds.delete(unit.id);
  }
}

/** ממלא קצין תורן — תמיד רני/יסמין, משמרת אחת לכל אחד כשאפשר */
function dutyOfficersFromPeople(people: Person[]): Person[] {
  const byName = Object.fromEntries(people.map((p) => [p.name, p]));
  const ordered: Person[] = [];
  for (const name of DUTY_OFFICER_NAMES) {
    const person = byName[name];
    if (person && personIsDutyOfficer(person)) ordered.push(person);
  }
  for (const person of people.filter(personIsDutyOfficer)) {
    if (!ordered.some((o) => o.name === person.name)) ordered.push(person);
  }
  return ordered;
}

function pickDutyOfficerForSeed(
  officers: Person[],
  sibling: string | undefined,
  mates: string[],
  slot: FlatSlot,
  state: SolverState,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  peopleByName: Record<string, Person>,
): Person | undefined {
  const pool = sibling ? officers.filter((o) => o.name !== sibling) : officers;

  const preferred = pool.find(
    (o) =>
      !mates.includes(o.name) &&
      fitsPerson(o, slot, state.tracker, issues, scheduling, mates, peopleByName),
  );
  if (preferred) return preferred;

  // קצין תורן — תמיד רני/יסמין גם אם מנוחה/4-8 היו חוסמים בשיבוץ רגיל.
  return pool.find((o) => !mates.includes(o.name) && personIsDutyOfficer(o));
}

function seedOfficerDutyInState(
  missions: MissionDay[],
  people: Person[],
  issues: Issue[],
  rules: FairnessRules,
  state: SolverState,
  keepExisting: boolean,
): void {
  const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
  const officers = dutyOfficersFromPeople(people);
  if (!officers.length) return;

  for (const mission of missions) {
    if (mission.mission_type !== "guards") continue;
    const scheduling = schedulingFor(mission);
    const slots = flattenMissionSlots(mission)
      .filter((s) => s.positionKind === "officer_duty")
      .sort((a, b) => a.sortKey - b.sortKey);

    const assignments = state.assignmentsByMission.get(mission.id);
    if (!assignments) continue;

    const usedOfficers = new Set<string>();
    for (const slot of slots) {
      const row = [...(assignments[slot.slotId] || [])];
      for (let seatIndex = 0; seatIndex < slot.seatCount; seatIndex++) {
        const existing = row[seatIndex];
        if (existing && keepExisting) {
          if (personIsDutyOfficer(peopleByName[existing])) {
            usedOfficers.add(existing);
            continue;
          }
          unplacePerson(existing, slot, mission.id, state.tracker, rules, scheduling);
          row[seatIndex] = "";
        }
        if (existing && !keepExisting) {
          unplacePerson(existing, slot, mission.id, state.tracker, rules, scheduling);
          row[seatIndex] = "";
        }

        const sibling =
          siblingDutyOfficerAssignee(mission, slot, assignments) ??
          ([...usedOfficers][0] as string | undefined);

        const mates = row.filter((n, idx) => n && idx !== seatIndex);
        const pick = pickDutyOfficerForSeed(
          officers,
          sibling,
          mates,
          slot,
          state,
          issues,
          scheduling,
          peopleByName,
        );

        if (!pick) continue;

        row[seatIndex] = pick.name;
        usedOfficers.add(pick.name);
        placePerson(
          pick.name,
          slot,
          mission.id,
          state.tracker,
          rules,
          scheduling,
          slot.seatCount,
          mission.mission_type,
        );
        state.assignedUnitIds.add(`${mission.id}:${slot.slotId}:${seatIndex}`);
      }
      assignments[slot.slotId] = row;
    }
  }
}

function evaluateLex(
  units: AssignmentUnit[],
  state: SolverState,
  people: Person[],
  rules: FairnessRules,
  meanPrior: number,
): number[] {
  const filled = countFilledSeats(units, state.assignmentsByMission);
  const required = countRequiredSeats(units);
  let carmelFilled = 0;
  for (const unit of units) {
    if (unit.kind !== "carmel") continue;
    const seats = state.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
    carmelFilled += unit.seatIndices.filter((i) => Boolean(seats[i])).length;
  }
  const fairnessSpread = rosterBurdenSpread(
    people,
    state.tracker,
    rules,
    undefined,
    "duty",
  );
  const kitchenSpread = rosterBurdenSpread(
    people,
    state.tracker,
    rules,
    undefined,
    "kitchen",
  );
  const guardCountSpread = rosterGuardCountSpread(people, state.tracker);
  return [
    filled,
    filled >= required ? 1 : 0,
    carmelFilled,
    -guardCountSpread,
    -fairnessSpread,
    -kitchenSpread,
  ];
}

function lexBetter(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

function solveGreedy(input: {
  units: AssignmentUnit[];
  people: Person[];
  issues: Issue[];
  rules: FairnessRules;
  meanPrior: number;
  initialState: SolverState;
  seed: number;
}): SolverState {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const state: SolverState = {
    tracker: cloneTracker(input.initialState.tracker),
    assignmentsByMission: cloneAssignments(input.initialState.assignmentsByMission),
    assignedUnitIds: new Set(input.initialState.assignedUnitIds),
  };

  for (;;) {
    const unit = pickNextUnit(
      input.units,
      state,
      input.people,
      input.issues,
      peopleByName,
      input.rules,
      input.meanPrior,
    );
    if (!unit) break;

    const choice: CandidateChoice | null =
      unit.kind === "carmel"
        ? (() => {
            const group = listCarmelCandidates(
              unit,
              state,
              input.people,
              input.issues,
              input.rules,
              input.meanPrior,
              peopleByName,
              input.seed,
            )[0];
            return group ? { kind: "carmel", group } : null;
          })()
        : unit.kind === "basework"
          ? (() => {
              const names = computeBaseworkNames(
                unit,
                state,
                input.people,
                input.issues,
                input.rules,
                input.meanPrior,
              );
              return names.length ? { kind: "basework", names } : null;
            })()
          : unit.kind === "guard_pair"
            ? (() => {
                const group = listGuardPairCandidates(
                  unit,
                  state,
                  input.people,
                  input.issues,
                  peopleByName,
                  input.rules,
                  input.meanPrior,
                  input.seed,
                )[0];
                return group?.length
                  ? { kind: "guard_pair", people: group }
                  : null;
              })()
            : (() => {
              const person = listSeatCandidates(
                unit,
                state,
                input.people,
                input.issues,
                input.rules,
                input.meanPrior,
                peopleByName,
                input.seed,
                input.units,
              )[0];
              return person ? { kind: "seat", person } : null;
            })();

    if (!choice) {
      state.assignedUnitIds.add(unit.id);
      continue;
    }
    applyChoice(unit, choice, state, input.rules);
  }

  return state;
}

function solveBacktracking(input: {
  units: AssignmentUnit[];
  people: Person[];
  issues: Issue[];
  rules: FairnessRules;
  meanPrior: number;
  initialState: SolverState;
  seed: number;
  maxNodes: number;
  deadlineMs: number;
}): { state: SolverState; nodes: number; score: number[]; timedOut: boolean } {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));
  const deadline = Date.now() + input.deadlineMs;

  let nodes = 0;
  let timedOut = false;
  let bestState = cloneState(input.initialState);
  let bestScore = evaluateLex(
    input.units,
    bestState,
    input.people,
    input.rules,
    input.meanPrior,
  );

  function cloneState(state: SolverState): SolverState {
    return {
      tracker: cloneTracker(state.tracker),
      assignmentsByMission: cloneAssignments(state.assignmentsByMission),
      assignedUnitIds: new Set(state.assignedUnitIds),
    };
  }

  function overBudget(): boolean {
    if (nodes >= input.maxNodes) return true;
    if (Date.now() >= deadline) {
      timedOut = true;
      return true;
    }
    return false;
  }

  function dfs(state: SolverState): void {
    if (overBudget()) return;
    nodes += 1;

    if (state.assignedUnitIds.size === input.units.length) {
      const score = evaluateLex(
        input.units,
        state,
        input.people,
        input.rules,
        input.meanPrior,
      );
      if (lexBetter(score, bestScore)) {
        bestScore = score;
        bestState = cloneState(state);
      }
      return;
    }

    const unit = pickNextUnit(
      input.units,
      state,
      input.people,
      input.issues,
      peopleByName,
      input.rules,
      input.meanPrior,
    );
    if (!unit) return;

    const choices: CandidateChoice[] =
      unit.kind === "carmel"
        ? listCarmelCandidates(
            unit,
            state,
            input.people,
            input.issues,
            input.rules,
            input.meanPrior,
            peopleByName,
            input.seed,
          ).map((group) => ({ kind: "carmel", group }))
        : unit.kind === "basework"
          ? (() => {
              const names = computeBaseworkNames(
                unit,
                state,
                input.people,
                input.issues,
                input.rules,
                input.meanPrior,
              );
              return names.length ? [{ kind: "basework" as const, names }] : [];
            })()
          : unit.kind === "guard_pair"
            ? listGuardPairCandidates(
                unit,
                state,
                input.people,
                input.issues,
                peopleByName,
                input.rules,
                input.meanPrior,
                input.seed,
              )
                .slice(0, MAX_SEAT_BRANCH)
                .map((people) => ({ kind: "guard_pair" as const, people }))
            : listSeatCandidates(
              unit,
              state,
              input.people,
              input.issues,
              input.rules,
              input.meanPrior,
              peopleByName,
              input.seed,
              input.units,
            )
              .slice(0, MAX_SEAT_BRANCH)
              .map((person) => ({ kind: "seat", person }));

    if (!choices.length) {
      const score = evaluateLex(
        input.units,
        state,
        input.people,
        input.rules,
        input.meanPrior,
      );
      if (lexBetter(score, bestScore)) {
        bestScore = score;
        bestState = cloneState(state);
      }
      return;
    }

    for (const choice of choices) {
      applyChoice(unit, choice, state, input.rules);
      if (carmelForwardOk(input.units, state, input.people, input.issues, peopleByName)) {
        dfs(state);
      }
      revertChoice(unit, choice, state, input.rules);
      if (overBudget()) break;
    }
  }

  dfs(cloneState(input.initialState));
  return { state: bestState, nodes, score: bestScore, timedOut };
}

function buildCarmelSnapshots(
  units: AssignmentUnit[],
  people: Person[],
  issues: Issue[],
  tracker: ScheduleTracker,
): CarmelFeasibilitySnapshot[] {
  const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
  const snapshots: CarmelFeasibilitySnapshot[] = [];
  for (const unit of units) {
    if (unit.kind !== "carmel") continue;
    const scheduling = schedulingFor(unit.mission);
    const groups = enumerateCarmelGroups({
      slot: unit.slot,
      people,
      need: unit.need,
      fixedNames: unit.fixedNames,
      tracker,
      issues,
      scheduling,
      peopleByName,
    });
    snapshots.push({
      slotId: unit.slot.slotId,
      positionName: unit.slot.positionName,
      timeLabel: unit.slot.timeLabel,
      initialGroupCount: groups.length,
      initialRooms: summarizeCarmelRooms(groups),
    });
  }
  return snapshots;
}

export function runGlobalAssign(input: GlobalAssignInput): GlobalAssignOutput {
  const missions = input.missions;
  const crossDay = input.crossDayMissions ?? [];
  const keepExisting = input.keepExisting;
  const maxNodes = input.maxNodes ?? DEFAULT_MAX_NODES;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const deadlineMs = input.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));

  const units = buildUnits(missions, keepExisting);
  const requiredSeats = countRequiredSeats(units);
  const tracker = seedExistingAssignments(
    missions,
    input.people,
    input.rules,
    crossDay,
    keepExisting,
  );
  const carmelSnapshots = buildCarmelSnapshots(units, input.people, input.issues, tracker);

  const initialState: SolverState = {
    tracker: cloneTracker(tracker),
    assignmentsByMission: initAssignments(missions, keepExisting),
    assignedUnitIds: new Set(
      units.filter((u) => {
        const seats =
          missions.find((m) => m.id === u.mission.id)?.assignments[u.slot.slotId] || [];
        if (u.kind === "carmel" || u.kind === "basework") {
          return u.seatIndices.every((i) => keepExisting && Boolean(seats[i]));
        }
        if (u.kind === "guard_pair") {
          return u.seatIndices.every((i) => keepExisting && Boolean(seats[i]));
        }
        return keepExisting && Boolean(seats[u.seatIndex]);
      }).map((u) => u.id),
    ),
  };

  seedOfficerDutyInState(
    missions,
    input.people,
    input.issues,
    input.rules,
    initialState,
    keepExisting,
  );

  let bestResult: { state: SolverState; nodes: number; score: number[]; timedOut: boolean } | null = null;
  let totalNodes = 0;
  let timedOut = false;

  const greedyState = solveGreedy({
    units,
    people: input.people,
    issues: input.issues,
    rules: input.rules,
    meanPrior: input.meanPrior,
    initialState,
    seed: 0,
  });
  bestResult = {
    state: greedyState,
    nodes: 0,
    score: evaluateLex(units, greedyState, input.people, input.rules, input.meanPrior),
    timedOut: false,
  };

  if (bestResult.score[0] >= requiredSeats && bestResult.score[1] === 1) {
    // Greedy already filled everything — skip expensive backtracking.
  } else if (units.length <= BACKTRACK_UNIT_LIMIT) {
  for (let seed = 0; seed < maxAttempts; seed++) {
    const result = solveBacktracking({
      units,
      people: input.people,
      issues: input.issues,
      rules: input.rules,
      meanPrior: input.meanPrior,
      initialState,
      seed,
      maxNodes: Math.floor(maxNodes / maxAttempts),
      deadlineMs: Math.floor(deadlineMs / maxAttempts),
    });
    totalNodes += result.nodes;
    timedOut = timedOut || result.timedOut;
    if (!bestResult || lexBetter(result.score, bestResult.score)) {
      bestResult = result;
    }
    if (bestResult.score[0] >= requiredSeats && bestResult.score[1] === 1) break;
    if (timedOut) break;
  }
  }

  const finalState = bestResult?.state ?? initialState;
  const filled = countFilledSeats(units, finalState.assignmentsByMission);
  const failureReasons = new Map<string, string[]>();

  for (const unit of units) {
    if (unit.kind !== "carmel") continue;
    if (stateHasCarmel(unit, finalState)) continue;
    const key = `${unit.mission.id}:${unit.slot.slotId}`;
    const remaining = countCarmelCandidates(
      unit,
      finalState,
      input.people,
      input.issues,
      peopleByName,
    );
    failureReasons.set(key, [
      remaining === 0
        ? "לא נותרה קבוצת חדר/מגדר תקפה (3 מקומות, אותו מין)"
        : "לא נמצאה קבוצה מתאימה בתוך חיפוש גלובלי",
    ]);
  }

  const unresolved = buildUnresolvedRequirements({
    units,
    assignmentsByMission: finalState.assignmentsByMission,
    carmelSnapshots,
    failureReasons,
  });
  const warnings = formatUnresolvedSummary(unresolved);
  if (timedOut && filled < requiredSeats) {
    warnings.unshift(
      "החיפוש הופסק לאחר מגבלת זמן — ייתכן שיבוץ חלקי; נסו שוב או מלאו ידנית משבצות שנותרו.",
    );
  }

  let carmelFilled = 0;
  let carmelRequired = 0;
  for (const unit of units) {
    if (unit.kind !== "carmel") continue;
    carmelRequired += unit.need;
    const seats = finalState.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
    carmelFilled += unit.seatIndices.filter((i) => Boolean(seats[i])).length;
  }

  const dutySpread = rosterBurdenSpread(
    input.people,
    finalState.tracker,
    input.rules,
    undefined,
    "duty",
  );
  const kitchenSpread = rosterBurdenSpread(
    input.people,
    finalState.tracker,
    input.rules,
    undefined,
    "kitchen",
  );
  const fairnessSpread = Math.round((dutySpread + kitchenSpread) * 1000) / 1000;

  const status = deriveStatus(filled, requiredSeats, []);

  return {
    status,
    assignmentsByMission: finalState.assignmentsByMission,
    filled,
    skipped: 0,
    requiredSeats,
    unresolved,
    warnings,
    carmelSnapshots,
    objectiveSummary: {
      filledSeats: filled,
      requiredSeats,
      carmelFilled,
      carmelRequired,
      fairnessSpread,
      searchNodes: totalNodes,
      attempts: maxAttempts,
      timedOut,
    },
  };
}

function stateHasCarmel(
  unit: Extract<AssignmentUnit, { kind: "carmel" }>,
  state: SolverState,
): boolean {
  const seats = state.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
  return unit.seatIndices.every((i) => Boolean(seats[i]));
}
