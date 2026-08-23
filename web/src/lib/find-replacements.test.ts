import { describe, expect, it } from "vitest";
import { flattenMissionSlots } from "@/lib/mission-utils";
import {
  canAssignPersonToSlot,
  canSwapReplacementAssignments,
  findReplacements,
} from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import {
  DEFAULT_FAIRNESS_RULES,
  DEFAULT_MISSION_SCHEDULING_RULES,
} from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = { ...DEFAULT_MISSION_SCHEDULING_RULES, guard_ratio: 1 };

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

function guardMission(
  slots: Array<{ id: string; start: string; end: string }>,
  assignments: Record<string, string[]>,
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
          seat_count: 1,
        })),
      },
    ],
    assignments,
    scheduling_rules: scheduling,
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("findReplacements", () => {
  it("does not suggest consecutive guard for same person", () => {
    const mission = guardMission(
      [
        { id: "g1", start: "08:00", end: "12:00" },
        { id: "g2", start: "12:00", end: "16:00" },
      ],
      { g1: ["Alex"], g2: [""] },
    );
    const people = [person("Alex"), person("Bob")];
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));
    const slots = flattenMissionSlots(mission);

    expect(
      canAssignPersonToSlot({
        missions: [mission],
        rules,
        missionId: mission.id,
        slot: slots[1],
        seatIndex: 0,
        person: people[0],
        issues: [],
        peopleByName,
        replaceName: "Alex",
      }).ok,
    ).toBe(false);

    const options = findReplacements({
      missions: [mission],
      people,
      issues: [],
      rules,
      missionId: mission.id,
      slotId: "g2",
      seatIndex: 0,
      removeName: "Alex",
      mode: "replace",
    });
    expect(options.some((o) => o.personName === "Alex")).toBe(false);
    expect(options.some((o) => o.personName === "Bob")).toBe(true);
  });

  it("suggests only eligible replacements ranked by fairness", () => {
    const mission = guardMission(
      [
        { id: "g1", start: "08:00", end: "12:00" },
        { id: "g2", start: "12:00", end: "16:00" },
      ],
      { g1: ["Alex"], g2: ["Carl"] },
    );
    const people = [person("Alex"), person("Bob"), person("Carl")];

    const options = findReplacements({
      missions: [mission],
      people,
      issues: [],
      rules,
      missionId: mission.id,
      slotId: "g1",
      seatIndex: 0,
      removeName: "Alex",
      mode: "replace",
    });
    expect(options.map((o) => o.personName)).toContain("Bob");
    expect(options.map((o) => o.personName)).not.toContain("Alex");
    expect(options.map((o) => o.personName)).not.toContain("Carl");
  });

  it("suggests valid head-to-head swaps", () => {
    const mission = guardMission(
      [
        { id: "g1", start: "08:00", end: "12:00" },
        { id: "g2", start: "16:00", end: "20:00" },
      ],
      { g1: ["Alex"], g2: ["Bob"] },
    );
    const people = [person("Alex"), person("Bob")];

    const options = findReplacements({
      missions: [mission],
      people,
      issues: [],
      rules,
      missionId: mission.id,
      slotId: "g1",
      seatIndex: 0,
      removeName: "Alex",
      mode: "swap",
    });

    expect(options).toHaveLength(1);
    expect(options[0].swapMissionId).toBe(mission.id);
    expect(options[0].swapSlotId).toBe("g2");
    expect(options[0].swapSeatIndex).toBe(0);
    expect(
      canSwapReplacementAssignments({
        missions: [mission],
        rules,
        missionId: mission.id,
        slot: flattenMissionSlots(mission)[0],
        seatIndex: 0,
        removeName: "Alex",
        swapMissionId: mission.id,
        swapSlot: flattenMissionSlots(mission)[1],
        swapSeatIndex: 0,
        swapPerson: people[1],
        issues: [],
        peopleByName: Object.fromEntries(people.map((p) => [p.name, p])),
      }).ok,
    ).toBe(true);
  });
});
