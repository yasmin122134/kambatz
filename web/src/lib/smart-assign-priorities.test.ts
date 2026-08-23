import { describe, expect, it } from "vitest";
import {
  compareByFairnessThenBurden,
  buildTrackerFromMissions,
  checkHardEligibility,
  evaluateSoftConstraints,
  fitsPerson,
  fitsPersonStrict,
  hasHardTimeOverlap,
  placePerson,
} from "@/lib/scheduling-engine";
import {
  computeScheduleQuality,
  lexBetter,
  scheduleLexScore,
} from "@/lib/schedule-quality";
import { flattenMissionSlots, slotEatsRest } from "@/lib/mission-utils";
import type { MissionDay, Person } from "@/lib/types";
import {
  DEFAULT_FAIRNESS_RULES,
  DEFAULT_MISSION_SCHEDULING_RULES,
} from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = {
  ...DEFAULT_MISSION_SCHEDULING_RULES,
  rest_hours: 8,
  guard_ratio: 1,
};

function person(name: string, overrides: Partial<Person> = {}): Person {
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
    ...overrides,
  };
}

function guardMission(
  slots: Array<{ id: string; start: string; end: string; seats?: number }>,
): MissionDay {
  return {
    id: "g1",
    title: "guards",
    mission_type: "guards",
    mission_date: "2026-08-21",
    starts_at: "2026-08-21T08:00:00",
    ends_at: "2026-08-22T08:00:00",
    status: "draft",
    positions: [
      {
        id: "p1",
        name: "פטל",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: slots.map((s) => ({
          id: s.id,
          start_time: s.start,
          end_time: s.end,
          seat_count: s.seats ?? 1,
        })),
      },
    ],
    assignments: Object.fromEntries(
      slots.map((s) => [s.id, Array.from({ length: s.seats ?? 1 }, () => "")]),
    ),
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("Smart Assignment priority model", () => {
  it("A — hard-valid candidate with rest penalty is still eligible", () => {
    const mission = guardMission([
      { id: "g1", start: "00:00", end: "04:00" },
      { id: "g2", start: "10:00", end: "14:00" },
    ]);
    const slots = flattenMissionSlots(mission);
    const tracker = buildTrackerFromMissions([], rules);
    placePerson("Alex", slots[0], mission.id, tracker, rules, scheduling, 1);
    const p = person("Alex");
    expect(
      fitsPerson(p, slots[1], tracker, [], scheduling, [], { Alex: p }, undefined, mission.id),
    ).toBe(true);
    const soft = evaluateSoftConstraints(
      p,
      slots[1],
      tracker,
      scheduling,
      rules,
      0,
      1,
      undefined,
      mission.id,
    );
    expect(soft.restPenalty).toBeGreaterThan(0);
  });

  it("H — consecutive guard shifts are hard-invalid", () => {
    const mission = guardMission([
      { id: "g1", start: "08:00", end: "12:00" },
      { id: "g2", start: "12:00", end: "16:00" },
    ]);
    const slots = flattenMissionSlots(mission);
    const tracker = buildTrackerFromMissions([], rules);
    placePerson("Alex", slots[0], mission.id, tracker, rules, scheduling, 1);
    const p = person("Alex");
    expect(
      fitsPerson(p, slots[1], tracker, [], scheduling, [], { Alex: p }, undefined, mission.id),
    ).toBe(false);
    expect(
      checkHardEligibility(p, slots[1], tracker, [], [], { Alex: p }, undefined, {
        scheduling,
        scopeMissionId: mission.id,
      }).reason,
    ).toBe("guardSpacing");
  });

  it("B — complete schedule beats partial even with better fairness score", () => {
    const partial = scheduleLexScore({
      filledSeats: 99,
      requiredSeats: 100,
      isComplete: false,
      restViolations: { severe: 0, significant: 0, underEightHours: 0 },
      totalRestPenalty: 0,
      maxBurden: 20,
      minBurden: 20,
      burdenSpread: 0,
      burdenMad: 0,
      guardCountSpread: 0,
      kitchenSpread: 0,
    });
    const complete = scheduleLexScore({
      filledSeats: 100,
      requiredSeats: 100,
      isComplete: true,
      restViolations: { severe: 1, significant: 2, underEightHours: 3 },
      totalRestPenalty: 20,
      maxBurden: 30,
      minBurden: 22,
      burdenSpread: 8,
      burdenMad: 3,
      guardCountSpread: 2,
      kitchenSpread: 0,
    });
    expect(lexBetter(complete, partial)).toBe(true);
  });

  it("C — fewer severe rest violations win among complete schedules", () => {
    const worse = scheduleLexScore({
      filledSeats: 10,
      requiredSeats: 10,
      isComplete: true,
      restViolations: { severe: 1, significant: 1, underEightHours: 1 },
      totalRestPenalty: 5,
      maxBurden: 20,
      minBurden: 18,
      burdenSpread: 2,
      burdenMad: 1,
      guardCountSpread: 0,
      kitchenSpread: 0,
    });
    const better = scheduleLexScore({
      filledSeats: 10,
      requiredSeats: 10,
      isComplete: true,
      restViolations: { severe: 0, significant: 1, underEightHours: 1 },
      totalRestPenalty: 8,
      maxBurden: 20,
      minBurden: 18,
      burdenSpread: 2,
      burdenMad: 1,
      guardCountSpread: 0,
      kitchenSpread: 0,
    });
    expect(lexBetter(better, worse)).toBe(true);
  });

  it("D — burden beats raw guard count when choosing next guard", () => {
    const mission = guardMission([
      { id: "solo-night", start: "00:00", end: "04:00", seats: 1 },
      { id: "day1", start: "08:00", end: "12:00", seats: 2 },
      { id: "g-next", start: "16:00", end: "20:00", seats: 2 },
    ]);
    mission.positions = [
      {
        id: "p1",
        name: "פטל",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: [
          { id: "solo-night", start_time: "00:00", end_time: "04:00", seat_count: 1 },
          { id: "day1", start_time: "08:00", end_time: "12:00", seat_count: 2 },
          { id: "g-next", start_time: "16:00", end_time: "20:00", seat_count: 2 },
        ],
      },
    ];
    const slots = flattenMissionSlots(mission);
    const slot = slots.find((s) => s.slotId === "g-next")!;
    const tracker = buildTrackerFromMissions([], rules);
    const hardNight = person("HardNight");
    const easyDay = person("EasyDay");

    placePerson(
      "HardNight",
      slots.find((s) => s.slotId === "solo-night")!,
      mission.id,
      tracker,
      rules,
      scheduling,
      1,
    );
    placePerson(
      "EasyDay",
      slots.find((s) => s.slotId === "day1")!,
      mission.id,
      tracker,
      rules,
      scheduling,
      2,
    );

    expect(tracker.guardShifts.HardNight?.length).toBe(1);
    expect(tracker.guardShifts.EasyDay?.length).toBe(1);
    expect(tracker.dutyPoints.HardNight).toBeGreaterThan(tracker.dutyPoints.EasyDay ?? 0);

    const cmp = compareByFairnessThenBurden(
      hardNight,
      easyDay,
      slot,
      [hardNight, easyDay],
      tracker,
      rules,
      0,
      scheduling,
      2,
    );
    expect(cmp).toBeGreaterThan(0);
  });

  it("F — overlapping candidate is never hard-valid", () => {
    const mission = guardMission([
      { id: "g1", start: "08:00", end: "12:00" },
      { id: "g2", start: "10:00", end: "14:00" },
    ]);
    const slots = flattenMissionSlots(mission);
    const tracker = buildTrackerFromMissions([], rules);
    placePerson("Alex", slots[0], mission.id, tracker, rules, scheduling, 1);
    const p = person("Alex");
    expect(hasHardTimeOverlap("Alex", slots[1], tracker)).toBe(true);
    expect(
      checkHardEligibility(p, slots[1], tracker, [], [], { Alex: p }).allowed,
    ).toBe(false);
  });

  it("G — reserve force blocks overlap but not rest chain", () => {
    const mission: MissionDay = {
      ...guardMission([{ id: "g1", start: "00:00", end: "04:00" }]),
      positions: [
        {
          id: "g",
          name: "פטל",
          kind: "guard",
          same_room: false,
          same_gender: false,
          slots: [{ id: "g1", start_time: "00:00", end_time: "04:00", seat_count: 1 }],
        },
        {
          id: "r",
          name: "כוח עתודה",
          kind: "duty",
          same_room: false,
          same_gender: false,
          slots: [{ id: "r1", start_time: "08:00", end_time: "12:00", seat_count: 1 }],
        },
        {
          id: "g2",
          name: "בונקר",
          kind: "guard",
          same_room: false,
          same_gender: false,
          slots: [{ id: "g2", start_time: "16:00", end_time: "20:00", seat_count: 1 }],
        },
      ],
      assignments: { g1: [""], r1: [""], g2: [""] },
    };
    const slots = flattenMissionSlots(mission);
    const guard1 = slots.find((s) => s.slotId === "g1")!;
    const reserve = slots.find((s) => s.slotId === "r1")!;
    const guard2 = slots.find((s) => s.slotId === "g2")!;
    expect(slotEatsRest(reserve)).toBe(false);

    const tracker = buildTrackerFromMissions([], rules);
    placePerson("Alex", guard1, mission.id, tracker, rules, scheduling, 1);
    placePerson("Alex", reserve, mission.id, tracker, rules, scheduling, 1);
    const p = person("Alex");
    expect(fitsPerson(p, guard2, tracker, [], scheduling, [], { Alex: p })).toBe(true);

    const overlapMission = guardMission([
      { id: "r1", start: "10:00", end: "14:00" },
      { id: "g2", start: "10:00", end: "14:00" },
    ]);
    overlapMission.positions = [
      {
        id: "r",
        name: "כוח עתודה",
        kind: "duty",
        same_room: false,
        same_gender: false,
        slots: [{ id: "r1", start_time: "10:00", end_time: "14:00", seat_count: 1 }],
      },
      {
        id: "g2p",
        name: "בונקר",
        kind: "guard",
        same_room: false,
        same_gender: false,
        slots: [{ id: "g2", start_time: "10:00", end_time: "14:00", seat_count: 1 }],
      },
    ];
    const overlapSlots = flattenMissionSlots(overlapMission);
    const overlapReserve = overlapSlots.find((s) => s.slotId === "r1")!;
    const overlapGuard = overlapSlots.find((s) => s.slotId === "g2")!;
    const overlapTracker = buildTrackerFromMissions([], rules);
    placePerson("Alex", overlapReserve, overlapMission.id, overlapTracker, rules, scheduling, 1);
    expect(hasHardTimeOverlap("Alex", overlapGuard, overlapTracker)).toBe(true);
  });

  it("E — computeScheduleQuality reflects burden spread", () => {
    const mission = guardMission([{ id: "g1", start: "08:00", end: "12:00" }]);
    const slot = flattenMissionSlots(mission)[0];
    const tracker = buildTrackerFromMissions([], rules);
    placePerson("A", slot, mission.id, tracker, rules, scheduling, 1);
    const quality = computeScheduleQuality({
      tracker,
      people: [person("A"), person("B")],
      rules,
      meanPrior: 0,
      filledSeats: 1,
      requiredSeats: 2,
    });
    expect(quality.maxBurden).toBeGreaterThan(quality.minBurden);
  });
});
