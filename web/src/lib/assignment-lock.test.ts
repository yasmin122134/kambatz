import { describe, expect, it } from "vitest";
import {
  emptyLockedSeats,
  isSeatLocked,
  lockFilledSeats,
  restoreLockedAssignments,
  shouldKeepSeatOnAssign,
  syncLockedSeats,
  syncLockedSeatsWithAssignments,
  withSeatLock,
} from "@/lib/assignment-lock";
import { runGlobalAssign } from "@/lib/global-assign";
import { stripGuardSpacingViolations } from "@/lib/scheduling-engine";
import { flattenMissionSlots } from "@/lib/mission-utils";
import type { MissionDay, Person } from "@/lib/types";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";

function person(name: string, i: number): Person {
  return {
    id: name,
    name,
    email: null,
    room: `${100 + (i % 4)}`,
    gender: "m",
    squad: (i % 4) + 1,
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

function twoSlotMission(
  assignments: Record<string, string[]>,
  lockedSeats?: Record<string, boolean[]>,
): MissionDay {
  const positions = [
    {
      id: "p1",
      name: "פטל",
      kind: "guard" as const,
      slots: [
        {
          id: "s1",
          start_time: "08:00",
          end_time: "12:00",
          seat_count: 1,
          starts_at: "2026-08-21T08:00:00+03:00",
          ends_at: "2026-08-21T12:00:00+03:00",
        },
        {
          id: "s2",
          start_time: "14:00",
          end_time: "18:00",
          seat_count: 1,
          starts_at: "2026-08-21T14:00:00+03:00",
          ends_at: "2026-08-21T18:00:00+03:00",
        },
      ],
    },
  ];
  return {
    id: "g-lock",
    title: "שמירות",
    mission_type: "guards",
    mission_date: "2026-08-21",
    starts_at: "2026-08-21T08:00:00+03:00",
    ends_at: "2026-08-22T08:00:00+03:00",
    status: "draft",
    positions,
    assignments,
    locked_seats: lockedSeats,
    scheduling_rules: { ...DEFAULT_MISSION_SCHEDULING_RULES, board_start: "08:00" },
    notes: null,
    created_at: "",
    updated_at: "",
  };
}

describe("assignment lock helpers", () => {
  it("syncLockedSeats pads and drops orphan slot ids", () => {
    const mission = twoSlotMission({ s1: ["Alice"], s2: ["Bob"] });
    const out = syncLockedSeats(mission.positions, {
      s1: [true],
      old: [true],
    });
    expect(Object.keys(out).sort()).toEqual(["s1", "s2"]);
    expect(out.s1).toEqual([true]);
    expect(out.s2).toEqual([false]);
  });

  it("clears locks on empty seats", () => {
    const mission = twoSlotMission({ s1: [""], s2: ["Bob"] });
    const out = syncLockedSeatsWithAssignments(mission.positions, mission.assignments, {
      s1: [true],
      s2: [true],
    });
    expect(out.s1).toEqual([false]);
    expect(out.s2).toEqual([true]);
  });

  it("lockFilledSeats locks only assigned names", () => {
    const mission = twoSlotMission({ s1: ["Alice"], s2: [""] });
    expect(lockFilledSeats(mission.positions, mission.assignments)).toEqual({
      s1: [true],
      s2: [false],
    });
  });

  it("withSeatLock cannot lock an empty seat", () => {
    const mission = twoSlotMission({ s1: [""], s2: ["Bob"] });
    const next = withSeatLock(mission, "s1", 0, true);
    expect(isSeatLocked(next, "s1", 0)).toBe(false);
  });

  it("restoreLockedAssignments puts locked names back", () => {
    const mission = twoSlotMission(
      { s1: ["Alice"], s2: ["Bob"] },
      { s1: [true], s2: [false] },
    );
    const restored = restoreLockedAssignments(mission, {
      s1: ["Carol"],
      s2: ["Dave"],
    });
    expect(restored.s1).toEqual(["Alice"]);
    expect(restored.s2).toEqual(["Dave"]);
  });

  it("shouldKeepSeatOnAssign keeps locked names on reshuffle", () => {
    const mission = twoSlotMission(
      { s1: ["Alice"], s2: ["Bob"] },
      { s1: [true], s2: [false] },
    );
    expect(shouldKeepSeatOnAssign(mission, "s1", 0, "Alice", false)).toBe(true);
    expect(shouldKeepSeatOnAssign(mission, "s2", 0, "Bob", false)).toBe(false);
    expect(shouldKeepSeatOnAssign(mission, "s2", 0, "Bob", true)).toBe(true);
    expect(shouldKeepSeatOnAssign(mission, "s1", 0, "", false)).toBe(false);
  });

  it("emptyLockedSeats matches seat counts", () => {
    const mission = twoSlotMission({ s1: ["Alice"], s2: ["Bob"] });
    expect(emptyLockedSeats(mission.positions)).toEqual({ s1: [false], s2: [false] });
  });
});

describe("reshuffle keeps locked seats", () => {
  it("runGlobalAssign with keepExisting=false preserves locked names only", () => {
    const mission = twoSlotMission(
      { s1: ["Alice"], s2: ["Bob"] },
      { s1: [true], s2: [false] },
    );
    const people = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"].map((name, i) =>
      person(name, i),
    );

    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
      randomSeed: 42,
      maxNodes: 4_000,
      maxAttempts: 1,
    });

    const assignments = output.assignmentsByMission.get(mission.id)!;
    expect(assignments.s1[0]).toBe("Alice");
    expect(assignments.s2[0]).not.toBe("");
  });

  it("stripGuardSpacingViolations does not remove a locked consecutive guard", () => {
    const positions = [
      {
        id: "p1",
        name: "ימ״ח",
        kind: "guard" as const,
        slots: [
          {
            id: "a",
            start_time: "08:00",
            end_time: "12:00",
            seat_count: 1,
            starts_at: "2026-08-26T08:00:00+03:00",
            ends_at: "2026-08-26T12:00:00+03:00",
          },
          {
            id: "b",
            start_time: "12:00",
            end_time: "16:00",
            seat_count: 1,
            starts_at: "2026-08-26T12:00:00+03:00",
            ends_at: "2026-08-26T16:00:00+03:00",
          },
        ],
      },
    ];
    const mission: MissionDay = {
      id: "g1",
      title: "שמירות",
      mission_type: "guards",
      mission_date: "2026-08-26",
      starts_at: "2026-08-26T08:00:00+03:00",
      ends_at: "2026-08-27T08:00:00+03:00",
      status: "draft",
      positions,
      assignments: { a: ["Alex"], b: ["Alex"] },
      locked_seats: { a: [true], b: [true] },
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    const { assignments: cleaned, removed } = stripGuardSpacingViolations({
      mission,
      assignments: mission.assignments,
      scheduling: DEFAULT_MISSION_SCHEDULING_RULES,
      rules: DEFAULT_FAIRNESS_RULES,
    });

    expect(removed).toBe(0);
    expect(cleaned.a[0]).toBe("Alex");
    expect(cleaned.b[0]).toBe("Alex");
    expect(flattenMissionSlots(mission)).toHaveLength(2);
  });
});
