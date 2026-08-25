import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import {
  applyNameMappingToMissions,
  buildRoomSwapMapping,
  swapCarmelARoom,
} from "@/lib/carmel-room-sync";
import { flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = { ...DEFAULT_MISSION_SCHEDULING_RULES, guard_ratio: 0, rest_hours: 6 };

function person(name: string, room: string, squad = 1): Person {
  return {
    id: name,
    name,
    email: null,
    room,
    gender: "m",
    squad,
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

function guardMissionWithAssignments(
  assignments: Record<string, string[]>,
  startsAt = "2026-08-21T08:00:00",
  endsAt = "2026-08-22T08:00:00",
): MissionDay {
  const positions = buildGuardDayPositions({
    missionStartsAt: startsAt,
    missionEndsAt: endsAt,
    boardStart: "08:00",
  });
  return {
    id: "g1",
    title: "guards",
    mission_type: "guards",
    mission_date: "2026-08-21",
    starts_at: startsAt,
    ends_at: endsAt,
    status: "published",
    positions,
    assignments,
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("carmel room sync", () => {
  it("maps Carmel first then other room assignments", () => {
    const mapping = buildRoomSwapMapping({
      fromRoom: "101",
      targetRoom: "204",
      oldCarmelNames: ["A1", "A2", "A3"],
      newCarmelNames: ["B1", "B2", "B3"],
      assignedNames: new Set(["A1", "A2", "A3", "A4"]),
      people: [
        person("A1", "101"),
        person("A2", "101"),
        person("A3", "101"),
        person("A4", "101"),
        person("B1", "204"),
        person("B2", "204"),
        person("B3", "204"),
        person("B4", "204"),
      ],
      carmelBNames: new Set(),
    });
    expect(mapping).toEqual({
      A1: "B1",
      A2: "B2",
      A3: "B3",
      A4: "B4",
    });
  });

  it("applyNameMappingToMissions replaces names across slots", () => {
    const mission = guardMissionWithAssignments({});
    const slots = flattenMissionSlots(mission);
    const carmelA = slots.find((s) => s.positionKind === "standby_carmel_a")!;
    const guard = slots.find((s) => s.positionKind === "guard")!;
    const assignments = {
      [carmelA.slotId]: ["Old1", "Old2", "Old3"],
      [guard.slotId]: ["Old4", ""],
    };
    const updated = applyNameMappingToMissions(
      [{ ...mission, assignments }],
      { Old1: "New1", Old2: "New2", Old3: "New3", Old4: "New4" },
    )[0];
    expect(updated.assignments[carmelA.slotId]).toEqual(["New1", "New2", "New3"]);
    expect(updated.assignments[guard.slotId][0]).toBe("New4");
  });

  it("swapCarmelARoom replaces room across Carmel and guards", () => {
    const people = [
      person("R101-1", "101"),
      person("R101-2", "101"),
      person("R101-3", "101"),
      person("R101-4", "101"),
      person("R204-1", "204"),
      person("R204-2", "204"),
      person("R204-3", "204"),
      person("R204-4", "204"),
      ...Array.from({ length: 40 }, (_, i) => person(`Flex-${i}`, `${300 + i}`)),
    ];
    const mission = guardMissionWithAssignments({});
    const slots = flattenMissionSlots(mission);
    const carmelA = slots.find((s) => s.positionKind === "standby_carmel_a")!;
    const carmelB = slots.find((s) => s.positionKind === "standby_carmel_b")!;
    const guard = slots.find((s) => s.positionKind === "guard")!;
    const assignments: Record<string, string[]> = {};
    for (const slot of slots) {
      assignments[slot.slotId] = Array.from({ length: slot.seatCount }, () => "");
    }
    assignments[carmelA.slotId] = ["R101-1", "R101-2", "R101-3"];
    assignments[carmelB.slotId] = ["Flex-0", "Flex-1", "Flex-2"];
    assignments[guard.slotId] = ["R101-4", ""];

    const result = swapCarmelARoom({
      missions: [{ ...mission, assignments }],
      guardsMission: { ...mission, assignments },
      targetRoom: "204",
      people,
      issues: [],
      rules,
    });

    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.ok).toBe(true);

    const out = result.missions[0];
    expect(out.assignments[carmelA.slotId]).toEqual(["R204-1", "R204-2", "R204-3"]);
    expect(out.assignments[guard.slotId][0]).toBe("R204-4");
    expect(result.fromRoom).toBe("101");
    expect(result.targetRoom).toBe("204");
  });
});
