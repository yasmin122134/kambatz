import { describe, expect, it, vi } from "vitest";
import {
  applyReplacementAssignment,
  missionsWithForcedAssignment,
} from "@/lib/replacement-apply";
import type { MissionDay, Person } from "@/lib/types";
import {
  DEFAULT_FAIRNESS_RULES,
  DEFAULT_MISSION_SCHEDULING_RULES,
} from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = { ...DEFAULT_MISSION_SCHEDULING_RULES, guard_ratio: 1 };

vi.mock("@/lib/missions", () => ({
  saveMissionDay: vi.fn(async (payload: MissionDay) => ({ mission: payload })),
}));

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

function guardMission(assignments: Record<string, string[]>): MissionDay {
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
        slots: [
          { id: "g1", start_time: "08:00", end_time: "12:00", seat_count: 1 },
          { id: "g2", start_time: "16:00", end_time: "20:00", seat_count: 1 },
        ],
      },
    ],
    assignments,
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("applyReplacementAssignment", () => {
  it("swaps two guard slots in the same mission", async () => {
    const mission = guardMission({ g1: ["Alex"], g2: ["Bob"] });
    const people = [person("Alex"), person("Bob")];
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));

    const result = await applyReplacementAssignment({
      sourceMission: mission,
      sameDayMissions: [mission],
      slotId: "g1",
      seatIndex: 0,
      removeName: "Alex",
      option: {
        type: "swap",
        swapMissionId: "g1",
        swapSlotId: "g2",
        swapSeatIndex: 0,
      },
      peopleByName,
      issues: [],
      rules,
    });

    expect(result.missions[0].assignments.g1).toEqual(["Bob"]);
    expect(result.missions[0].assignments.g2).toEqual(["Alex"]);
  });

  it("direct replace unplaces current assignee before validating", async () => {
    const mission = guardMission({ g1: ["Alex"], g2: ["Bob"] });
    const people = [person("Alex"), person("Bob"), person("Carl")];
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));

    const result = await applyReplacementAssignment({
      sourceMission: mission,
      sameDayMissions: [mission],
      slotId: "g1",
      seatIndex: 0,
      removeName: "Alex",
      option: { type: "direct", personName: "Carl" },
      peopleByName,
      issues: [],
      rules,
    });

    expect(result.missions[0].assignments.g1).toEqual(["Carl"]);
    expect(result.missions[0].assignments.g2).toEqual(["Bob"]);
  });

  it("manual replace bypasses guard spacing and clears other guard slots", async () => {
    const mission = guardMission({
      g1: ["Alex"],
      g2: ["Bob"],
    });
    mission.scheduling_rules = { ...scheduling, guard_ratio: 2 };
    const people = [person("Alex"), person("Bob")];
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));

    await expect(
      applyReplacementAssignment({
        sourceMission: mission,
        sameDayMissions: [mission],
        slotId: "g2",
        seatIndex: 0,
        removeName: "Bob",
        option: { type: "direct", personName: "Alex" },
        peopleByName,
        issues: [],
        rules,
      }),
    ).rejects.toThrow();

    const forced = await applyReplacementAssignment({
      sourceMission: mission,
      sameDayMissions: [mission],
      slotId: "g2",
      seatIndex: 0,
      removeName: "Bob",
      option: { type: "manual", personName: "Alex" },
      peopleByName,
      issues: [],
      rules,
    });
    expect(forced.missions[0].assignments.g1).toEqual([""]);
    expect(forced.missions[0].assignments.g2).toEqual(["Alex"]);
  });

  it("missionsWithForcedAssignment assigns person even when guard spacing would fail", () => {
    const mission = guardMission({
      g1: ["Alex"],
      g2: ["Bob"],
    });
    mission.scheduling_rules = { ...scheduling, guard_ratio: 2 };
    const updated = missionsWithForcedAssignment(
      [mission],
      mission.id,
      "g2",
      0,
      "Alex",
      "Bob",
    );
    expect(updated[0].assignments.g1).toEqual([""]);
    expect(updated[0].assignments.g2).toEqual(["Alex"]);
  });

  it("rejects stale remove_name", async () => {
    const mission = guardMission({ g1: ["Bob"], g2: [""] });
    const peopleByName = { Bob: person("Bob"), Carl: person("Carl") };

    await expect(
      applyReplacementAssignment({
        sourceMission: mission,
        sameDayMissions: [mission],
        slotId: "g1",
        seatIndex: 0,
        removeName: "Alex",
        option: { type: "direct", personName: "Carl" },
        peopleByName,
        issues: [],
        rules,
      }),
    ).rejects.toThrow(/השיבוץ השתנה/);
  });
});
