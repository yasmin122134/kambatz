import { describe, expect, it } from "vitest";
import { buildGuardDayPositions } from "@/lib/guard-day-template";
import {
  applyPersonSwapsToMissions,
  buildRoomBidirectionalPairs,
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
  it("builds bidirectional pairs — Carmel first, then other assignments", () => {
    const pairs = buildRoomBidirectionalPairs({
      fromRoom: "101",
      targetRoom: "204",
      oldCarmelNames: ["A1", "A2", "A3"],
      newCarmelNames: ["B1", "B2", "B3"],
      assignedNames: new Set(["A1", "A2", "A3", "A4", "B4"]),
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
    expect(pairs).toEqual([
      ["A1", "B1"],
      ["A2", "B2"],
      ["A3", "B3"],
      ["A4", "B4"],
    ]);
  });

  it("applyPersonSwapsToMissions exchanges both directions", () => {
    const mission = guardMissionWithAssignments({});
    const slots = flattenMissionSlots(mission);
    const carmelA = slots.find((s) => s.positionKind === "standby_carmel_a")!;
    const guard = slots.find((s) => s.positionKind === "guard")!;
    const assignments = {
      [carmelA.slotId]: ["A1", "A2", "A3"],
      [guard.slotId]: ["B4", ""],
    };
    const updated = applyPersonSwapsToMissions(
      [{ ...mission, assignments }],
      [
        ["A1", "B1"],
        ["A2", "B2"],
        ["A3", "B3"],
        ["A4", "B4"],
      ],
    )[0];
    expect(updated.assignments[carmelA.slotId]).toEqual(["B1", "B2", "B3"]);
    expect(updated.assignments[guard.slotId][0]).toBe("A4");
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
    assignments[slots.find((s) => s.slotId !== guard.slotId && s.positionKind === "guard")!.slotId] = [
      "R204-4",
      "",
    ];

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

    const out = result.missions[0];
    expect(out.assignments[carmelA.slotId]).toEqual(["R204-1", "R204-2", "R204-3"]);
    expect(out.assignments[guard.slotId][0]).toBe("R204-4");
    expect(result.fromRoom).toBe("101");
    expect(result.targetRoom).toBe("204");
  });

  it("succeeds even when target room people have existing guard shifts (head-to-head swap)", () => {
    const people = [
      person("R101-1", "101"),
      person("R101-2", "101"),
      person("R101-3", "101"),
      person("R204-1", "204"),
      person("R204-2", "204"),
      person("R204-3", "204"),
    ];
    const mission = guardMissionWithAssignments({});
    const slots = flattenMissionSlots(mission);
    const carmelA = slots.find((s) => s.positionKind === "standby_carmel_a")!;
    const guardSlots = slots.filter((s) => s.positionKind === "guard");
    const assignments: Record<string, string[]> = {};
    for (const slot of slots) {
      assignments[slot.slotId] = Array.from({ length: slot.seatCount }, () => "");
    }
    assignments[carmelA.slotId] = ["R101-1", "R101-2", "R101-3"];
    assignments[guardSlots[0].slotId] = ["R204-1", ""];
    assignments[guardSlots[1].slotId] = ["R204-2", ""];

    const result = swapCarmelARoom({
      missions: [{ ...mission, assignments }],
      guardsMission: { ...mission, assignments },
      targetRoom: "204",
      people,
      issues: [],
      rules,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missions[0].assignments[carmelA.slotId]).toEqual([
      "R204-1",
      "R204-2",
      "R204-3",
    ]);
    expect(result.missions[0].assignments[guardSlots[0].slotId][0]).toBe("R101-1");
    expect(result.missions[0].assignments[guardSlots[1].slotId][0]).toBe("R101-2");
  });
});
