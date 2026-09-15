import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots, syncAssignmentSeats, coverageFillRank } from "@/lib/mission-utils";
import {
  buildTrackerFromMissions,
  clearOverlappingAbasAssignments,
  explainFitsPersonFailure,
  fitsPerson,
  forceFillEmptySeats,
  placePerson,
  stripAbasTimeViolations,
  validateNoPersonOverlaps,
} from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = {
  ...DEFAULT_MISSION_SCHEDULING_RULES,
  rest_hours: 8,
  duty_guard_gap_minutes: 60,
};

function person(name: string): Person {
  return {
    id: name,
    name,
    email: null,
    room: "101",
    gender: "m",
    squad: 1,
    active: true,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    prior_score: 0,
    created_at: "",
  };
}

function missionWithSlots(
  slots: Array<{
    id: string;
    name: string;
    kind: MissionDay["positions"][0]["kind"];
    start: string;
    end: string;
    seats: number;
  }>,
  extras: Partial<MissionDay> = {},
): MissionDay {
  const positions = slots.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    same_room: false,
    same_gender: false,
    slots: [
      {
        id: `${s.id}-slot`,
        start_time: s.start,
        end_time: s.end,
        seat_count: s.seats,
      },
    ],
  }));
  const assignments = Object.fromEntries(
    positions.flatMap((p) =>
      p.slots.map((slot) => [slot.id, Array.from({ length: slot.seat_count }, () => "")]),
    ),
  );
  return {
    id: "g1",
    title: "guards",
    mission_type: "guards",
    mission_date: "2026-08-21",
    starts_at: "2026-08-21T08:00:00",
    ends_at: "2026-08-22T08:00:00",
    status: "draft",
    positions,
    assignments,
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
    ...extras,
  };
}

function slotByName(mission: MissionDay, name: string) {
  return flattenMissionSlots(mission).find((s) => s.positionName.includes(name))!;
}

describe("strict_rest constraint policy", () => {
  const p = person("Alex");
  const peopleByName = { [p.name]: p };

  it("standard assign still allows a 1h gate then another 1h after 3h idle", () => {
    const mission = missionWithSlots([
      { id: "g1", name: "שער אחורי", kind: "guard", start: "08:00", end: "09:00", seats: 1 },
      { id: "g2", name: "שער קדמי", kind: "guard", start: "12:00", end: "13:00", seats: 1 },
    ]);
    const first = slotByName(mission, "אחורי");
    const second = slotByName(mission, "קדמי");
    const tracker = buildTrackerFromMissions([], rules);
    placePerson(p.name, first, mission.id, tracker, rules, scheduling, 1, "guards");

    expect(fitsPerson(p, second, tracker, [], scheduling, [], peopleByName)).toBe(true);
    expect(explainFitsPersonFailure(p, second, tracker, [], scheduling, [], peopleByName)).toBeNull();
  });

  it("strict_rest rejects the same 3h gap because rest_hours is 8", () => {
    const mission = missionWithSlots([
      { id: "g1", name: "שער אחורי", kind: "guard", start: "08:00", end: "09:00", seats: 1 },
      { id: "g2", name: "שער קדמי", kind: "guard", start: "12:00", end: "13:00", seats: 1 },
    ]);
    const first = slotByName(mission, "אחורי");
    const second = slotByName(mission, "קדמי");
    const tracker = buildTrackerFromMissions([], rules, new Set(), "strict_rest");
    placePerson(p.name, first, mission.id, tracker, rules, scheduling, 1, "guards");

    expect(fitsPerson(p, second, tracker, [], scheduling, [], peopleByName)).toBe(false);
    expect(
      explainFitsPersonFailure(p, second, tracker, [], scheduling, [], peopleByName),
    ).toBe("guardRestGap");
  });

  it("strict_rest allows a second guard after a full rest_hours idle", () => {
    const mission = missionWithSlots([
      { id: "g1", name: "שער אחורי", kind: "guard", start: "08:00", end: "09:00", seats: 1 },
      { id: "g2", name: "שער קדמי", kind: "guard", start: "17:00", end: "18:00", seats: 1 },
    ]);
    const first = slotByName(mission, "אחורי");
    const second = slotByName(mission, "קדמי");
    const tracker = buildTrackerFromMissions([], rules, new Set(), "strict_rest");
    placePerson(p.name, first, mission.id, tracker, rules, scheduling, 1, "guards");

    expect(fitsPerson(p, second, tracker, [], scheduling, [], peopleByName)).toBe(true);
  });

  it("strict_rest allows ABAS then a guard when idle meets the mission ABAS gap, even if under rest_hours", () => {
    const abas = missionWithSlots(
      [{ id: "a", name: "עבודות בסיס", kind: "duty", start: "08:30", end: "11:30", seats: 1 }],
      { id: "b1", mission_type: "base_work", title: "עב״ס" },
    );
    const guard = missionWithSlots([
      { id: "g", name: "פטל", kind: "guard", start: "15:00", end: "16:00", seats: 1 },
    ]);
    const abasSlot = slotByName(abas, "עבודות");
    const guardSlot = slotByName(guard, "פטל");

    const standard = buildTrackerFromMissions([], rules);
    placePerson(p.name, abasSlot, abas.id, standard, rules, scheduling, 1, "base_work");
    expect(fitsPerson(p, guardSlot, standard, [], scheduling, [], peopleByName)).toBe(true);

    const strict = buildTrackerFromMissions([], rules, new Set(), "strict_rest");
    placePerson(p.name, abasSlot, abas.id, strict, rules, scheduling, 1, "base_work");
    expect(fitsPerson(p, guardSlot, strict, [], scheduling, [], peopleByName)).toBe(true);
    expect(
      explainFitsPersonFailure(p, guardSlot, strict, [], scheduling, [], peopleByName),
    ).toBe(null);
  });

  it("strict_rest and standard both reject ABAS→guard idle under the defined gap", () => {
    const abas = missionWithSlots(
      [{ id: "a", name: "עבודות בסיס", kind: "duty", start: "08:30", end: "11:30", seats: 1 }],
      { id: "b1", mission_type: "base_work", title: "עב״ס" },
    );
    const guard = missionWithSlots([
      { id: "g", name: "פטל", kind: "guard", start: "12:00", end: "13:00", seats: 1 },
    ]);
    const abasSlot = slotByName(abas, "עבודות");
    const guardSlot = slotByName(guard, "פטל");

    const standard = buildTrackerFromMissions([], rules);
    placePerson(p.name, abasSlot, abas.id, standard, rules, scheduling, 1, "base_work");
    expect(fitsPerson(p, guardSlot, standard, [], scheduling, [], peopleByName)).toBe(false);

    const strict = buildTrackerFromMissions([], rules, new Set(), "strict_rest");
    placePerson(p.name, abasSlot, abas.id, strict, rules, scheduling, 1, "base_work");
    expect(fitsPerson(p, guardSlot, strict, [], scheduling, [], peopleByName)).toBe(false);
  });

  it("coverage policy can skip the ABAS minute-gap; strict assign never uses that policy", () => {
    const abas = missionWithSlots(
      [{ id: "a", name: "עבודות בסיס", kind: "duty", start: "08:30", end: "11:30", seats: 1 }],
      { id: "b1", mission_type: "base_work", title: "עב״ס" },
    );
    const guard = missionWithSlots([
      { id: "g", name: "פטל", kind: "guard", start: "12:00", end: "13:00", seats: 1 },
    ]);
    const overlapGuard = missionWithSlots([
      { id: "g2", name: "פטל", kind: "guard", start: "10:00", end: "12:00", seats: 1 },
    ]);
    const abasSlot = slotByName(abas, "עבודות");
    const laterGuard = slotByName(guard, "פטל");
    const overlapping = slotByName(overlapGuard, "פטל");

    const tracker = buildTrackerFromMissions([], rules, new Set(), "coverage");
    placePerson(p.name, abasSlot, abas.id, tracker, rules, scheduling, 1, "base_work");
    expect(fitsPerson(p, laterGuard, tracker, [], scheduling, [], peopleByName)).toBe(true);
    expect(fitsPerson(p, overlapping, tracker, [], scheduling, [], peopleByName)).toBe(false);
  });

  it("forceFill in strict_rest leaves a rest-gap hole unless coverage is allowed", () => {
    const mission = missionWithSlots([
      { id: "g1", name: "שער אחורי", kind: "guard", start: "08:00", end: "09:00", seats: 1 },
      { id: "g2", name: "שער קדמי", kind: "guard", start: "12:00", end: "13:00", seats: 1 },
    ]);
    const first = slotByName(mission, "אחורי");
    const second = slotByName(mission, "קדמי");
    const seeded = syncAssignmentSeats(mission.positions, {
      [first.slotId]: [p.name],
      [second.slotId]: [""],
    });
    const people = [p];

    const hard = forceFillEmptySeats({
      mission,
      assignments: seeded,
      people,
      tracker: buildTrackerFromMissions(
        [{ ...mission, assignments: seeded }],
        rules,
        new Set(),
        "strict_rest",
      ),
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      allowCoverageFill: false,
    });
    expect((hard.assignments[second.slotId] || []).filter(Boolean)).toHaveLength(0);
    expect(hard.filled).toBe(0);

    const lastResort = forceFillEmptySeats({
      mission,
      assignments: seeded,
      people,
      tracker: buildTrackerFromMissions(
        [{ ...mission, assignments: seeded }],
        rules,
        new Set(),
        "strict_rest",
      ),
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      allowCoverageFill: true,
    });
    expect(lastResort.assignments[second.slotId]?.[0]).toBe(p.name);
    expect(lastResort.filled).toBe(1);
    expect(lastResort.warnings.some((w) => w.includes("שבירת מנוחה"))).toBe(true);
  });

  it("strict last-resort is not needed for a 3.5h ABAS→guard gap when the mission minute-gap is met", () => {
    const mission = missionWithSlots([
      { id: "a", name: "עבודות בסיס", kind: "duty", start: "08:30", end: "11:30", seats: 1 },
      { id: "g", name: "פטל", kind: "guard", start: "15:00", end: "16:00", seats: 1 },
    ]);
    const abasSlot = slotByName(mission, "עבודות");
    const guardSlot = slotByName(mission, "פטל");
    const seeded = syncAssignmentSeats(mission.positions, {
      [abasSlot.slotId]: [p.name],
      [guardSlot.slotId]: [""],
    });

    const lastResort = forceFillEmptySeats({
      mission,
      assignments: seeded,
      people: [p],
      tracker: buildTrackerFromMissions(
        [{ ...mission, assignments: seeded }],
        rules,
        new Set(),
        "strict_rest",
      ),
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      allowCoverageFill: true,
    });
    expect(lastResort.assignments[guardSlot.slotId]?.[0]).toBe(p.name);
    expect(lastResort.filled).toBe(1);
  });

  it("never fills ABAS↔guard under the defined minute-gap, even as last resort", () => {
    const mission = missionWithSlots([
      { id: "a", name: "עבודות בסיס", kind: "duty", start: "08:30", end: "11:30", seats: 1 },
      { id: "g", name: "פטל", kind: "guard", start: "12:00", end: "13:00", seats: 1 },
    ]);
    const abasSlot = slotByName(mission, "עבודות");
    const guardSlot = slotByName(mission, "פטל");
    const seeded = syncAssignmentSeats(mission.positions, {
      [abasSlot.slotId]: [p.name],
      [guardSlot.slotId]: [""],
    });

    const lastResort = forceFillEmptySeats({
      mission,
      assignments: seeded,
      people: [p],
      tracker: buildTrackerFromMissions(
        [{ ...mission, assignments: seeded }],
        rules,
        new Set(),
        "strict_rest",
      ),
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      allowCoverageFill: true,
    });
    expect((lastResort.assignments[guardSlot.slotId] || []).filter(Boolean)).toHaveLength(0);
    expect(lastResort.filled).toBe(0);
  });

  it("never assigns the same person to overlapping ABAS and a guard", () => {
    const mission = missionWithSlots([
      { id: "a", name: "עבודות בסיס", kind: "duty", start: "13:30", end: "17:30", seats: 1 },
      { id: "g", name: "פטל", kind: "guard", start: "16:00", end: "20:00", seats: 1 },
    ]);
    const abasSlot = slotByName(mission, "עבודות");
    const guardSlot = slotByName(mission, "פטל");
    const tracker = buildTrackerFromMissions([], rules, new Set(), "strict_rest");
    placePerson(p.name, abasSlot, mission.id, tracker, rules, scheduling, 1, "base_work");
    expect(fitsPerson(p, guardSlot, tracker, [], scheduling, [], peopleByName)).toBe(false);

    const filled = forceFillEmptySeats({
      mission,
      assignments: syncAssignmentSeats(mission.positions, {
        [abasSlot.slotId]: [p.name],
        [guardSlot.slotId]: [""],
      }),
      people: [p],
      tracker,
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      allowCoverageFill: true,
    });
    expect((filled.assignments[guardSlot.slotId] || []).filter(Boolean)).toHaveLength(0);
  });

  it("on a 20:00 board, evening ABAS sits at the end of the cycle and overlaps late guards", () => {
    const startsAt = "2026-08-21T20:00:00+03:00";
    const endsAt = "2026-08-22T20:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      missionDate: "2026-08-21",
      boardStart: "20:00",
    });
    const mission: MissionDay = {
      id: "g-eve",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: scheduling,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const slots = flattenMissionSlots(mission);
    const abas = slots.find(
      (s) => s.missionType === "base_work" && s.startTime === "18:30",
    )!;
    const opening = slots.find(
      (s) => s.positionKind === "guard" && s.startTime === "20:00",
    )!;
    const late = slots.find(
      (s) =>
        s.positionKind === "guard" &&
        s.startAtMs < abas.endAtMs &&
        s.endAtMs > abas.startAtMs,
    );
    expect(abas.startAtMs).toBeGreaterThan(Date.parse(startsAt));
    expect(late).toBeTruthy();

    const tracker = buildTrackerFromMissions([], rules, new Set(), "strict_rest");
    placePerson(p.name, abas, mission.id, tracker, rules, scheduling, abas.seatCount, "guards");
    expect(fitsPerson(p, late!, tracker, [], scheduling, [], peopleByName)).toBe(false);
    expect(
      explainFitsPersonFailure(p, late!, tracker, [], scheduling, [], peopleByName),
    ).toBe("overlapsSlot");
    expect(fitsPerson(p, opening, tracker, [], scheduling, [], peopleByName)).toBe(true);
  });

  it("on a 20:00 board, morning ABAS is during the board and cannot overlap morning guards", () => {
    const startsAt = "2026-08-21T20:00:00+03:00";
    const endsAt = "2026-08-22T20:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      missionDate: "2026-08-21",
      boardStart: "20:00",
    });
    const mission: MissionDay = {
      id: "g-morn",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: scheduling,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const slots = flattenMissionSlots(mission);
    const abas = slots.find(
      (s) => s.missionType === "base_work" && s.startTime === "08:30",
    )!;
    const morningGuard = slots.find(
      (s) =>
        s.positionKind === "guard" &&
        s.startAtMs < abas.endAtMs &&
        s.endAtMs > abas.startAtMs,
    );
    expect(abas.startAtMs).toBeGreaterThan(Date.parse(startsAt));
    expect(morningGuard).toBeTruthy();

    const tracker = buildTrackerFromMissions([], rules, new Set(), "strict_rest");
    placePerson(p.name, abas, mission.id, tracker, rules, scheduling, abas.seatCount, "guards");
    expect(fitsPerson(p, morningGuard!, tracker, [], scheduling, [], peopleByName)).toBe(false);
  });

  it("strict_rest still allows Carmel B in parallel with ABAS", () => {
    const startsAt = "2026-08-21T20:00:00+03:00";
    const endsAt = "2026-08-22T20:00:00+03:00";
    const positions = buildGuardDayPositions({
      missionStartsAt: startsAt,
      missionEndsAt: endsAt,
      missionDate: "2026-08-21",
      boardStart: "20:00",
    });
    const mission: MissionDay = {
      id: "g-carmel",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-21",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions,
      assignments: {},
      scheduling_rules: scheduling,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const slots = flattenMissionSlots(mission);
    const carmel = slots.find((s) => s.positionKind === "standby_carmel_b")!;
    const abas = slots.find(
      (s) => s.missionType === "base_work" && s.startTime === "08:30",
    )!;
    const tracker = buildTrackerFromMissions([], rules, new Set(), "strict_rest");
    placePerson(p.name, carmel, mission.id, tracker, rules, scheduling, carmel.seatCount, "guards");
    expect(fitsPerson(p, abas, tracker, [], scheduling, [], peopleByName)).toBe(true);
    expect(
      explainFitsPersonFailure(p, abas, tracker, [], scheduling, [], peopleByName),
    ).toBe(null);
  });

  it("stripAbasTimeViolations removes an ABAS seat that overlaps a guard", () => {
    const mission = missionWithSlots([
      { id: "a", name: "עבודות בסיס", kind: "duty", start: "13:30", end: "17:30", seats: 1 },
      { id: "g", name: "פטל", kind: "guard", start: "16:00", end: "20:00", seats: 1 },
    ]);
    const abasSlot = slotByName(mission, "עבודות");
    const guardSlot = slotByName(mission, "פטל");
    const seeded = syncAssignmentSeats(mission.positions, {
      [abasSlot.slotId]: [p.name],
      [guardSlot.slotId]: [p.name],
    });
    const { assignments, removed } = stripAbasTimeViolations({
      mission,
      assignments: seeded,
      scheduling,
      rules,
      constraintPolicy: "strict_rest",
    });
    expect(removed).toBe(1);
    expect((assignments[abasSlot.slotId] || []).filter(Boolean)).toHaveLength(0);
    expect(assignments[guardSlot.slotId]?.[0]).toBe(p.name);
  });

  it("stripAbasTimeViolations removes a locked ABAS seat that overlaps a guard", () => {
    const mission = missionWithSlots([
      { id: "a", name: "עבודות בסיס", kind: "duty", start: "08:30", end: "11:30", seats: 1 },
      { id: "g", name: "פטל", kind: "guard", start: "09:00", end: "13:00", seats: 1 },
    ]);
    const abasSlot = slotByName(mission, "עבודות");
    const guardSlot = slotByName(mission, "פטל");
    const seeded = syncAssignmentSeats(mission.positions, {
      [abasSlot.slotId]: [p.name],
      [guardSlot.slotId]: [p.name],
    });
    const lockedMission = {
      ...mission,
      assignments: seeded,
      locked_seats: { [abasSlot.slotId]: [true], [guardSlot.slotId]: [true] },
    };
    const { assignments, removed } = stripAbasTimeViolations({
      mission: lockedMission,
      assignments: seeded,
      scheduling,
      rules,
      constraintPolicy: "strict_rest",
    });
    expect(removed).toBe(1);
    expect((assignments[abasSlot.slotId] || []).filter(Boolean)).toHaveLength(0);
    expect(assignments[guardSlot.slotId]?.[0]).toBe(p.name);
  });

  it("clearOverlappingAbasAssignments removes ABAS that overlaps a 09:00 guard", () => {
    const mission = missionWithSlots([
      { id: "a", name: "עבודות בסיס", kind: "duty", start: "08:30", end: "11:30", seats: 1 },
      { id: "g", name: "פטל", kind: "guard", start: "09:00", end: "13:00", seats: 1 },
    ]);
    const abasSlot = slotByName(mission, "עבודות");
    const guardSlot = slotByName(mission, "פטל");
    const seeded = syncAssignmentSeats(mission.positions, {
      [abasSlot.slotId]: [p.name],
      [guardSlot.slotId]: [p.name],
    });
    const { assignments, removed } = clearOverlappingAbasAssignments({
      mission: { ...mission, assignments: seeded },
      assignments: seeded,
    });
    expect(removed).toBe(1);
    expect((assignments[abasSlot.slotId] || []).filter(Boolean)).toHaveLength(0);
    expect(assignments[guardSlot.slotId]?.[0]).toBe(p.name);
    expect(validateNoPersonOverlaps([{ ...mission, assignments }])).toHaveLength(0);
  });
});

describe("coverage fill priority", () => {
  const alex = person("Alex");
  const blair = person("Blair");

  function overlappingEveningMission(): MissionDay {
    return missionWithSlots([
      {
        id: "ham",
        name: "חמגשיות",
        kind: "kitchen",
        start: "18:00",
        end: "19:00",
        seats: 1,
      },
      {
        id: "res",
        name: "כוח עתודה",
        kind: "duty",
        start: "18:00",
        end: "21:00",
        seats: 1,
      },
      {
        id: "g",
        name: "פטל",
        kind: "guard",
        start: "18:00",
        end: "21:00",
        seats: 1,
      },
    ]);
  }

  it("ranks hamagshiyot last and reserve after mandatory", () => {
    const mission = overlappingEveningMission();
    const slots = flattenMissionSlots(mission);
    const ham = slots.find((s) => s.positionName === "חמגשיות")!;
    const reserve = slots.find((s) => s.positionName.includes("עתודה"))!;
    const guard = slots.find((s) => s.positionKind === "guard")!;
    expect(coverageFillRank(ham)).toBe(2);
    expect(coverageFillRank(reserve)).toBe(1);
    expect(coverageFillRank(guard)).toBe(0);
  });

  it("fills the guard and leaves hamagshiyot empty when only one person is available", () => {
    const mission = overlappingEveningMission();
    const slots = flattenMissionSlots(mission);
    const ham = slots.find((s) => s.positionName === "חמגשיות")!;
    const reserve = slots.find((s) => s.positionName.includes("עתודה"))!;
    const guard = slots.find((s) => s.positionKind === "guard")!;
    const seeded = syncAssignmentSeats(mission.positions, mission.assignments);
    const filled = forceFillEmptySeats({
      mission,
      assignments: seeded,
      people: [alex],
      tracker: buildTrackerFromMissions([{ ...mission, assignments: seeded }], rules),
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      allowCoverageFill: false,
    });
    expect(filled.assignments[guard.slotId]?.[0]).toBe(alex.name);
    expect((filled.assignments[reserve.slotId] || []).filter(Boolean)).toHaveLength(0);
    expect((filled.assignments[ham.slotId] || []).filter(Boolean)).toHaveLength(0);
  });

  it("fills reserve before hamagshiyot when two people can cover only two overlapping posts", () => {
    const mission = overlappingEveningMission();
    const slots = flattenMissionSlots(mission);
    const ham = slots.find((s) => s.positionName === "חמגשיות")!;
    const reserve = slots.find((s) => s.positionName.includes("עתודה"))!;
    const guard = slots.find((s) => s.positionKind === "guard")!;
    const seeded = syncAssignmentSeats(mission.positions, mission.assignments);
    const filled = forceFillEmptySeats({
      mission,
      assignments: seeded,
      people: [alex, blair],
      tracker: buildTrackerFromMissions([{ ...mission, assignments: seeded }], rules),
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      allowCoverageFill: false,
    });
    expect((filled.assignments[guard.slotId] || []).filter(Boolean)).toHaveLength(1);
    expect((filled.assignments[reserve.slotId] || []).filter(Boolean)).toHaveLength(1);
    expect((filled.assignments[ham.slotId] || []).filter(Boolean)).toHaveLength(1);
    const guardName = filled.assignments[guard.slotId][0];
    const reserveName = filled.assignments[reserve.slotId][0];
    expect(filled.assignments[ham.slotId][0]).toBe(reserveName);
    expect(filled.assignments[ham.slotId][0]).not.toBe(guardName);
  });

  it("breaks rest to fill a guard, but not to fill hamagshiyot", () => {
    const mission = missionWithSlots([
      { id: "g1", name: "שער אחורי", kind: "guard", start: "08:00", end: "09:00", seats: 1 },
      { id: "g2", name: "שער קדמי", kind: "guard", start: "12:00", end: "13:00", seats: 1 },
      {
        id: "ham",
        name: "חמגשיות",
        kind: "kitchen",
        start: "12:00",
        end: "13:00",
        seats: 1,
      },
    ]);
    const first = slotByName(mission, "אחורי");
    const second = slotByName(mission, "קדמי");
    const ham = flattenMissionSlots(mission).find((s) => s.positionName === "חמגשיות")!;
    const seeded = syncAssignmentSeats(mission.positions, {
      [first.slotId]: [alex.name],
      [second.slotId]: [""],
      [ham.slotId]: [""],
    });
    const lastResort = forceFillEmptySeats({
      mission,
      assignments: seeded,
      people: [alex],
      tracker: buildTrackerFromMissions(
        [{ ...mission, assignments: seeded }],
        rules,
        new Set(),
        "strict_rest",
      ),
      issues: [],
      scheduling,
      rules,
      meanPrior: 0,
      allowCoverageFill: true,
    });
    expect(lastResort.assignments[second.slotId]?.[0]).toBe(alex.name);
    expect((lastResort.assignments[ham.slotId] || []).filter(Boolean)).toHaveLength(0);
    expect(lastResort.warnings.some((w) => w.includes("שבירת מנוחה"))).toBe(true);
  });
});
