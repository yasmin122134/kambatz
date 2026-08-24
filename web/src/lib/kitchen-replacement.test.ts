import { describe, expect, it } from "vitest";
import { defaultKitchenDayPositions } from "@/lib/kitchen-day-template";
import { flattenMissionSlots, slotEatsRest } from "@/lib/mission-utils";
import { canAssignPersonToSlot, canSwapReplacementAssignments } from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function person(name: string, squad: number): Person {
  return {
    id: name,
    name,
    email: null,
    squad,
    room: `10${squad}`,
    gender: "m",
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

function kitchenMission(assignments: Record<string, string[]>): MissionDay {
  const positions = defaultKitchenDayPositions({ seatsPerShift: 2 });
  return {
    id: "k1",
    title: "מטבch",
    mission_type: "kitchen",
    mission_date: "2026-08-26",
    starts_at: "2026-08-26T06:00:00+03:00",
    ends_at: "2026-08-26T22:00:00+03:00",
    status: "draft",
    positions,
    assignments,
    scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("kitchen replacement rules", () => {
  it("kitchen mission slots do not consume daily rest budget", () => {
    const mission = kitchenMission({});
    const slot = flattenMissionSlots(mission)[0];
    expect(slotEatsRest(slot)).toBe(false);
  });

  it("allows assigning a third consecutive kitchen shift for replacements", () => {
    const mission = kitchenMission({});
    const slots = flattenMissionSlots(mission);
    const shift0 = slots[0];
    const shift1 = slots[1];
    const shift2 = slots[2];
    mission.assignments[shift0.slotId] = ["Alice", ""];
    mission.assignments[shift1.slotId] = ["Alice", ""];
    mission.assignments[shift2.slotId] = ["Bob", ""];

    const people = [person("Alice", 1), person("Bob", 2), person("Carl", 3)];
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));

    const check = canAssignPersonToSlot({
      missions: [mission],
      rules: DEFAULT_FAIRNESS_RULES,
      missionId: mission.id,
      slot: shift2,
      seatIndex: 1,
      person: person("Alice", 1),
      issues: [],
      peopleByName,
      replaceName: "Bob",
    });
    expect(check.ok).toBe(true);
  });

  it("allows kitchen swap between consecutive shifts", () => {
    const mission = kitchenMission({});
    const slots = flattenMissionSlots(mission);
    const shift0 = slots[0];
    const shift1 = slots[1];
    mission.assignments[shift0.slotId] = ["Alice"];
    mission.assignments[shift1.slotId] = ["Bob"];

    const people = [person("Alice", 1), person("Bob", 2)];
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));

    const check = canSwapReplacementAssignments({
      missions: [mission],
      rules: DEFAULT_FAIRNESS_RULES,
      missionId: mission.id,
      slot: shift0,
      seatIndex: 0,
      removeName: "Alice",
      swapMissionId: mission.id,
      swapSlot: shift1,
      swapSeatIndex: 0,
      swapPerson: person("Bob", 2),
      issues: [],
      peopleByName,
    });
    expect(check.ok).toBe(true);
  });
});
