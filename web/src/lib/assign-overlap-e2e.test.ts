import { describe, expect, it } from "vitest";
import { validateAbasRosterIndependent } from "@/lib/abas-validator";
import { runGlobalAssign } from "@/lib/global-assign";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import {
  flattenMissionSlots,
  isBaseWorkAssignment,
  isRestConstrainedGuardKind,
  normalizeSchedulingRules,
  syncAssignmentSeats,
} from "@/lib/mission-utils";
import { DUTY_OFFICER_NAMES } from "@/lib/officers";
import {
  buildTrackerFromMissions,
  clearOverlappingAbasAssignments,
  collectRosterWarnings,
  forceFillEmptySeats,
  repairGuardAssignmentGaps,
  stripAbasTimeViolations,
  validateNoPersonOverlaps,
  type AssignConstraintPolicy,
} from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function rosterPerson(i: number): Person {
  const officers = DUTY_OFFICER_NAMES;
  if (i < officers.length) {
    return {
      id: `officer-${i}`,
      name: officers[i],
      email: null,
      squad: 1,
      room: "200",
      gender: i === 0 ? "m" : "f",
      active: true,
      prior_score: 0,
      no_guard: false,
      no_standby: false,
      no_standing: false,
      no_base_work: false,
      no_kitchen: false,
      is_officer: true,
      created_at: "",
    };
  }
  return {
    id: `p${i}`,
    name: `person-${i}`,
    email: null,
    squad: (i % 4) + 1,
    room: `10${(i % 8) + 1}`,
    gender: i % 2 === 0 ? "m" : "f",
    active: true,
    prior_score: 0,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    created_at: "",
  };
}

function wednesdayBoard(): MissionDay {
  const startsAt = "2026-09-16T09:00:00+03:00";
  const endsAt = "2026-09-17T09:00:00+03:00";
  const positions = buildGuardDayPositions({
    missionStartsAt: startsAt,
    missionEndsAt: endsAt,
    boardStart: "09:00",
    missionDate: "2026-09-16",
  });
  return {
    id: "wed-thu-09",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-09-16",
    starts_at: startsAt,
    ends_at: endsAt,
    status: "draft",
    positions,
    assignments: syncAssignmentSeats(positions, {}),
    scheduling_rules: {
      ...DEFAULT_MISSION_SCHEDULING_RULES,
      board_start: "09:00",
      rest_hours: 8,
      duty_guard_gap_minutes: 60,
    },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

/** Same post-process as auto-assign.ts for every board button. */
function runAssignButton(
  empty: MissionDay,
  people: Person[],
  options: {
    keepExisting: boolean;
    constraintPolicy: AssignConstraintPolicy;
    seed: number;
    preexisting?: Record<string, string[]>;
  },
): MissionDay {
  const mission: MissionDay = {
    ...empty,
    assignments: syncAssignmentSeats(
      empty.positions,
      options.preexisting ?? empty.assignments,
    ),
  };
  const output = runGlobalAssign({
    missions: [mission],
    people,
    issues: [],
    rules: DEFAULT_FAIRNESS_RULES,
    meanPrior: 0,
    keepExisting: options.keepExisting,
    randomSeed: options.seed,
    constraintPolicy: options.constraintPolicy,
  });

  let currentAssignments = syncAssignmentSeats(
    mission.positions,
    output.assignmentsByMission.get(mission.id) ?? mission.assignments,
  );
  const scheduling = normalizeSchedulingRules(mission.scheduling_rules);

  for (let round = 0; round < 3; round++) {
    const tracker = buildTrackerFromMissions(
      [{ ...mission, assignments: currentAssignments }],
      DEFAULT_FAIRNESS_RULES,
      new Set(),
      options.constraintPolicy,
    );
    currentAssignments = repairGuardAssignmentGaps({
      mission: { ...mission, assignments: currentAssignments },
      assignments: currentAssignments,
      people,
      tracker,
      issues: [],
      scheduling,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      randomSeed: options.seed,
    }).assignments;

    const trackerAfterRepair = buildTrackerFromMissions(
      [{ ...mission, assignments: currentAssignments }],
      DEFAULT_FAIRNESS_RULES,
      new Set(),
      options.constraintPolicy,
    );
    const filled = forceFillEmptySeats({
      mission: { ...mission, assignments: currentAssignments },
      assignments: currentAssignments,
      people,
      tracker: trackerAfterRepair,
      issues: [],
      scheduling,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      randomSeed: options.seed,
      allowCoverageFill: false,
    });
    currentAssignments = filled.assignments;
    if (filled.filled === 0) break;
  }

  const lastResortTracker = buildTrackerFromMissions(
    [{ ...mission, assignments: currentAssignments }],
    DEFAULT_FAIRNESS_RULES,
    new Set(),
    options.constraintPolicy,
  );
  currentAssignments = forceFillEmptySeats({
    mission: { ...mission, assignments: currentAssignments },
    assignments: currentAssignments,
    people,
    tracker: lastResortTracker,
    issues: [],
    scheduling,
    rules: DEFAULT_FAIRNESS_RULES,
    meanPrior: 0,
    randomSeed: options.seed,
    allowCoverageFill: true,
  }).assignments;

  currentAssignments = stripAbasTimeViolations({
    mission,
    assignments: currentAssignments,
    scheduling,
    rules: DEFAULT_FAIRNESS_RULES,
    constraintPolicy: options.constraintPolicy,
  }).assignments;
  currentAssignments = clearOverlappingAbasAssignments({
    mission,
    assignments: currentAssignments,
  }).assignments;

  return { ...mission, assignments: currentAssignments };
}

function abasGuardOverlapMessages(mission: MissionDay): string[] {
  const slots = flattenMissionSlots(mission);
  const byPerson = new Map<string, typeof slots>();
  for (const slot of slots) {
    for (const raw of slot.assignees) {
      const name = String(raw || "").trim();
      if (!name) continue;
      const list = byPerson.get(name) || [];
      list.push(slot);
      byPerson.set(name, list);
    }
  }
  const msgs: string[] = [];
  for (const [person, list] of byPerson) {
    const abas = list.filter((s) =>
      isBaseWorkAssignment(s.positionKind, s.missionType, {
        positionName: s.positionName,
        startTime: s.startTime,
        endTime: s.endTime,
      }),
    );
    const guards = list.filter(
      (s) => isRestConstrainedGuardKind(s.positionKind) && s.missionType === "guards",
    );
    for (const a of abas) {
      for (const g of guards) {
        if (a.startAtMs < g.endAtMs && g.startAtMs < a.endAtMs) {
          msgs.push(
            `${person}: ${a.positionName} ${a.timeLabel} ∩ ${g.positionName} ${g.timeLabel}`,
          );
        }
      }
    }
  }
  return msgs;
}

function expectLegalRoster(mission: MissionDay, people: Person[]) {
  const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
  const abasGuard = abasGuardOverlapMessages(mission);
  expect(abasGuard).toEqual([]);
  expect(validateNoPersonOverlaps([mission])).toEqual([]);
  const overlapWarnings = collectRosterWarnings({
    missions: [mission],
    peopleByName,
  }).filter((w) => w.includes("חפיפה"));
  expect(overlapWarnings).toEqual([]);
  expect(
    validateAbasRosterIndependent({
      mission,
      people,
      minGuardAbasRestMin: 30,
    }).filter((v) => v.includes("חפיפה")),
  ).toEqual([]);
}

describe("Wednesday 09:00 → Thursday 09:00 assign buttons", () => {
  const people = Array.from({ length: 53 }, (_, i) => rosterPerson(i));

  it("שיבוץ מחדש does not place anyone on overlapping ABAS and guard", { timeout: 60000 }, () => {
    const mission = runAssignButton(wednesdayBoard(), people, {
      keepExisting: false,
      constraintPolicy: "standard",
      seed: 21,
    });
    expectLegalRoster(mission, people);
  });

  it("שיבוץ חכם (keep existing) does not add ABAS∩guard overlaps", { timeout: 60000 }, () => {
    const first = runAssignButton(wednesdayBoard(), people, {
      keepExisting: false,
      constraintPolicy: "standard",
      seed: 22,
    });
    expectLegalRoster(first, people);
    const second = runAssignButton(wednesdayBoard(), people, {
      keepExisting: true,
      constraintPolicy: "standard",
      seed: 23,
      preexisting: first.assignments,
    });
    expectLegalRoster(second, people);
  });

  it("חלוקה קשיחה does not place anyone on overlapping ABAS and guard", { timeout: 60000 }, () => {
    const mission = runAssignButton(wednesdayBoard(), people, {
      keepExisting: false,
      constraintPolicy: "strict_rest",
      seed: 24,
    });
    expectLegalRoster(mission, people);
  });

  it("surfaces a leftover ABAS∩guard in roster warnings", () => {
    const empty = wednesdayBoard();
    const slots = flattenMissionSlots(empty);
    const abas = slots.find((s) => s.missionType === "base_work" && s.startTime === "08:30")!;
    const guard = slots.find(
      (s) => s.positionKind === "guard" && s.startTime === "09:00" && s.endTime === "13:00",
    )!;
    const victim = people.find((p) => !p.is_officer)!;
    const assignments = { ...empty.assignments };
    const abasSeats = Array(abas.seatCount).fill("");
    abasSeats[0] = victim.name;
    assignments[abas.slotId] = abasSeats;
    assignments[guard.slotId] = [victim.name, ...(assignments[guard.slotId] || []).slice(1)];
    const broken = { ...empty, assignments };
    expect(abasGuardOverlapMessages(broken).length).toBeGreaterThan(0);
    const warnings = collectRosterWarnings({
      missions: [broken],
      peopleByName: Object.fromEntries(people.map((p) => [p.name, p])),
    });
    expect(warnings.some((w) => w.includes("חפיפה") && w.includes(victim.name))).toBe(true);
  });
});
