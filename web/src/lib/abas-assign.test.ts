import { describe, expect, it } from "vitest";
import { solveAbasShifts } from "@/lib/abas-csp";
import { validateAbasRosterIndependent } from "@/lib/abas-validator";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import { flattenMissionSlots, syncAssignmentSeats } from "@/lib/mission-utils";
import {
  guardAbasRestOk,
  missionIntervalsOverlap,
  toMissionTimelineInterval,
} from "@/lib/mission-timeline";
import { runGlobalAssign } from "@/lib/global-assign";
import {
  buildTrackerFromMissions,
  explainFitsPersonFailure,
  fitsPerson,
  placePerson,
} from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function person(name: string, overrides: Partial<Person> = {}): Person {
  return {
    id: name,
    name,
    email: null,
    room: "101",
    gender: "m",
    squad: 1,
    active: true,
    prior_score: 0,
    no_guard: false,
    no_standby: false,
    no_standing: false,
    no_base_work: false,
    no_kitchen: false,
    created_at: "",
    ...overrides,
  };
}

function rosterPerson(i: number): Person {
  return person(`person-${String(i).padStart(2, "0")}`, {
    squad: (i % 4) + 1,
    room: `10${(i % 8) + 1}`,
    gender: i % 2 === 0 ? "m" : "f",
  });
}

const scheduling30 = {
  ...DEFAULT_MISSION_SCHEDULING_RULES,
  board_start: "09:00",
  rest_hours: 8,
  duty_guard_gap_minutes: 30,
  base_work: { seats_per_shift: 20 },
};

function nineAmMission(assignments?: Record<string, string[]>): MissionDay {
  const startsAt = "2026-09-15T09:00:00+03:00";
  const endsAt = "2026-09-16T09:00:00+03:00";
  const positions = buildGuardDayPositions({
    missionStartsAt: startsAt,
    missionEndsAt: endsAt,
    boardStart: "09:00",
    missionDate: "2026-09-15",
    baseWorkSeatsPerShift: 20,
  });
  return {
    id: "g-09",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-09-15",
    starts_at: startsAt,
    ends_at: endsAt,
    status: "draft",
    positions,
    assignments: syncAssignmentSeats(positions, assignments ?? {}),
    scheduling_rules: scheduling30,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

function slotOf(
  mission: MissionDay,
  pred: (s: ReturnType<typeof flattenMissionSlots>[number]) => boolean,
) {
  const slot = flattenMissionSlots(mission).find(pred);
  if (!slot) throw new Error("slot not found");
  return slot;
}

describe("mission timeline rest boundaries", () => {
  const start = Date.parse("2026-09-15T09:00:00+03:00");

  it("1. Guard ends 13:00, ABAS starts 13:30 → VALID at 30 minutes", () => {
    const guard = toMissionTimelineInterval(
      start,
      Date.parse("2026-09-15T09:00:00+03:00"),
      Date.parse("2026-09-15T13:00:00+03:00"),
    );
    const abas = toMissionTimelineInterval(
      start,
      Date.parse("2026-09-15T13:30:00+03:00"),
      Date.parse("2026-09-15T17:30:00+03:00"),
    );
    expect(guardAbasRestOk(guard, abas, 30)).toBe(true);
  });

  it("2. Guard ends 13:01, ABAS starts 13:30 → INVALID", () => {
    const guard = toMissionTimelineInterval(
      start,
      Date.parse("2026-09-15T09:00:00+03:00"),
      Date.parse("2026-09-15T13:01:00+03:00"),
    );
    const abas = toMissionTimelineInterval(
      start,
      Date.parse("2026-09-15T13:30:00+03:00"),
      Date.parse("2026-09-15T17:30:00+03:00"),
    );
    expect(guardAbasRestOk(guard, abas, 30)).toBe(false);
  });

  it("3. ABAS ends 17:30, guard starts 18:00 → VALID", () => {
    const abas = toMissionTimelineInterval(
      start,
      Date.parse("2026-09-15T13:30:00+03:00"),
      Date.parse("2026-09-15T17:30:00+03:00"),
    );
    const guard = toMissionTimelineInterval(
      start,
      Date.parse("2026-09-15T18:00:00+03:00"),
      Date.parse("2026-09-15T21:00:00+03:00"),
    );
    expect(guardAbasRestOk(guard, abas, 30)).toBe(true);
  });

  it("4. ABAS ends 17:31, guard starts 18:00 → INVALID", () => {
    const abas = toMissionTimelineInterval(
      start,
      Date.parse("2026-09-15T13:30:00+03:00"),
      Date.parse("2026-09-15T17:31:00+03:00"),
    );
    const guard = toMissionTimelineInterval(
      start,
      Date.parse("2026-09-15T18:00:00+03:00"),
      Date.parse("2026-09-15T21:00:00+03:00"),
    );
    expect(guardAbasRestOk(guard, abas, 30)).toBe(false);
  });
});

describe("09:00 mission-day placement", () => {
  it("5. Guard 06:00–09:00 next morning vs ABAS 08:30–11:30 first morning do not overlap", () => {
    const mission = nineAmMission();
    const abas = slotOf(mission, (s) => s.missionType === "base_work" && s.startTime === "08:30");
    const custom: MissionDay = {
      ...mission,
      positions: [
        ...mission.positions,
        {
          id: "overnight-0600",
          name: "פטל",
          kind: "guard",
          slots: [{ id: "g0600", start_time: "06:00", end_time: "09:00", seat_count: 1 }],
        },
      ],
    };
    const overnight = slotOf(custom, (s) => s.slotId === "g0600");
    expect(abas.startAtMs).toBe(Date.parse("2026-09-15T08:30:00+03:00"));
    expect(abas.endAtMs).toBe(Date.parse("2026-09-15T11:30:00+03:00"));
    expect(overnight.startAtMs).toBe(Date.parse("2026-09-16T06:00:00+03:00"));
    expect(overnight.endAtMs).toBe(Date.parse("2026-09-16T09:00:00+03:00"));
    expect(
      missionIntervalsOverlap(
        toMissionTimelineInterval(Date.parse(mission.starts_at), abas.startAtMs, abas.endAtMs),
        toMissionTimelineInterval(Date.parse(mission.starts_at), overnight.startAtMs, overnight.endAtMs),
      ),
    ).toBe(false);

    const p = person("Alex");
    const tracker = buildTrackerFromMissions([], DEFAULT_FAIRNESS_RULES);
    placePerson(p.name, overnight, custom.id, tracker, DEFAULT_FAIRNESS_RULES, scheduling30, 1, "guards");
    expect(fitsPerson(p, abas, tracker, [], scheduling30, [], { [p.name]: p })).toBe(true);
  });

  it("6. ABAS 18:30–20:00 then guard 00:00–03:00 next day is VALID (4h rest)", () => {
    const mission = nineAmMission();
    const abas = slotOf(mission, (s) => s.missionType === "base_work" && s.startTime === "18:30");
    const custom: MissionDay = {
      ...mission,
      positions: [
        ...mission.positions,
        {
          id: "midnight-guard",
          name: "פטל",
          kind: "guard",
          slots: [{ id: "g0000", start_time: "00:00", end_time: "03:00", seat_count: 1 }],
        },
      ],
    };
    const night = slotOf(custom, (s) => s.slotId === "g0000");
    expect(abas.endAtMs).toBe(Date.parse("2026-09-15T20:00:00+03:00"));
    expect(night.startAtMs).toBe(Date.parse("2026-09-16T00:00:00+03:00"));
    const p = person("Alex");
    const tracker = buildTrackerFromMissions([], DEFAULT_FAIRNESS_RULES);
    placePerson(p.name, abas, custom.id, tracker, DEFAULT_FAIRNESS_RULES, scheduling30, 1, "base_work");
    expect(fitsPerson(p, night, tracker, [], scheduling30, [], { [p.name]: p })).toBe(true);
  });

  it("7. כרמל א׳ 09:00 → next 09:00 blocks any ABAS; כרמל ב׳ may also do ABAS", () => {
    const mission = nineAmMission();
    const carmelA = slotOf(mission, (s) => s.positionKind === "standby_carmel_a");
    const carmelB = slotOf(mission, (s) => s.positionKind === "standby_carmel_b");
    const abas = slotOf(mission, (s) => s.missionType === "base_work" && s.startTime === "13:30");
    const a = person("Alex");
    const b = person("Blair");
    const tracker = buildTrackerFromMissions([], DEFAULT_FAIRNESS_RULES);
    placePerson(a.name, carmelA, mission.id, tracker, DEFAULT_FAIRNESS_RULES, scheduling30, carmelA.seatCount, "guards");
    placePerson(b.name, carmelB, mission.id, tracker, DEFAULT_FAIRNESS_RULES, scheduling30, carmelB.seatCount, "guards");
    expect(fitsPerson(a, abas, tracker, [], scheduling30, [], { [a.name]: a, [b.name]: b })).toBe(false);
    expect(fitsPerson(b, abas, tracker, [], scheduling30, [], { [a.name]: a, [b.name]: b })).toBe(true);
  });

  it("8. Two non-conflicting ABAS shifts for one person are VALID", () => {
    const mission = nineAmMission();
    const morning = slotOf(mission, (s) => s.missionType === "base_work" && s.startTime === "08:30");
    const evening = slotOf(mission, (s) => s.missionType === "base_work" && s.startTime === "18:30");
    const p = person("Alex");
    const tracker = buildTrackerFromMissions([], DEFAULT_FAIRNESS_RULES);
    placePerson(p.name, morning, mission.id, tracker, DEFAULT_FAIRNESS_RULES, scheduling30, 1, "base_work");
    expect(fitsPerson(p, evening, tracker, [], scheduling30, [], { [p.name]: p })).toBe(true);
  });

  it("same person cannot do 08:30 ABAS and 09:00–13:00 guard", () => {
    const mission = nineAmMission();
    const abas = slotOf(mission, (s) => s.missionType === "base_work" && s.startTime === "08:30");
    const guard = slotOf(
      mission,
      (s) => s.positionKind === "guard" && s.startTime === "09:00" && s.endTime === "13:00",
    );
    const p = person("Alex");
    const tracker = buildTrackerFromMissions([], DEFAULT_FAIRNESS_RULES);
    placePerson(p.name, guard, mission.id, tracker, DEFAULT_FAIRNESS_RULES, scheduling30, 1, "guards");
    expect(fitsPerson(p, abas, tracker, [], scheduling30, [], { [p.name]: p })).toBe(false);
    expect(
      explainFitsPersonFailure(p, abas, tracker, [], scheduling30, [], { [p.name]: p }),
    ).toBe("overlapsSlot");
  });
});

describe("ABAS CSP vs greedy", () => {
  it("9. per-shift candidate counts do not imply a global solution", () => {
    const startsAt = "2026-09-15T09:00:00+03:00";
    const endsAt = "2026-09-16T09:00:00+03:00";
    const people = [person("P1"), person("P2"), person("P3")];
    const mission: MissionDay = {
      id: "csp-unsat",
      title: "t",
      mission_type: "guards",
      mission_date: "2026-09-15",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions: [
        {
          id: "bw",
          name: "עבודות בסיס",
          kind: "duty",
          slots: [
            { id: "a", start_time: "08:30", end_time: "11:30", seat_count: 2 },
            { id: "b", start_time: "10:00", end_time: "13:00", seat_count: 2 },
          ],
        },
      ],
      assignments: { a: ["", ""], b: ["", ""] },
      scheduling_rules: scheduling30,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const slots = flattenMissionSlots(mission);
    const tracker = buildTrackerFromMissions([], DEFAULT_FAIRNESS_RULES);
    const result = solveAbasShifts({
      shifts: slots.map((slot) => ({
        id: slot.slotId,
        mission,
        slot,
        seatIndices: [0, 1],
        fixedNames: [],
        required: 2,
      })),
      people,
      tracker,
      issues: [],
      scheduling: scheduling30,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      peopleByName: Object.fromEntries(people.map((p) => [p.name, p])),
    });
    expect(result.diagnostics.every((d) => d.eligibleCandidates >= 2)).toBe(true);
    expect(result.status).toBe("unsat");
    expect(result.hallBottlenecks.length).toBeGreaterThan(0);
  });

  it("10. greedy dead-end is solved by MRV backtracking", () => {
    const startsAt = "2026-09-15T09:00:00+03:00";
    const endsAt = "2026-09-16T09:00:00+03:00";
    const x = person("X", { prior_score: 0 });
    const y = person("Y", { prior_score: 0 });
    const people = [x, y];
    const mission: MissionDay = {
      id: "csp-bt",
      title: "t",
      mission_type: "guards",
      mission_date: "2026-09-15",
      starts_at: startsAt,
      ends_at: endsAt,
      status: "draft",
      positions: [
        {
          id: "bw",
          name: "עבודות בסיס",
          kind: "duty",
          slots: [
            { id: "easy", start_time: "08:30", end_time: "11:30", seat_count: 1 },
            { id: "hard", start_time: "10:00", end_time: "12:00", seat_count: 1 },
          ],
        },
        {
          id: "g",
          name: "פטל",
          kind: "guard",
          slots: [{ id: "gy", start_time: "12:00", end_time: "16:00", seat_count: 1 }],
        },
      ],
      assignments: { easy: [""], hard: [""], gy: ["Y"] },
      scheduling_rules: scheduling30,
      notes: null,
      created_at: "",
      updated_at: "",
    };
    const slots = flattenMissionSlots(mission);
    const easy = slots.find((s) => s.slotId === "easy")!;
    const hard = slots.find((s) => s.slotId === "hard")!;
    const tracker = buildTrackerFromMissions([mission], DEFAULT_FAIRNESS_RULES);
    const byName = { X: x, Y: y };
    expect(fitsPerson(x, easy, tracker, [], scheduling30, [], byName)).toBe(true);
    expect(fitsPerson(y, easy, tracker, [], scheduling30, [], byName)).toBe(true);
    expect(fitsPerson(x, hard, tracker, [], scheduling30, [], byName)).toBe(true);
    expect(fitsPerson(y, hard, tracker, [], scheduling30, [], byName)).toBe(false);

    const result = solveAbasShifts({
      shifts: [
        { id: "easy", mission, slot: easy, seatIndices: [0], fixedNames: [], required: 1 },
        { id: "hard", mission, slot: hard, seatIndices: [0], fixedNames: [], required: 1 },
      ],
      people,
      tracker,
      issues: [],
      scheduling: scheduling30,
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      peopleByName: byName,
    });
    expect(result.status).toBe("complete");
    expect(result.namesByShiftId.get("hard")).toEqual(["X"]);
    expect(result.namesByShiftId.get("easy")).toEqual(["Y"]);
    expect(result.firstShiftLabel).toBe(hard.timeLabel);
  });
});

describe("full 09:00 roster ABAS assignment", () => {
  it("fills 20/20/20 around an existing guard roster and passes the independent validator", { timeout: 20000 }, () => {
    const people = Array.from({ length: 53 }, (_, i) => rosterPerson(i));
    const empty = nineAmMission();
    const seeded = runGlobalAssign({
      missions: [empty],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
      randomSeed: 7,
    });
    const withGuards: MissionDay = {
      ...empty,
      assignments: seeded.assignmentsByMission.get(empty.id) ?? empty.assignments,
    };
    const slots = flattenMissionSlots(withGuards);
    const abasSlots = slots.filter((s) => s.missionType === "base_work");
    const guardsKept = { ...withGuards.assignments };
    for (const slot of abasSlots) {
      guardsKept[slot.slotId] = Array(slot.seatCount).fill("");
    }
    const cleared = { ...withGuards, assignments: guardsKept };

    const output = runGlobalAssign({
      missions: [cleared],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: true,
      randomSeed: 11,
    });
    const assigned = output.assignmentsByMission.get(cleared.id)!;
    const finalMission = { ...cleared, assignments: assigned };

    for (const slot of abasSlots) {
      expect((assigned[slot.slotId] || []).filter(Boolean)).toHaveLength(20);
    }
    expect(output.abasReport).toMatch(/eligible candidates:/);
    expect(output.abasReport).toMatch(/First shift selected:/);

    const violations = validateAbasRosterIndependent({
      mission: finalMission,
      people,
      minGuardAbasRestMin: 30,
      originalAssignments: guardsKept,
    });
    expect(violations).toEqual([]);
  });
});
