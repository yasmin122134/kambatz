import { describe, expect, it } from "vitest";
import { runGlobalAssign } from "@/lib/global-assign";
import { flattenMissionSlots, isStandbyKind } from "@/lib/mission-utils";
import { validateGeneratedRoster, validateNoPersonOverlaps } from "@/lib/scheduling-engine";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

const rules = { ...DEFAULT_FAIRNESS_RULES };
const scheduling = { ...DEFAULT_MISSION_SCHEDULING_RULES };

function person(name: string, room: string, squad: number): Person {
  return {
    id: name,
    name,
    email: null,
    room,
    gender: "m",
    squad,
    active: true,
    km: false,
    exam: false,
    no_weapon: false,
    no_guard: false,
    no_mag: false,
    prior_score: 0,
    created_at: "",
  };
}

function buildCarmelStressMission(): { mission: MissionDay; people: Person[] } {
  const carmelPositions = [
    {
      id: "carmel-a",
      name: "כרמל א׳",
      kind: "standby_carmel_a" as const,
      same_room: true,
      same_gender: true,
      slots: [
        { id: "ca", start_time: "08:00", end_time: "20:00", seat_count: 3 },
      ],
    },
    {
      id: "carmel-b",
      name: "כרמל ב׳",
      kind: "standby_carmel_b" as const,
      same_room: true,
      same_gender: true,
      slots: [
        { id: "cb", start_time: "08:00", end_time: "20:00", seat_count: 3 },
      ],
    },
  ];

  const guardPositions = Array.from({ length: 15 }, (_, i) => {
    const startHour = 10 + (i % 8) * 2;
    const endHour = startHour + 4;
    return {
      id: `guard-${i}`,
      name: `שמירה ${i + 1}`,
      kind: "guard" as const,
      same_room: false,
      same_gender: false,
      slots: [
        {
          id: `guard-slot-${i}`,
          start_time: `${String(startHour).padStart(2, "0")}:00`,
          end_time: `${String(endHour).padStart(2, "0")}:00`,
          seat_count: 1,
        },
      ],
    };
  });

  const positions = [...carmelPositions, ...guardPositions];
  const assignments = Object.fromEntries(
    positions.flatMap((p) =>
      p.slots.map((slot) => [slot.id, Array.from({ length: slot.seat_count }, () => "")]),
    ),
  );

  const mission: MissionDay = {
    id: "stress-guards",
    title: "stress",
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
  };

  const people: Person[] = [];
  for (let i = 0; i < 4; i++) {
    people.push(person(`Room101-${i + 1}`, "101", 1));
  }
  for (let i = 0; i < 3; i++) {
    people.push(person(`Room204-${i + 1}`, "204", 2));
  }
  for (let i = 0; i < 53; i++) {
    people.push(person(`Flex-${i + 1}`, `${300 + i}`, (i % 4) + 1));
  }

  return { mission, people };
}

describe("global assign — Carmel preservation", () => {
  it("fills both Carmel groups when only two rooms qualify and guards compete for same people", () => {
    const { mission, people } = buildCarmelStressMission();
    const peopleByName = Object.fromEntries(people.map((p) => [p.name, p]));

    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules,
      meanPrior: 0,
      keepExisting: false,
      maxNodes: 200_000,
      maxAttempts: 6,
    });

    const assignments = output.assignmentsByMission.get(mission.id)!;
    const carmelSlots = flattenMissionSlots(mission).filter((s) =>
      isStandbyKind(s.positionKind),
    );

    for (const slot of carmelSlots) {
      const seats = assignments[slot.slotId] || [];
      expect(seats.filter(Boolean)).toHaveLength(3);
      const rooms = new Set(
        seats.filter(Boolean).map((n) => peopleByName[n]?.room),
      );
      expect(rooms.size).toBe(1);
    }

    expect(output.status).toBe("complete");
    expect(output.objectiveSummary.carmelFilled).toBe(6);

    const draft = { ...mission, assignments };
    expect(validateNoPersonOverlaps([draft])).toEqual([]);
    expect(
      validateGeneratedRoster({ missions: [draft], peopleByName }),
    ).toEqual([]);
  });
});

describe("carmel group enumeration", () => {
  it("generates multiple trios from a 4-person room", async () => {
    const { enumerateCarmelGroups } = await import("@/lib/global-assign/carmel-groups");
    const { buildTrackerFromMissions } = await import("@/lib/scheduling-engine");
    const { mission, people } = buildCarmelStressMission();
    const slot = flattenMissionSlots(mission).find((s) => s.positionKind === "standby_carmel_a")!;
    const groups = enumerateCarmelGroups({
      slot,
      people: people.filter((p) => p.room === "101"),
      need: 3,
      fixedNames: [],
      tracker: buildTrackerFromMissions([], rules),
      issues: [],
      scheduling,
      peopleByName: Object.fromEntries(people.map((p) => [p.name, p])),
    });
    expect(groups.length).toBe(4);
  });
});
