import {
  compareByFairnessThenBurden,
  explainFitsPersonFailure,
  fitsPerson,
  isBaseWorkAssignment,
  placePerson,
  unplacePerson,
  type ScheduleTracker,
} from "@/lib/scheduling-engine";
import type { FlatSlot } from "@/lib/mission-utils";
import { isGuardKind } from "@/lib/mission-utils";
import {
  guardAbasRestOk,
  missionIdleMinutes,
  missionIntervalsOverlap,
  toMissionTimelineInterval,
  type MissionTimelineInterval,
} from "@/lib/mission-timeline";
import type {
  FairnessRules,
  Issue,
  MissionDay,
  MissionSchedulingRules,
  Person,
} from "@/lib/types";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

export type AbasShiftInput = {
  id: string;
  mission: MissionDay;
  slot: FlatSlot;
  seatIndices: number[];
  fixedNames: string[];
  required: number;
};

export type AbasPersonRejection = {
  personName: string;
  shiftLabel: string;
  eligible: boolean;
  summary: string;
  details: string[];
};

export type AbasShiftDiagnostics = {
  label: string;
  required: number;
  eligibleCandidates: number;
  assigned: number;
  rejections: AbasPersonRejection[];
};

export type AbasHallBottleneck = {
  shifts: string[];
  required: number;
  capacity: number;
};

export type AbasSolveResult = {
  status: "complete" | "unsat";
  namesByShiftId: Map<string, string[]>;
  diagnostics: AbasShiftDiagnostics[];
  hallBottlenecks: AbasHallBottleneck[];
  firstShiftLabel: string | null;
  firstShiftReason: string | null;
  searchNodes: number;
  backtracks: number;
};

function isAbasMeta(slot: {
  positionKind: FlatSlot["positionKind"];
  missionType: FlatSlot["missionType"];
  positionName?: string;
  startTime?: string;
  endTime?: string;
}): boolean {
  return isBaseWorkAssignment(slot.positionKind, slot.missionType, {
    positionName: slot.positionName,
    startTime: slot.startTime,
    endTime: slot.endTime,
  });
}

function gapMinutes(scheduling: MissionSchedulingRules): number {
  return (
    scheduling.duty_guard_gap_minutes ??
    DEFAULT_MISSION_SCHEDULING_RULES.duty_guard_gap_minutes ??
    30
  );
}

function slotTl(slot: FlatSlot, missionStartMs: number): MissionTimelineInterval {
  return toMissionTimelineInterval(missionStartMs, slot.startAtMs, slot.endAtMs);
}

function blockTl(
  block: { startAtMs: number; endAtMs: number },
  missionStartMs: number,
): MissionTimelineInterval {
  return toMissionTimelineInterval(missionStartMs, block.startAtMs, block.endAtMs);
}

function isCarmelA(kind: string | undefined): boolean {
  return kind === "standby_carmel_a";
}

export function explainAbasEligibility(input: {
  person: Person;
  slot: FlatSlot;
  tracker: ScheduleTracker;
  issues: Issue[];
  scheduling: MissionSchedulingRules;
  mates: string[];
  peopleByName: Record<string, Person>;
  missionStartMs: number;
}): AbasPersonRejection {
  const { person, slot, tracker, scheduling, missionStartMs } = input;
  const label = slot.timeLabel;
  const details: string[] = [];
  const abas = slotTl(slot, missionStartMs);
  const gapMin = gapMinutes(scheduling);

  if (person.no_base_work) {
    return {
      personName: person.name,
      shiftLabel: label,
      eligible: false,
      summary: "INELIGIBLE — פטור מעב״ס",
      details: [`${person.name}: no_base_work`],
    };
  }

  for (const issue of input.issues) {
    if (issue.person_name !== person.name || issue.status !== "approved") continue;
  }

  const code = explainFitsPersonFailure(
    person,
    slot,
    tracker,
    input.issues,
    scheduling,
    input.mates,
    input.peopleByName,
  );

  for (const b of tracker.busy[person.name] || []) {
    if (b.slotId === slot.slotId) continue;
    if (isCarmelA(b.positionKind)) {
      return {
        personName: person.name,
        shiftLabel: label,
        eligible: false,
        summary: "INELIGIBLE — כרמל א׳ full-day",
        details: [
          `${person.name} rejected:`,
          `* כרמל א׳ ${b.startTime} D → ${b.endTime} D+1`,
          `* RESULT = INELIGIBLE`,
        ],
      };
    }
    if (b.positionKind === "standby_carmel_b") continue;

    const other = blockTl(b, missionStartMs);
    const otherIsGuard = isGuardKind(b.positionKind) && !isAbasMeta(b);
    const overlap = missionIntervalsOverlap(abas, other);
    if (overlap) {
      const idle = 0;
      details.push(
        `* ${otherIsGuard ? "guard" : b.positionName ?? b.positionKind} ${b.startTime}–${b.endTime}`,
        `* ABAS ${slot.startTime}–${slot.endTime}`,
        `* overlap = ${Math.round(Math.min(abas.endMin, other.endMin) - Math.max(abas.startMin, other.startMin))} minutes`,
        `* RESULT = INELIGIBLE`,
      );
      return {
        personName: person.name,
        shiftLabel: label,
        eligible: false,
        summary: "INELIGIBLE — overlap",
        details: [`${person.name} rejected:`, ...details],
      };
    }

    if (otherIsGuard) {
      const idle = missionIdleMinutes(abas, other) ?? 0;
      const ok = guardAbasRestOk(other, abas, gapMin);
      details.push(
        `* guard ${b.startTime}–${b.endTime}`,
        `* ABAS ${slot.startTime}–${slot.endTime}`,
        `* rest = ${Math.round(idle)} minutes`,
        `* REQUIRED = ${gapMin} minutes`,
        `* RESULT = ${ok ? "ELIGIBLE" : "INELIGIBLE"}`,
      );
      if (!ok) {
        return {
          personName: person.name,
          shiftLabel: label,
          eligible: false,
          summary: `INELIGIBLE — guard↔ABAS rest ${Math.round(idle)} < ${gapMin}`,
          details: [`${person.name} rejected:`, ...details],
        };
      }
    }
  }

  if (code) {
    return {
      personName: person.name,
      shiftLabel: label,
      eligible: false,
      summary: `INELIGIBLE — ${code}`,
      details: details.length ? details : [`${person.name}: ${code}`],
    };
  }

  return {
    personName: person.name,
    shiftLabel: label,
    eligible: true,
    summary: "ELIGIBLE",
    details,
  };
}

function abasHardFits(
  person: Person,
  slot: FlatSlot,
  tracker: ScheduleTracker,
  issues: Issue[],
  scheduling: MissionSchedulingRules,
  mates: string[],
  peopleByName: Record<string, Person>,
): boolean {
  return fitsPerson(person, slot, tracker, issues, scheduling, mates, peopleByName);
}

function shiftsOverlap(a: FlatSlot, b: FlatSlot, missionStartMs: number): boolean {
  return missionIntervalsOverlap(slotTl(a, missionStartMs), slotTl(b, missionStartMs));
}

function hallCapacity(input: {
  people: Person[];
  shifts: AbasShiftInput[];
  eligible: Map<string, Set<string>>;
  subset: number[];
  missionStartMs: number;
}): number {
  let cap = 0;
  for (const person of input.people) {
    const idxs = input.subset.filter((i) =>
      input.eligible.get(input.shifts[i].id)?.has(person.name),
    );
    if (!idxs.length) continue;
    const graph = idxs.map((i) => input.shifts[i].slot);
    cap += maxNonOverlappingCount(graph, input.missionStartMs);
  }
  return cap;
}

function maxNonOverlappingCount(slots: FlatSlot[], missionStartMs: number): number {
  if (slots.length <= 1) return slots.length;
  const n = slots.length;
  let best = 1;
  for (let mask = 1; mask < 1 << n; mask++) {
    const chosen: FlatSlot[] = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      for (const prev of chosen) {
        if (shiftsOverlap(prev, slots[i], missionStartMs)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      chosen.push(slots[i]);
    }
    if (ok) best = Math.max(best, chosen.length);
  }
  return best;
}

export function formatAbasDiagnostics(result: AbasSolveResult): string {
  const lines: string[] = [];
  for (const d of result.diagnostics) {
    lines.push(`ABAS ${d.label}`);
    lines.push(`required: ${d.required}`);
    lines.push(`eligible candidates: ${d.eligibleCandidates}`);
    lines.push(`assigned: ${d.assigned}`);
    const samples = d.rejections.filter((r) => !r.eligible).slice(0, 3);
    for (const r of samples) {
      lines.push(`${r.personName} rejected from ${d.label}:`);
      for (const line of r.details) lines.push(line);
    }
    lines.push("");
  }
  if (result.firstShiftLabel) {
    lines.push(`First shift selected: ${result.firstShiftLabel}`);
    if (result.firstShiftReason) lines.push(`Why: ${result.firstShiftReason}`);
  }
  lines.push(`search nodes: ${result.searchNodes}`);
  lines.push(`backtracks: ${result.backtracks}`);
  lines.push(`status: ${result.status === "complete" ? "20/20/20 complete" : "UNSAT"}`);
  if (result.hallBottlenecks.length) {
    lines.push("Hall-type bottlenecks:");
    for (const b of result.hallBottlenecks) {
      lines.push(
        `  {${b.shifts.join(", ")}} required=${b.required} capacity=${b.capacity}`,
      );
    }
  }
  return lines.join("\n");
}

export function solveAbasShifts(input: {
  shifts: AbasShiftInput[];
  people: Person[];
  tracker: ScheduleTracker;
  issues: Issue[];
  scheduling: MissionSchedulingRules;
  rules: FairnessRules;
  meanPrior: number;
  peopleByName: Record<string, Person>;
}): AbasSolveResult {
  const shifts = input.shifts.filter((s) => s.required > 0);
  const namesByShiftId = new Map<string, string[]>();
  for (const shift of shifts) {
    namesByShiftId.set(shift.id, [...shift.fixedNames]);
  }
  if (!shifts.length) {
    return {
      status: "complete",
      namesByShiftId,
      diagnostics: [],
      hallBottlenecks: [],
      firstShiftLabel: null,
      firstShiftReason: null,
      searchNodes: 0,
      backtracks: 0,
    };
  }

  const missionStartMs = Date.parse(shifts[0].mission.starts_at);
  const eligible = new Map<string, Set<string>>();
  const diagnostics: AbasShiftDiagnostics[] = [];

  for (const shift of shifts) {
    const rejections: AbasPersonRejection[] = [];
    const set = new Set<string>(shift.fixedNames);
    for (const person of input.people) {
      if (!person.active) continue;
      if (shift.fixedNames.includes(person.name)) continue;
      if (
        abasHardFits(
          person,
          shift.slot,
          input.tracker,
          input.issues,
          input.scheduling,
          shift.fixedNames,
          input.peopleByName,
        )
      ) {
        set.add(person.name);
        continue;
      }
      if (rejections.length < 12) {
        rejections.push(
          explainAbasEligibility({
            person,
            slot: shift.slot,
            tracker: input.tracker,
            issues: input.issues,
            scheduling: input.scheduling,
            mates: shift.fixedNames,
            peopleByName: input.peopleByName,
            missionStartMs,
          }),
        );
      }
    }
    eligible.set(shift.id, set);
    diagnostics.push({
      label: shift.slot.timeLabel,
      required: shift.required,
      eligibleCandidates: set.size,
      assigned: shift.fixedNames.length,
      rejections: rejections.filter((r) => !r.eligible).slice(0, 12),
    });
  }

  const hallBottlenecks: AbasHallBottleneck[] = [];
  const n = shifts.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(i);
    const required = subset.reduce((sum, i) => sum + (shifts[i].required - shifts[i].fixedNames.length), 0);
    const capacity = hallCapacity({
      people: input.people,
      shifts,
      eligible,
      subset,
      missionStartMs,
    });
    if (capacity < required) {
      hallBottlenecks.push({
        shifts: subset.map((i) => shifts[i].slot.timeLabel),
        required,
        capacity,
      });
    }
  }

  const open = shifts
    .map((shift, index) => ({
      shift,
      index,
      remaining: Math.max(0, shift.required - shift.fixedNames.length),
      pool: eligible.get(shift.id)!.size,
    }))
    .filter((s) => s.remaining > 0);
  open.sort((a, b) => a.pool - b.pool || a.remaining - b.remaining);
  const first = open[0] ?? null;

  let searchNodes = 0;
  let backtracks = 0;
  const assigned = new Map<string, string[]>();
  for (const shift of shifts) {
    assigned.set(shift.id, [...shift.fixedNames]);
  }

  const personByName = input.peopleByName;

  function currentlyEligible(shift: AbasShiftInput): Person[] {
    const taken = new Set(assigned.get(shift.id));
    const mates = [...taken];
    const out: Person[] = [];
    for (const name of eligible.get(shift.id) ?? []) {
      if (taken.has(name)) continue;
      const person = personByName[name];
      if (!person) continue;
      if (
        abasHardFits(
          person,
          shift.slot,
          input.tracker,
          input.issues,
          input.scheduling,
          mates,
          input.peopleByName,
        )
      ) {
        out.push(person);
      }
    }
    return out;
  }

  function pickShift(): AbasShiftInput | null {
    let best: AbasShiftInput | null = null;
    let bestSlack = Infinity;
    for (const shift of shifts) {
      const have = assigned.get(shift.id)!.length;
      const remaining = shift.required - have;
      if (remaining <= 0) continue;
      const pool = currentlyEligible(shift).length;
      const slack = pool - remaining;
      if (slack < bestSlack) {
        bestSlack = slack;
        best = shift;
      }
    }
    return best;
  }

  function orderPeople(shift: AbasShiftInput, pool: Person[]): Person[] {
    const remainingShifts = shifts.filter(
      (s) => s.id !== shift.id && assigned.get(s.id)!.length < s.required,
    );
    return [...pool].sort((a, b) => {
      const flexA = remainingShifts.filter((s) =>
        (eligible.get(s.id) ?? new Set()).has(a.name),
      ).length;
      const flexB = remainingShifts.filter((s) =>
        (eligible.get(s.id) ?? new Set()).has(b.name),
      ).length;
      if (flexA !== flexB) return flexA - flexB;
      const cmp = compareByFairnessThenBurden(
        a,
        b,
        shift.slot,
        input.people,
        input.tracker,
        input.rules,
        input.meanPrior,
        input.scheduling,
        shift.slot.seatCount,
      );
      return cmp || a.name.localeCompare(b.name, "he");
    });
  }

  function forwardOk(): boolean {
    for (const shift of shifts) {
      const remaining = shift.required - assigned.get(shift.id)!.length;
      if (remaining <= 0) continue;
      if (currentlyEligible(shift).length < remaining) return false;
    }
    return true;
  }

  function commitPerson(shift: AbasShiftInput, person: Person) {
    assigned.get(shift.id)!.push(person.name);
    placePerson(
      person.name,
      shift.slot,
      shift.mission.id,
      input.tracker,
      input.rules,
      input.scheduling,
      shift.slot.seatCount,
      shift.mission.mission_type,
    );
  }

  function undoPerson(shift: AbasShiftInput, person: Person) {
    unplacePerson(
      person.name,
      shift.slot,
      shift.mission.id,
      input.tracker,
      input.rules,
      input.scheduling,
    );
    assigned.get(shift.id)!.pop();
  }

  function overlapsUnfilled(shift: AbasShiftInput): boolean {
    return shifts.some(
      (other) =>
        other.id !== shift.id &&
        assigned.get(other.id)!.length < other.required &&
        shiftsOverlap(shift.slot, other.slot, missionStartMs),
    );
  }

  const MAX_SEARCH_NODES = 8_000;

  function dfs(): boolean {
    searchNodes += 1;
    if (searchNodes > MAX_SEARCH_NODES) return false;
    const shift = pickShift();
    if (!shift) return true;
    const remaining = shift.required - assigned.get(shift.id)!.length;
    const pool = orderPeople(shift, currentlyEligible(shift));
    if (pool.length < remaining) return false;

    // Non-overlapping ABAS windows don't compete: fill this shift in one step.
    if (!overlapsUnfilled(shift)) {
      const pick = pool.slice(0, remaining);
      for (const person of pick) commitPerson(shift, person);
      if (forwardOk() && dfs()) return true;
      backtracks += 1;
      for (let i = pick.length - 1; i >= 0; i--) undoPerson(shift, pick[i]);
      return false;
    }

    for (const person of pool) {
      commitPerson(shift, person);
      if (forwardOk() && dfs()) return true;
      backtracks += 1;
      undoPerson(shift, person);
      if (searchNodes > MAX_SEARCH_NODES) return false;
    }
    return false;
  }

  const solved = !open.length || (forwardOk() && dfs());

  if (!solved) {
    for (const shift of shifts) {
      const extra = assigned.get(shift.id)!.filter((n) => !shift.fixedNames.includes(n));
      for (const name of extra) {
        unplacePerson(
          name,
          shift.slot,
          shift.mission.id,
          input.tracker,
          input.rules,
          input.scheduling,
        );
      }
      assigned.set(shift.id, [...shift.fixedNames]);
    }
  }

  for (const shift of shifts) {
    const names = assigned.get(shift.id) ?? [];
    namesByShiftId.set(shift.id, names);
    const diag = diagnostics.find((d) => d.label === shift.slot.timeLabel);
    if (diag) diag.assigned = names.length;
  }

  const complete = shifts.every(
    (s) => (namesByShiftId.get(s.id) ?? []).length >= s.required,
  );

  return {
    status: complete ? "complete" : "unsat",
    namesByShiftId,
    diagnostics,
    hallBottlenecks,
    firstShiftLabel: first?.shift.slot.timeLabel ?? null,
    firstShiftReason: first
      ? `MRV: ${first.pool} eligible for ${first.remaining} remaining seats (fewest candidates first)`
      : null,
    searchNodes,
    backtracks,
  };
}
