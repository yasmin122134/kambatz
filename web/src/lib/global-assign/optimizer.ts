import { calculatePersonBurden } from "@/lib/guard-burden";
import {
  buildTrackerFromMissions,
  fitsPerson,
  placePerson,
  unplacePerson,
  workScore,
  type ScheduleTracker,
} from "@/lib/scheduling-engine";
import {
  flattenMissionSlots,
  isGuardKind,
  isStandbyKind,
  normalizeSchedulingRules,
  syncAssignmentSeats,
} from "@/lib/mission-utils";
import type { FairnessRules, Issue, MissionDay, MissionSchedulingRules, Person } from "@/lib/types";
import { enumerateCarmelGroups, summarizeCarmelRooms } from "./carmel-groups";
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
  | { kind: "seat"; person: Person };

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
    for (const slot of flattenMissionSlots(mission)) {
      const seats = assignments[slot.slotId] || [];
      const emptyIndices = seats
        .map((name, i) => ({ name, i }))
        .filter(({ name }) => !name || (!keepExisting && name))
        .map(({ i }) => i);

      if (!emptyIndices.length) continue;

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
    tracker.periodPoints[name] = calculatePersonBurden(
      tracker.busy[name] || [],
      rules,
      missionScheduling,
    ).totalBurden;
  }

  return tracker;
}

function initAssignments(missions: MissionDay[]): Map<string, Record<string, string[]>> {
  const map = new Map<string, Record<string, string[]>>();
  for (const mission of missions) {
    map.set(mission.id, syncAssignmentSeats(mission.positions, { ...mission.assignments }));
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
  return enumerateCarmelGroups({
    slot: unit.slot,
    people,
    need: unit.need,
    fixedNames: unit.fixedNames,
    tracker: state.tracker,
    issues,
    scheduling,
    peopleByName,
  }).length;
}

function unitDifficulty(
  unit: AssignmentUnit,
  state: SolverState,
  people: Person[],
  issues: Issue[],
  peopleByName: Record<string, Person>,
): number {
  const candidates =
    unit.kind === "carmel"
      ? countCarmelCandidates(unit, state, people, issues, peopleByName)
      : countSeatCandidates(unit, state, people, issues, peopleByName);

  if (unit.kind === "carmel") {
    return 100_000 + 10_000 / Math.max(1, candidates);
  }
  if (unit.slot.positionKind === "officer_duty") {
    return 50_000 + 5_000 / Math.max(1, candidates);
  }
  if (isGuardKind(unit.slot.positionKind)) {
    return 10_000 + 1_000 / Math.max(1, candidates);
  }
  if (unit.mission.mission_type === "base_work") {
    return 1_000 + 100 / Math.max(1, candidates);
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
): AssignmentUnit | null {
  let best: AssignmentUnit | null = null;
  let bestScore = -Infinity;
  for (const unit of units) {
    if (state.assignedUnitIds.has(unit.id)) continue;
    const score = unitDifficulty(unit, state, people, issues, peopleByName);
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
  const seats = state.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
  const mates = matesForSeat(seats, unit.seatIndex);
  const pool = people.filter(
    (p) =>
      !mates.includes(p.name) &&
      fitsPerson(p, unit.slot, state.tracker, issues, scheduling, mates, peopleByName),
  );

  return pool.sort((a, b) => {
    const eligibleA = countPersonScarcity(a, units, issues, state, peopleByName);
    const eligibleB = countPersonScarcity(b, units, issues, state, peopleByName);
    if (eligibleA !== eligibleB) return eligibleA - eligibleB;
    const wa = workScore(a, state.tracker, rules, meanPrior);
    const wb = workScore(b, state.tracker, rules, meanPrior);
    if (wa !== wb) return wa - wb;
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
    const avg = (g: CarmelGroupCandidate) =>
      g.people.reduce((s, p) => s + workScore(p, state.tracker, rules, meanPrior), 0) /
      g.people.length;
    const da = avg(a);
    const db = avg(b);
    if (da !== db) return da - db;
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
  }
}

function evaluateLex(
  units: AssignmentUnit[],
  state: SolverState,
): number[] {
  const filled = countFilledSeats(units, state.assignmentsByMission);
  const required = countRequiredSeats(units);
  let carmelFilled = 0;
  let carmelRequired = 0;
  for (const unit of units) {
    if (unit.kind !== "carmel") continue;
    carmelRequired += unit.need;
    const seats = state.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
    carmelFilled += unit.seatIndices.filter((i) => Boolean(seats[i])).length;
  }
  const burdens = Object.values(state.tracker.periodPoints);
  const fairnessSpread =
    burdens.length > 1 ? Math.max(...burdens) - Math.min(...burdens) : 0;
  return [filled, filled >= required ? 1 : 0, carmelFilled, -fairnessSpread];
}

function lexBetter(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
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
}): { state: SolverState; nodes: number; score: number[] } {
  const peopleByName = Object.fromEntries(input.people.map((p) => [p.name, p]));

  let nodes = 0;
  let bestState = cloneState(input.initialState);
  let bestScore = evaluateLex(input.units, bestState);

  function cloneState(state: SolverState): SolverState {
    return {
      tracker: cloneTracker(state.tracker),
      assignmentsByMission: cloneAssignments(state.assignmentsByMission),
      assignedUnitIds: new Set(state.assignedUnitIds),
    };
  }

  function dfs(state: SolverState): void {
    if (nodes >= input.maxNodes) return;
    nodes += 1;

    if (state.assignedUnitIds.size === input.units.length) {
      const score = evaluateLex(input.units, state);
      if (lexBetter(score, bestScore)) {
        bestScore = score;
        bestState = cloneState(state);
      }
      return;
    }

    const unit = pickNextUnit(input.units, state, input.people, input.issues, peopleByName);
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
          ).map((person) => ({ kind: "seat", person }));

    if (!choices.length) {
      const score = evaluateLex(input.units, state);
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
      if (nodes >= input.maxNodes) break;
    }
  }

  dfs(cloneState(input.initialState));
  return { state: bestState, nodes, score: bestScore };
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
  const maxNodes = input.maxNodes ?? 80_000;
  const maxAttempts = input.maxAttempts ?? 4;
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
    assignmentsByMission: initAssignments(missions),
    assignedUnitIds: new Set(
      units.filter((u) => {
        if (u.kind === "carmel") {
          const seats = missions.find((m) => m.id === u.mission.id)?.assignments[u.slot.slotId] || [];
          return u.seatIndices.every((i) => keepExisting && Boolean(seats[i]));
        }
        const seats = missions.find((m) => m.id === u.mission.id)?.assignments[u.slot.slotId] || [];
        return keepExisting && Boolean(seats[u.seatIndex]);
      }).map((u) => u.id),
    ),
  };

  let bestResult: { state: SolverState; nodes: number; score: number[] } | null = null;
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
    });
    if (!bestResult || lexBetter(result.score, bestResult.score)) {
      bestResult = result;
    }
    if (bestResult.score[0] >= requiredSeats && bestResult.score[1] === 1) break;
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

  let carmelFilled = 0;
  let carmelRequired = 0;
  for (const unit of units) {
    if (unit.kind !== "carmel") continue;
    carmelRequired += unit.need;
    const seats = finalState.assignmentsByMission.get(unit.mission.id)?.[unit.slot.slotId] || [];
    carmelFilled += unit.seatIndices.filter((i) => Boolean(seats[i])).length;
  }

  const burdens = Object.values(finalState.tracker.periodPoints);
  const fairnessSpread =
    burdens.length > 1 ? Math.max(...burdens) - Math.min(...burdens) : 0;

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
      searchNodes: bestResult?.nodes ?? 0,
      attempts: maxAttempts,
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
