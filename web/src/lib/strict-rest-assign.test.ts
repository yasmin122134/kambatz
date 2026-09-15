import { describe, expect, it } from "vitest";
import { flattenMissionSlots, syncAssignmentSeats } from "@/lib/mission-utils";
import {
  buildTrackerFromMissions,
  explainFitsPersonFailure,
  fitsPerson,
  forceFillEmptySeats,
  placePerson,
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

  it("coverage last-resort may break rest_hours and the ABAS gap, but not real overlap", () => {
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
});
