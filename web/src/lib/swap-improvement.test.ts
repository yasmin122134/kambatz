import { describe, expect, it } from "vitest";
import { improveScheduleBySwaps } from "@/lib/swap-improvement";
import { buildTrackerFromMissions } from "@/lib/scheduling-engine";
import { lexBetter, scheduleLexScore, computeScheduleQuality } from "@/lib/schedule-quality";
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
  id: string,
  slots: Array<{ id: string; start: string; end: string }>,
  assignments: Record<string, string[]>,
): MissionDay {
  return {
    id,
    title: `guards-${id}`,
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

function kitchenMission(assignments: Record<string, string[]>): MissionDay {
  return {
    id: "kitchen",
    title: "kitchen",
    mission_type: "kitchen",
    mission_date: "2026-08-21",
    starts_at: "2026-08-21T06:00:00",
    ends_at: "2026-08-22T06:00:00",
    status: "draft",
    positions: [
      {
        id: "pk",
        name: "מטבח",
        kind: "kitchen",
        same_room: false,
        same_gender: false,
        slots: [
          { id: "k1", start_time: "12:00", end_time: "16:00", seat_count: 1 },
          { id: "k2", start_time: "16:00", end_time: "20:00", seat_count: 1 },
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

function lexFor(missions: MissionDay[], people: Person[]) {
  const meanPrior = 0;
  const tracker = buildTrackerFromMissions(missions, rules);
  let filled = 0;
  let required = 0;
  for (const m of missions) {
    for (const pos of m.positions) {
      for (const slot of pos.slots) required += slot.seat_count;
    }
    for (const seats of Object.values(m.assignments)) {
      filled += seats.filter(Boolean).length;
    }
  }
  return scheduleLexScore(
    computeScheduleQuality({
      tracker,
      people,
      rules,
      meanPrior,
      filledSeats: filled,
      requiredSeats: required,
    }),
  );
}

describe("improveScheduleBySwaps", () => {
  it("applies a beneficial cross-mission swap", () => {
    const people = [person("Alex"), person("Bob")];
    const before = [
      guardMission("g", [{ id: "g1", start: "08:00", end: "12:00" }], { g1: ["Alex"] }),
      kitchenMission({ k1: ["Alex"], k2: ["Bob"] }),
    ];
    const beforeScore = lexFor(before, people);

    const result = improveScheduleBySwaps({
      missions: before,
      people,
      issues: [],
      rules,
      meanPrior: 0,
    });

    expect(result.swapsApplied).toBeGreaterThan(0);
    const afterScore = lexFor(result.missions, people);
    expect(lexBetter(afterScore, beforeScore)).toBe(true);
    expect(result.missions.find((m) => m.id === "kitchen")?.assignments.k1).not.toContain(
      "Alex",
    );
  });

  it("returns unchanged when no improving swap exists", () => {
    const people = [person("Alex"), person("Bob")];
    const missions = [
      guardMission(
        "g",
        [
          { id: "g1", start: "08:00", end: "12:00" },
          { id: "g2", start: "20:00", end: "24:00" },
        ],
        { g1: ["Alex"], g2: ["Bob"] },
      ),
    ];
    const result = improveScheduleBySwaps({
      missions,
      people,
      issues: [],
      rules,
      meanPrior: 0,
      maxIterations: 3,
    });
    expect(result.swapsApplied).toBe(0);
    expect(result.missions[0].assignments).toEqual(missions[0].assignments);
  });
});
