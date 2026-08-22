import { describe, expect, it } from "vitest";
import { linkedGuardDayAssignScope } from "@/lib/guard-day-bundle";
import { runGlobalAssign } from "@/lib/global-assign";
import { DEFAULT_FAIRNESS_RULES, DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";
import type { MissionDay, Person } from "@/lib/types";

function person(id: string, name: string, squad = 1): Person {
  return {
    id,
    name,
    email: null,
    squad,
    room: "101",
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

describe("linkedGuardDayAssignScope", () => {
  it("includes linked base_work with guards", () => {
    const guards = {
      id: "g1",
      title: "שמירות",
      status: "draft" as const,
      notes: "",
      mission_type: "guards" as const,
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T06:00:00Z",
      ends_at: "2026-08-22T06:00:00Z",
      positions: [],
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        linked_mission_id: "b1",
        guard_day_bundle_id: "bundle-1",
      },
    } satisfies MissionDay;
    const base = {
      id: "b1",
      title: "עב״ס",
      status: "draft" as const,
      notes: "",
      mission_type: "base_work" as const,
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T05:30:00Z",
      ends_at: "2026-08-21T17:00:00Z",
      positions: [],
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: {
        ...DEFAULT_MISSION_SCHEDULING_RULES,
        linked_mission_id: "g1",
        guard_day_bundle_id: "bundle-1",
      },
    } satisfies MissionDay;
    const kitchen = {
      id: "k1",
      title: "מטבח",
      status: "draft" as const,
      notes: "",
      mission_type: "kitchen" as const,
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T04:00:00Z",
      ends_at: "2026-08-22T04:00:00Z",
      positions: [],
      assignments: {},
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    } satisfies MissionDay;
    const scope = linkedGuardDayAssignScope(guards, [guards, base, kitchen]);
    expect(scope.map((m) => m.id)).toEqual(["b1", "g1"]);
  });
});

describe("runGlobalAssign base_work units", () => {
  it("creates basework shift units instead of per-seat units", () => {
    const mission = {
      id: "b1",
      title: "עב״ס",
      status: "draft" as const,
      notes: "",
      mission_type: "base_work" as const,
      mission_date: "2026-08-21",
      starts_at: "2026-08-21T05:30:00Z",
      ends_at: "2026-08-21T17:00:00Z",
      positions: [
        {
          id: "p1",
          name: "עב״ס",
          kind: "duty" as const,
          slots: [
            {
              id: "s1",
              start_time: "08:30",
              end_time: "11:30",
              seat_count: 14,
            },
          ],
        },
      ],
      assignments: { s1: Array(14).fill("") },
      created_at: "",
      updated_at: "",
      scheduling_rules: DEFAULT_MISSION_SCHEDULING_RULES,
    } satisfies MissionDay;
    const people = Array.from({ length: 56 }, (_, i) =>
      person(`p${i}`, `צוער ${i + 1}`, (i % 4) + 1),
    );
    const output = runGlobalAssign({
      missions: [mission],
      people,
      issues: [],
      rules: DEFAULT_FAIRNESS_RULES,
      meanPrior: 0,
      keepExisting: false,
    });
    const seats = output.assignmentsByMission.get("b1")?.s1 || [];
    expect(seats.filter(Boolean).length).toBeGreaterThanOrEqual(13);
  });
});
